import { getDb } from '@aigc/db'
import type { Database } from '@aigc/db'
import { sql } from 'kysely'
import type { Transaction } from 'kysely'
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
 * 返回 status=1/2/3 全部会员（真实 status 透传给 sync 分流处理）：
 * - status=1 正常：建/更新 team，可选可用。
 * - status=2 冻结：sync 记 binding.status=2，team 不动；profile 返回让前端能看到但不可切换；
 *   付费限制由 getCurrentBizMgmtIdentity 只认 status=1 天然实现。
 * - status=3 删除：已入库软删 team，未入库不入库。
 * 是否拒绝登录（全部 status=3）由 check-biz-mgmt 判断，不在本函数过滤。
 */
export async function fetchBizMgmtMembersByPhone(phone: string): Promise<NormalizedBizMgmtMember[]> {
  const response = await queryTobyMemberLoginInfo({ phone })
  const members = (response.decryptedData as { members?: RawBizMgmtMember[] } | undefined)?.members ?? []
  // MEMBER-1001 返回的 pointsNum/sumPointsNum/consumePointsNum 属于业管实时权益数据。
  // 本服务只同步身份和权益商品信息，不能把 A 豆余额或累计消费落入本地库；
  // 付费生成前必须调用单独的 A 豆余额接口重新获取余额。
  return members.map(normalizeBizMgmtMember)
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
 * upsert 业管会员绑定记录。
 * - 已存在则刷新身份快照（不含 A 豆数据）；不存在则插入。
 * - clearIfSelected=true 时，若该 binding 是当前选中（is_selected=true），清空 is_selected，
 *   用于 status=3 软删后避免悬空选中。
 * - bindingId 仅 clearIfSelected=true 时需要（定位要清空的记录）。
 * - teamId/workspaceId 由调用方保证非空（biz_mgmt_member_bindings 两列非空约束）。
 */
async function upsertBinding(
  trx: Transaction<Database>,
  localUserId: string,
  member: NormalizedBizMgmtMember,
  teamId: string,
  workspaceId: string,
  bindingId: string | null,
  clearIfSelected: boolean,
): Promise<void> {
  // 先处理"清空悬空选中"：仅对已存在且当前选中的 binding
  if (clearIfSelected && bindingId) {
    await trx
      .updateTable('biz_mgmt_member_bindings')
      .set({ is_selected: false, updated_at: sql`now()` })
      .where('id', '=', bindingId)
      .where('is_selected', '=', true)
      .execute()
  }

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
        biz_mgmt_created_at: member.bizMgmtCreatedAt ? sql`${member.bizMgmtCreatedAt}::timestamptz` : null,
        team_id: teamId,
        workspace_id: workspaceId,
        last_synced_at: sql`now()`,
        updated_at: sql`now()`,
      }),
    )
    .execute()
}

