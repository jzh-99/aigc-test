import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'
import { changeTobyMemberPoints } from '../../lib/toby-open-api.js'
import {
  normalizeBizMgmtPointsBalance,
} from '../../services/biz-mgmt-a-bean.js'
import { writeBizMgmtBalanceCache } from '../../services/biz-mgmt-balance-cache.js'

/**
 * POST /teams/:id/members/:uid/points-change
 *
 * 团队 owner（公司主卡）对名下副卡成员发起 A豆变动，调用业管 MEMBER-1005。
 * changeType=1 副卡增加 / 2 副卡扣减；pointsNum>0。
 *
 * 权威约束：A豆账户由业管平台统一管理，本地不落账户/流水。
 * - mainUserId 取「当前操作者当前选中的业管身份」，必须满足公司主卡（user_type=2 且 is_master=true）。
 * - subUserId 取被操作成员的 biz_mgmt_user_id（必须已同步业管身份）。
 * - 变更成功后用业管返回的 mainBalancePointsNum/subBalancePointsNum 直接刷新主、副卡两份
 *   Redis 展示缓存，前端刷新列表即可看到主副卡最新余额；不回源、不写 PostgreSQL。
 * - 该接口无 requestNo（业管 MEMBER-1005 契约未提供），属管理员手动操作，
 *   不写入 biz_mgmt_a_bean_transactions（该表仅服务生成扣减的幂等审计）。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string; uid: string }
    Body: {
      changeType: 1 | 2
      pointsNum: number
    }
  }>(
    '/teams/:id/members/:uid/points-change',
    {
      preHandler: teamRoleGuard('owner'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['changeType', 'pointsNum'],
          properties: {
            changeType: { type: 'integer', enum: [1, 2] },
            pointsNum: { type: 'number', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { changeType, pointsNum } = request.body
      const teamId = request.params.id

      // 数量必须为正有限数（允许小数 A豆）。schema 的 minimum:0 允许 0，此处再收紧到 >0。
      if (!Number.isFinite(pointsNum) || pointsNum <= 0) {
        return reply.badRequest('A豆数量必须大于 0')
      }

      const db = getDb()

      // ── 公司主卡门控：mainUserId = 当前操作者当前选中的业管身份 ──────────────
      // teamRoleGuard('owner') 已拦截非 owner；此为业务侧权威二次校验，与 create-member 一致。
      const ownerBinding = await db
        .selectFrom('biz_mgmt_member_bindings')
        .select(['biz_mgmt_user_id', 'user_type', 'is_master'])
        .where('local_user_id', '=', request.user.id)
        .where('is_selected', '=', true)
        .where('status', '=', 1)
        .executeTakeFirst()
      if (!ownerBinding || ownerBinding.user_type !== '2' || !ownerBinding.is_master) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_NOT_MASTER',
            message: '当前身份非公司主卡，无法变更副卡 A豆。请切换到公司主卡身份后重试。',
          },
        })
      }
      const mainUserId = ownerBinding.biz_mgmt_user_id

      // ── 目标副卡成员解析：subUserId = 被操作成员的 biz_mgmt_user_id ─────────
      const member = await db
        .selectFrom('team_members')
        .innerJoin('users', 'users.id', 'team_members.user_id')
        .leftJoin('biz_mgmt_member_bindings', (join) =>
          join
            .onRef('biz_mgmt_member_bindings.local_user_id', '=', 'team_members.user_id')
            .onRef('biz_mgmt_member_bindings.team_id', '=', 'team_members.team_id'),
        )
        .select([
          'users.id as user_id',
          'users.username',
          'biz_mgmt_member_bindings.biz_mgmt_user_id',
        ])
        .where('team_members.team_id', '=', teamId)
        .where('team_members.user_id', '=', request.params.uid)
        .executeTakeFirst()

      if (!member) return reply.notFound('成员不存在')
      if (!member.biz_mgmt_user_id) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_MEMBER_NOT_SYNCED',
            message: '该成员尚未同步业管会员身份，暂不能变更 A豆',
          },
        })
      }
      const subUserId = member.biz_mgmt_user_id
      // 不能对自己（主卡本身）发起副卡变动。
      if (subUserId === mainUserId) {
        return reply.badRequest('不能对主卡自身发起 A豆变动')
      }

      // ── 调业管 MEMBER-1005 变更副卡 A豆 ──────────────────────────────────
      let tobyRes
      try {
        tobyRes = await changeTobyMemberPoints({
          mainUserId,
          subUserId,
          changeType,
          pointsNum,
        })
      } catch (err) {
        // 网络异常/超时/解密/验签失败：502 返回，不写缓存。
        request.log.error({ err, mainUserId, subUserId }, '[points-change] 业管 MEMBER-1005 调用异常')
        return reply.status(502).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_POINTS_CHANGE_UNREACHABLE',
            message: err instanceof Error ? err.message : '业管接口调用失败',
          },
        })
      }

      if (tobyRes.code !== '0000') {
        request.log.warn(
          { bizCode: tobyRes.code, bizMessage: tobyRes.message, mainUserId, subUserId },
          '[points-change] 业管 MEMBER-1005 返回非成功',
        )
        return reply.status(502).send({
          success: false,
          error: {
            code: 'BIZ_MGMT_POINTS_CHANGE_FAILED',
            message: tobyRes.message || '业管 A豆变动失败',
          },
        })
      }

      // ── 成功：用业管返回的最新余额刷新主、副卡两份 Redis 展示缓存 ──────────
      // 业管返回的是变更后权威余额；缺失字段容错跳过对应缓存，不阻断返回。
      const payload = tobyRes.decryptedData ?? {}
      let mainBalance: number | null = null
      let subBalance: number | null = null
      try {
        if (payload.mainBalancePointsNum != null) {
          mainBalance = normalizeBizMgmtPointsBalance({ pointsNum: payload.mainBalancePointsNum })
          await writeBizMgmtBalanceCache(app.redis, mainUserId, mainBalance)
        }
      } catch (err) {
        // 主卡余额标准化失败不阻断（副卡缓存与返回照常），仅记录便于排查。
        request.log.warn({ err, mainUserId }, '[points-change] 主卡余额缓存写入失败')
      }
      try {
        if (payload.subBalancePointsNum != null) {
          subBalance = normalizeBizMgmtPointsBalance({ pointsNum: payload.subBalancePointsNum })
          await writeBizMgmtBalanceCache(app.redis, subUserId, subBalance)
        }
      } catch (err) {
        request.log.warn({ err, subUserId }, '[points-change] 副卡余额缓存写入失败')
      }

      return {
        main_user_id: mainUserId,
        sub_user_id: subUserId,
        main_balance: mainBalance,
        sub_balance: subBalance,
      }
    },
  )
}

export default route
