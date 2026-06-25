import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { queryTobyMemberLoginInfo } from '../lib/toby-open-api.js'

/**
 * 业务管理平台会员同步服务。
 *
 * 关键不变量（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 业管平台是会员、权益、A 豆余额的权威来源。
 * - 本服务只同步身份和权益商品信息，绝不把 A 豆余额 / 累计获得 / 累计消费落入本地库。
 * - 付费生成前必须调用单独的 A 豆余额接口实时获取余额，不能用 MEMBER-1001 缓存值判断。
 */

// ─── 业管原始字段（仅用于解析 MEMBER-1001 响应，不直接落库） ─────────────────

export interface RawBizMgmtMember {
  userId: string
  phone: string
  userName: string
  compName: string
  userType: '1' | '2' | string
  status: number
  // 以下三项是业管实时权益数据，仅供调试/解析，不得作为本地落库字段或生成前余额依据
  pointsNum?: number | null
  sumPointsNum?: number | null
  consumePointsNum?: number | null
  goodsId?: string | null
  goodsName?: string | null
  createTime?: string | null
}

// ─── 标准化后的会员身份（只保留身份与权益商品字段，不含 A 豆数据） ─────────────

export interface NormalizedBizMgmtMember {
  bizMgmtUserId: string
  phone: string
  userName: string
  compName: string
  userType: '1' | '2'
  status: 1 | 2 | 3
  goodsId: string | null
  goodsName: string | null
  bizMgmtCreatedAt: string | null
  // 本地团队名称来源：公司会员用 compName，个人会员用 userName
  teamName: string
}

/**
 * 计算本地团队名称。
 * - 公司会员（userType=2）：优先用 compName（公司名称）。
 * - 个人会员：优先用 userName，兜底 compName，再兜底固定文案。
 */
export function pickDefaultBizMgmtMemberName(input: {
  userName: string
  compName: string
  userType: string
}): string {
  if (input.userType === '2' && input.compName.trim()) return input.compName.trim()
  return input.userName.trim() || input.compName.trim() || '业管账号'
}

/**
 * 把 MEMBER-1001 单条会员原始数据标准化为本地绑定所需结构。
 *
 * 显式剔除 pointsNum / sumPointsNum / consumePointsNum：
 * 这些是业管实时权益数据，本地不允许落库，避免被误当作生成前余额判断依据。
 */
export function normalizeBizMgmtMember(member: RawBizMgmtMember): NormalizedBizMgmtMember {
  if (member.userType !== '1' && member.userType !== '2') throw new Error(`未知会员类型：${member.userType}`)
  if (member.status !== 1 && member.status !== 2 && member.status !== 3) throw new Error(`未知会员状态：${member.status}`)
  return {
    bizMgmtUserId: member.userId,
    phone: member.phone,
    userName: member.userName,
    compName: member.compName,
    userType: member.userType,
    status: member.status,
    goodsId: member.goodsId ?? null,
    goodsName: member.goodsName ?? null,
    bizMgmtCreatedAt: member.createTime ?? null,
    teamName: pickDefaultBizMgmtMemberName(member),
  }
}

/**
 * 生成首次初始化本地用户的一次性初始密码。
 * 仅在本地不存在用户、且业管返回至少一个可用会员时使用。
 */
export function generateOneTimePassword(): string {
  return `Biz-${crypto.randomBytes(4).toString('hex')}`
}

/**
 * 用手机号调用业管 MEMBER-1001 查询会员列表并标准化。
 *
 * 只返回 status=1（正常）的会员；status 非 1 的会员不可被选为当前身份。
 */
export async function fetchBizMgmtMembersByPhone(phone: string): Promise<NormalizedBizMgmtMember[]> {
  const response = await queryTobyMemberLoginInfo({ phone })
  const members = (response.decryptedData as { members?: RawBizMgmtMember[] } | undefined)?.members ?? []
  // MEMBER-1001 返回的 pointsNum/sumPointsNum/consumePointsNum 属于业管实时权益数据。
  // 本服务只同步身份和权益商品信息，不能把 A 豆余额或累计消费落入本地库；
  // 付费生成前必须调用单独的 A 豆余额接口重新获取余额。
  return members.map(normalizeBizMgmtMember).filter((member) => member.status === 1)
}

/**
 * 为业管手机号确保本地登录用户存在。
 *
 * 关键不变量：
 * - 本地不存在用户时，必须先查业管；只有业管返回至少一个 status=1 的会员，
 *   才允许创建本地用户、生成一次性初始密码。
 * - 业管查询失败或无可用会员时抛错，不创建本地用户。
 * - 返回的 members 用于后续 team/workspace 初始化（见 syncBizMgmtMembersForLocalUser）。
 */