/**
 * 把业管会员列表同步到本地绑定表，并补齐 team / workspace。
 *
 * 关键不变量（见计划 Critical Login Invariant）：
 * - 同一 biz_mgmt_user_id 复用既有 team_id / workspace_id，避免每次登录重复建团队。
 * - 按业管真实 status 分流：status=1 建/更新 team（曾软删的恢复）；status=2 仅更新 binding 不动 team；
 *   status=3 已入库软删 team、清空 is_selected，未入库不入库。
 * - 不再用"未返回推断冻结"（旧 not in 逻辑已移除），改用业管权威 status。
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

      // ── status=3（删除）：已入库软删 team/workspace；未入库跳过（不入库）──────────
      if (member.status === 3) {
        if (!existingBinding) {
          // 未入库的删除会员：不建 binding、不建 team，直接跳过
          continue
        }
        if (existingBinding.team_id) {
          // 软删该身份的 workspaces
          await trx
            .updateTable('workspaces')
            .set({ is_deleted: true, deleted_at: sql`now()` })
            .where('team_id', '=', existingBinding.team_id)
            .where('is_deleted', '=', false)
            .execute()
          // 软删 team
          await trx
            .updateTable('teams')
            .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
            .where('id', '=', existingBinding.team_id)
            .execute()
        }
        // upsert binding 记 status=3（审计保留）；若是当前选中身份，清空 is_selected 避免悬空选中。
        // existingBinding 此处必存在（上面 !existingBinding 已 continue），team_id/workspace_id 列非空。
        await upsertBinding(
          trx,
          localUserId,
          member,
          existingBinding!.team_id!,
          existingBinding!.workspace_id!,
          existingBinding!.id,
          /* clearIfSelected */ true,
        )
        continue
      }

      // ── status=2（冻结）：仅 upsert binding 记 status=2，不建/不删 team ─────────
      // team 若已存在则保留（前端能看到置灰工作区）；从未入库的冻结身份不入库（不需要 team）。
      if (member.status === 2) {
        if (!existingBinding) continue
        await upsertBinding(
          trx,
          localUserId,
          member,
          existingBinding.team_id!,
          existingBinding.workspace_id!,
          existingBinding.id,
          false,
        )
        continue
      }

      // ── status=1（正常）：无 team 则建，有则刷新；曾软删的 team 恢复 ───────────
      let teamId = existingBinding?.team_id
      let workspaceId = existingBinding?.workspace_id

      // 若该 team 此前被软删过（曾 status=3），现在恢复 → 解除软删并刷新名称/类型
      if (teamId) {
        await trx
          .updateTable('teams')
          .set({
            is_deleted: false,
            deleted_at: null,
            name: member.teamName,
            team_type: member.userType === '1' ? 'personal' : 'company_a',
            updated_at: sql`now()`,
          })
          .where('id', '=', teamId)
          .execute()
        await trx
          .updateTable('workspaces')
          .set({ is_deleted: false, deleted_at: null })
          .where('team_id', '=', teamId)
          .where('is_deleted', '=', true)
          .execute()
      }

      if (!teamId) {
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
        // 本地积分系统已退役：不再创建 credit_accounts，团队 A 豆余额由业管平台管理
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

      // upsert binding（status=1，正常可用身份）。teamId/workspaceId 此处均已非空。
      await upsertBinding(trx, localUserId, member, teamId!, workspaceId!, existingBinding?.id ?? null, false)
    }
  })

  return members
}

/**
 * 物理删除一个本地用户及其全部业务数据（业管先行登录的孤儿清理）。
 *
 * 触发场景（见计划 Critical Login Invariant）：
 * 业管是账号唯一判官。当手机号登录时业管 MEMBER-1001 返回空会员列表，
 * 或接口调用失败（故障等同查无），且本地存在该手机号 user 时，必须调用本函数
 * 把这个"业管已不存在"的用户的全部本地业务数据物理删除，避免本地残留孤儿账号。
 *
 * 删除顺序（叶子→根，严格依赖外键约束）：
 * 大量业务表对 users.id 是 NO ACTION（Postgres 默认 RESTRICT），直接删 users 会被 FK 阻止，
 * 所以必须按依赖图逆拓扑顺序逐表删除，最后才能删 users。
 *
 * CASCADE 表（refresh_tokens/email_verifications/workspace_members/biz_mgmt_*）理论上会被自动级联，
 * 但显式删除更可控、更易读，且不依赖外键策略的隐式行为。
 *
 * SET NULL 表（provider_api_logs/mini_user_auth_records）删 user 时会自动置 NULL，无需手动处理。
 *
 * 整个删除在单个事务内完成，任何一步失败则整体回滚，避免删一半导致数据不一致。
 *
 * @param localUserId 本地 users.id
 */
