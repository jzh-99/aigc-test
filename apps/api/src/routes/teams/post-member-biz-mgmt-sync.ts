import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'
import { fetchBizMgmtMembersByPhone } from '../../services/biz-mgmt-member-sync.js'
import { refreshBizMgmtBalanceCache } from '../../services/biz-mgmt-balance-cache.js'

function pickTeamMemberCandidate<T extends {
  status: number
  userType: string
  isMaster: boolean
  compName: string
}>(members: T[], ownerCompName: string | null): T | null {
  // 一个手机号在业管侧可以同时拥有多个公司身份和一个个人身份。
  // 当前接口服务“团队成员列表里的公司团队余额展示”，因此只匹配公司副卡；
  // 个人会员身份应映射到个人 team，不能兜底绑定到公司 team。
  const usableSubCards = members.filter((member) =>
    member.status === 1 && member.userType === '2' && !member.isMaster
  )
  if (usableSubCards.length === 0) return null

  const normalizedOwnerCompName = ownerCompName?.trim()
  if (normalizedOwnerCompName) {
    const sameCompany = usableSubCards.find((member) => member.compName.trim() === normalizedOwnerCompName)
    return sameCompany ?? null
  }

  return usableSubCards.length === 1 ? usableSubCards[0] : null
}

function parseBizMgmtDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * POST /teams/:id/members/:uid/biz-mgmt-sync
 *
 * 团队 owner 为“未同步”的成员补齐业管会员编号，并刷新展示余额。
 * 本地绑定只作为下次列表展示的缓存索引，不作为查询资格限制；A 豆余额仍只写 Redis。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; uid: string } }>(
    '/teams/:id/members/:uid/biz-mgmt-sync',
    {
      preHandler: teamRoleGuard('owner'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const db = getDb()
      const teamId = request.params.id
      const userId = request.params.uid
      const debounceKey = `biz_mgmt:member_sync_debounce:${teamId}:${userId}`
      const canQueryBizMgmt = await app.redis.set(debounceKey, '1', 'EX', 10, 'NX')
      if (!canQueryBizMgmt) {
        return reply.status(429).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_SYNC_DEBOUNCED',
            message: '同步请求过于频繁，请稍后再试',
          },
        })
      }

      const ownerBinding = await db
        .selectFrom('biz_mgmt_member_bindings')
        .select(['biz_mgmt_user_id', 'comp_name'])
        .where('team_id', '=', teamId)
        .where('local_user_id', '=', request.user.id)
        .where('status', '=', 1)
        .where('is_master', '=', true)
        .executeTakeFirst()

      if (!ownerBinding) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_NOT_MASTER',
            message: '当前团队未绑定公司主卡身份，无法同步副卡成员',
          },
        })
      }

      const member = await db
        .selectFrom('team_members')
        .innerJoin('users', 'users.id', 'team_members.user_id')
        .select(['users.id as user_id', 'users.phone', 'users.username'])
        .where('team_members.team_id', '=', teamId)
        .where('team_members.user_id', '=', userId)
        .executeTakeFirst()

      if (!member) return reply.notFound('成员不存在')
      if (!member.phone || !/^1\d{10}$/.test(member.phone)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_MEMBER_PHONE', message: '该成员没有可用于同步的 11 位手机号' },
        })
      }

      const existingTeamBinding = await db
        .selectFrom('biz_mgmt_member_bindings')
        .select('biz_mgmt_user_id')
        .where('local_user_id', '=', userId)
        .where('team_id', '=', teamId)
        .executeTakeFirst()
      if (existingTeamBinding) {
        const cache = await refreshBizMgmtBalanceCache(app.redis, existingTeamBinding.biz_mgmt_user_id)
        return {
          user_id: userId,
          biz_mgmt_user_id: existingTeamBinding.biz_mgmt_user_id,
          balance: cache.balance,
          updated_at: cache.updatedAt,
        }
      }

      const members = await fetchBizMgmtMembersByPhone(member.phone)
      const candidate = pickTeamMemberCandidate(members, ownerBinding.comp_name)
      if (!candidate) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_SUBCARD_NOT_FOUND',
            message: '业管平台未查询到该手机号的可用会员记录，请确认该成员已在业管侧创建副卡',
          },
        })
      }

      const workspace = await db
        .selectFrom('workspace_members')
        .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
        .select('workspaces.id')
        .where('workspace_members.user_id', '=', userId)
        .where('workspaces.team_id', '=', teamId)
        .where('workspaces.is_deleted', '=', false)
        .executeTakeFirst()
        ?? await db
          .selectFrom('workspaces')
          .select('id')
          .where('team_id', '=', teamId)
          .where('is_deleted', '=', false)
          .orderBy('created_at', 'asc')
          .executeTakeFirst()

      if (!workspace) return reply.badRequest('团队暂无可绑定的工作区')

      const now = new Date()
      const bindingSnapshot = {
        phone: candidate.phone,
        user_name: candidate.userName,
        user_type: candidate.userType,
        status: candidate.status,
        is_master: candidate.isMaster,
        comp_name: candidate.compName,
        goods_id: candidate.goodsId,
        goods_name: candidate.goodsName,
        biz_mgmt_created_at: parseBizMgmtDate(candidate.bizMgmtCreatedAt),
        team_id: teamId,
        workspace_id: workspace.id,
        last_synced_at: now,
        updated_at: now,
      }

      await db
        .insertInto('biz_mgmt_member_bindings')
        .values({
          local_user_id: userId,
          biz_mgmt_user_id: candidate.bizMgmtUserId,
          ...bindingSnapshot,
        })
        .onConflict((oc) =>
          oc.column('biz_mgmt_user_id').doUpdateSet({
            local_user_id: userId,
            ...bindingSnapshot,
          }),
        )
        .execute()

      const cache = await refreshBizMgmtBalanceCache(app.redis, candidate.bizMgmtUserId)
      return {
        user_id: userId,
        biz_mgmt_user_id: candidate.bizMgmtUserId,
        balance: cache.balance,
        updated_at: cache.updatedAt,
      }
    },
  )
}

export default route