export async function ensureLocalUserForBizMgmtPhone(
  phone: string,
): Promise<{ userId: string; oneTimePassword: string | null; members: NormalizedBizMgmtMember[] }> {
  const db = getDb()
  const existing = await db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirst()
  const members = await fetchBizMgmtMembersByPhone(phone)
  if (members.length === 0) throw new Error('业管平台未查询到可用会员')
  if (existing) return { userId: existing.id, oneTimePassword: null, members }

  const oneTimePassword = generateOneTimePassword()
  const passwordHash = await bcrypt.hash(oneTimePassword, 10)
  const user = await db
    .insertInto('users')
    .values({
      account: phone,
      phone,
      email: null,
      username: phone,
      password_hash: passwordHash,
      role: 'member',
      status: 'active',
      plan_tier: 'free',
      password_change_required: true,
      generation_defaults: JSON.stringify({}),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return { userId: user.id, oneTimePassword, members }
}

/**
 * 把业管会员列表同步到本地绑定表，并补齐 team / workspace。
 *
 * 关键不变量（见计划 Critical Login Invariant）：
 * - 同一 biz_mgmt_user_id 复用既有 team_id / workspace_id，避免每次登录重复建团队。
 * - 本次从业管未返回的绑定不硬删除，只把 status 标记为非 1（这里置 2=冻结），
 *   防止业管临时异常导致本地权限被误删；恢复后下次登录会重新置回 status=1。
 * - 整个同步在一个事务内完成，保证绑定、team、workspace 三者一致。
 *
 * 注意：本函数只处理身份与本地资源映射，不读写 A 豆余额。
 */
export async function syncBizMgmtMembersForLocalUser(
  localUserId: string,
  phone: string,
): Promise<NormalizedBizMgmtMember[]> {
  const db = getDb()
  const members = await fetchBizMgmtMembersByPhone(phone)

  await db.transaction().execute(async (trx) => {
    for (const member of members) {
      const existingBinding = await trx
        .selectFrom('biz_mgmt_member_bindings')
        .select(['id', 'team_id', 'workspace_id'])
        .where('biz_mgmt_user_id', '=', member.bizMgmtUserId)
        .executeTakeFirst()

      let teamId = existingBinding?.team_id
      let workspaceId = existingBinding?.workspace_id

      if (!teamId) {
        // 新业管身份首次落地：创建对应类型的本地团队
        const team = await trx
          .insertInto('teams')
          .values({
            name: member.teamName,
            owner_id: localUserId,
            plan_tier: 'free',
            team_type: member.userType === '1' ? 'personal' : 'company_a',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        teamId = team.id

        await trx.insertInto('team_members').values({ team_id: teamId, user_id: localUserId, role: 'owner' }).execute()
        await trx
          .insertInto('credit_accounts')
          .values({ owner_type: 'team', team_id: teamId, balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 })
          .execute()
      }

      if (!workspaceId) {
        const workspace = await trx
          .insertInto('workspaces')
          .values({ team_id: teamId, name: '默认工作区', description: null, created_by: localUserId })
          .returning('id')
          .executeTakeFirstOrThrow()
        workspaceId = workspace.id

        await trx
          .insertInto('workspace_members')
          .values({ workspace_id: workspaceId, user_id: localUserId, role: 'admin' })
          .execute()
      }

      // upsert 绑定：biz_mgmt_user_id 唯一，已存在则刷新身份快照（不含 A 豆数据）
      await trx
        .insertInto('biz_mgmt_member_bindings')
        .values({
          local_user_id: localUserId,
          biz_mgmt_user_id: member.bizMgmtUserId,
          phone: member.phone,
          user_name: member.userName,
          user_type: member.userType,
          status: member.status,
          comp_name: member.compName,
          goods_id: member.goodsId,
          goods_name: member.goodsName,
          biz_mgmt_created_at: member.bizMgmtCreatedAt ? sql`${member.bizMgmtCreatedAt}::timestamptz` : null,
          team_id: teamId,
          workspace_id: workspaceId,
          last_synced_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.column('biz_mgmt_user_id').doUpdateSet({
            local_user_id: localUserId,
            phone: member.phone,
            user_name: member.userName,
            user_type: member.userType,
            status: member.status,
            comp_name: member.compName,
            goods_id: member.goodsId,
            goods_name: member.goodsName,
            team_id: teamId!,
            workspace_id: workspaceId!,
            last_synced_at: sql`now()`,
            updated_at: sql`now()`,
          }),
        )
        .execute()
    }

    if (members.length > 0) {
      // 本次未从业管返回的旧绑定不删除，只冻结，避免业管临时异常误删本地权限
      await trx
        .updateTable('biz_mgmt_member_bindings')
        .set({ status: 2, updated_at: sql`now()` })
        .where('local_user_id', '=', localUserId)
        .where('biz_mgmt_user_id', 'not in', members.map((member) => member.bizMgmtUserId))
        .execute()
    }
  })

  return members
}