export async function purgeLocalUserCascade(localUserId: string): Promise<void> {
  const db = getDb()

  await db.transaction().execute(async (trx) => {
    // ── 1. 最底层业务记录（仅引用 user，无反向 FK 依赖）─────────────────────
    await trx.deleteFrom('prompt_filter_logs').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('payment_orders').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('voice_profiles').where('user_id', '=', localUserId).execute()
    // provider_api_logs.user_id 是 SET NULL，会自动处理，这里显式删除避免留日志
    await trx.deleteFrom('provider_api_logs').where('user_id', '=', localUserId).execute()

    // ── 2. 创作类项目表（引用 user + workspace/team）────────────────────────
    // picture_book_project_charges 引用 picture_book_projects，先删 charges
    await trx.deleteFrom('picture_book_project_charges').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('picture_book_projects').where('user_id', '=', localUserId).execute()
    // short_drama_projects 删后，short_drama_segments 通过 project_id CASCADE 自动删
    await trx.deleteFrom('short_drama_projects').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('music_voice_clones').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('music_tracks').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('video_studio_projects').where('user_id', '=', localUserId).execute()
    // canvases 删后，canvas_node_outputs / canvas_agent_sessions 通过 canvas_id CASCADE 自动删
    await trx.deleteFrom('canvases').where('user_id', '=', localUserId).execute()

    // ── 3. 任务链：assets → tasks → task_batches（依赖顺序）──────────────────
    // assets.task_id 引用 tasks，先删 assets
    await trx.deleteFrom('assets').where('user_id', '=', localUserId).execute()
    // tasks.task_batch_id 引用 task_batches，先删 tasks
    await trx.deleteFrom('tasks').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('task_batches').where('user_id', '=', localUserId).execute()

    // ── 4. 业管侧（CASCADE，但显式删更可控）+ 无 FK 表 ───────────────────────
    // biz_mgmt_member_bindings / biz_mgmt_a_bean_transactions 是 CASCADE，但显式删
    await trx.deleteFrom('biz_mgmt_a_bean_transactions').where('local_user_id', '=', localUserId).execute()
    await trx.deleteFrom('biz_mgmt_member_bindings').where('local_user_id', '=', localUserId).execute()
    // biz_mgmt_outbox_events.local_user_id 无 FK（纯 uuid），必须手动删
    await trx.deleteFrom('biz_mgmt_outbox_events').where('local_user_id', '=', localUserId).execute()
    // api_clients.system_user_id 无 FK（纯 uuid），手动删避免悬空
    await trx.deleteFrom('api_clients').where('system_user_id', '=', localUserId).execute()

    // ── 5. 工作区 / 团队归属 ────────────────────────────────────────────────
    // workspace_members 是 CASCADE，显式删
    await trx.deleteFrom('workspace_members').where('user_id', '=', localUserId).execute()
    // team_members 是 NO ACTION，必须在 teams 前删
    await trx.deleteFrom('team_members').where('user_id', '=', localUserId).execute()
    // teams.owner_id 是 NO ACTION，team_members 清掉后可删该 user 拥有的团队
    // 注意：只删该 user 作为 owner 的团队；其他 owner 的团队不该被删
    await trx.deleteFrom('teams').where('owner_id', '=', localUserId).execute()
    // workspaces.created_by 是 NO ACTION，删该 user 创建的工作区
    await trx.deleteFrom('workspaces').where('created_by', '=', localUserId).execute()

    // ── 6. 认证类（CASCADE，显式删）+ NO ACTION 表 ──────────────────────────
    await trx.deleteFrom('refresh_tokens').where('user_id', '=', localUserId).execute()
    await trx.deleteFrom('email_verifications').where('user_id', '=', localUserId).execute()
    // user_subscriptions 是 NO ACTION，必须显式删
    await trx.deleteFrom('user_subscriptions').where('user_id', '=', localUserId).execute()

    // ── 7. 最后删 users（所有引用已清除）────────────────────────────────────
    await trx.deleteFrom('users').where('id', '=', localUserId).execute()
  })
}
