import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'
import { generateOneTimePassword } from '../../services/biz-mgmt-member-sync.js'
import { syncTobyMemberSubCard } from '../../lib/toby-open-api.js'
import { sql } from 'kysely'
import { fetchBizMgmtMembersByPhone } from '../../services/biz-mgmt-member-sync.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/create — 公司主卡创建成员（业管副卡同步）。
  // A 豆账户由业管平台管理，创建成员通过 MEMBER-1002 副卡同步建立；
  // 副卡创建后不再支持配置初始 A 豆额度（初始额度由业管侧规则决定）。
  // 初始密码由后端生成一次性密码（与业管首登 OTP 一致），返回给团长转告，不再写死 123456。
  //
  // 【同步语义，不再走队列】2026-06-30 改造：先同步调业管 MEMBER-1002 创建副卡，
  // 业管返回成功（或返回「会员已存在」）后才写本地 users/team_members/workspaces/workspace_members。
  // 业管真正的失败（1000 参数/验签/业务规则异常、9999 系统异常、网络超时）一律 502 返回，
  // 本地不落任何数据，避免出现「本地有成员但业管侧无 A 豆账户」的脏数据。
  // 业管返回「会员已存在」（message 命中关键字）时视为成功，继续落本地数据，
  // 并调 MEMBER-1001 补查副卡 userId 写入 biz_mgmt_member_bindings（省去主卡手动同步）。
  // outbox 事件类型 member_sub_card_sync 及 worker 派发链路保留不动，仅用于消费改造前的遗留 pending 事件。
  app.post<{
    Params: { id: string }
    Body: {
      identifier: string
      username: string
      role?: 'editor' | 'viewer'
    }
  }>('/teams/:id/members/create', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'username'],
        properties: {
          identifier: { type: 'string', pattern: '^\\d{11}$', minLength: 11, maxLength: 11 },
          username: { type: 'string', minLength: 2, maxLength: 30 },
          role: { type: 'string', enum: ['editor', 'viewer'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      identifier: rawIdentifier,
      username: rawUsername,
      role = 'editor',
    } = request.body
    const teamId = request.params.id
    const db = getDb()

    const identifier = rawIdentifier.trim()
    const requestedUsername = rawUsername.trim()
    if (!identifier) {
      return reply.badRequest('账号不能为空')
    }

    if (!/^\d{11}$/.test(identifier)) {
      return reply.badRequest('手机号必须是 11 位数字')
    }

    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,30}$/.test(requestedUsername)) {
      return reply.badRequest('用户名需为 2-30 位中文、字母、数字、下划线或横线')
    }

    // ── 公司主卡门控（先于任何数据写入，避免拒绝时留下孤儿成员/工作区）────────
    // 业管文档约束「副卡按公司会员创建」，只有公司主卡（user_type=2 且 is_master=true）
    // 才能创建成员并触发 MEMBER-1002。当前操作者当前选中的业管身份必须满足公司主卡。
    // teamRoleGuard('owner') 已在 preHandler 拦截非 owner；此为业务侧权威二次校验。
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
          message: '当前身份非公司主卡，无法创建成员。请切换到公司主卡身份后重试。',
        },
      })
    }

    // 检查用户是否已存在
    const existingUser = await db
      .selectFrom('users')
      .select(['id', 'account', 'username'])
      .where('phone', '=', identifier)
      .executeTakeFirst()

    if (existingUser) {
      // 检查是否已是团队成员
      const isMember = await db
        .selectFrom('team_members')
        .select('user_id')
        .where('team_id', '=', teamId)
        .where('user_id', '=', existingUser.id)
        .executeTakeFirst()

      if (isMember) {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_MEMBER', message: '该用户已是团队成员' },
        })
      }
    }

    let username = requestedUsername
    if (!existingUser) {
      const existingUsername = await db
        .selectFrom('users')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst()
      if (existingUsername) {
        return reply.status(409).send({
          success: false,
          error: { code: 'USERNAME_EXISTS', message: '用户名已存在' },
        })
      }
    } else {
      username = existingUser.username
    }

    // 生成一次性初始密码（仅对全新用户使用，与业管首登 OTP 生成逻辑一致）。
    // 已存在的本地用户保留其原密码，不重置——创建成员只补团队关系，不改账号凭证。
    const oneTimePassword = generateOneTimePassword()
    const passwordHash = await bcrypt.hash(oneTimePassword, 10)

    // ── 同步调业管创建会员副卡（MEMBER-1002），成功才落本地数据 ──────────────
    // 这是本次改造的核心：业管副卡创建放最前，任何本地数据都还没写。
    // ownerBinding.biz_mgmt_user_id 作为副卡的 belongId（所属公司主卡会员编号）。
    //
    // 业管返回分三种：
    // 1) code=0000：副卡新建成功。业管响应回传副卡 userId，直接写入 biz_mgmt_member_bindings，
    //    本地账号立即与业管副卡绑定（A 豆余额可查、可变更）。
    // 2) code!=0000 且 message 命中「已存在」关键字：业管侧该副卡早已存在，但响应不回传 userId。
    //    此时视为成功继续落本地，并调 MEMBER-1001 补查副卡 userId 再写绑定（省去主卡手动同步）。
    //    原始 bizCode 一并 log，便于后续收敛为精确码值判断。
    // 3) 其余非 0000（参数错/验签/业务规则/9999 系统异常/网络超时）：一律 502 返回，本地不留任何痕迹。
    //
    // 【为什么必须写 binding】本地 user 与业管副卡 biz_mgmt_user_id 不绑定的话，成员列表会显示
    // 「未同步」、A 豆余额查不到、A 豆变更按钮不出现 —— 即「新建账号与业管账号对不上、A 豆没了」。
    let memberAlreadyExists = false
    // 业管副卡会员编号：0000 时取响应 userId；「已存在」时留空，后续用 MEMBER-1001 补查。
    let subBizMgmtUserId: string | null = null
    try {
      const tobyRes = await syncTobyMemberSubCard({
        phone: identifier,
        userName: username,
        belongId: ownerBinding.biz_mgmt_user_id,
      })
      if (tobyRes.code !== '0000') {
        // 业管「会员已存在」识别：按 message 文案判断（业管该错误未约定稳定业务码）。
        // 命中关键字则走补建分支；否则按真正的业务失败 502 返回，不落库。
        const alreadyExists = /已存在|已注册|已经存在/.test(tobyRes.message || '')
        if (alreadyExists) {
          memberAlreadyExists = true
          request.log.info(
            { bizCode: tobyRes.code, bizMessage: tobyRes.message, phone: identifier },
            '[create-member] 业管返回会员已存在，走补建本地用户分支',
          )
        } else {
          request.log.error({ tobyRes, phone: identifier }, '[create-member] 业管副卡创建返回非成功，准备 502 返回')
          request.log.warn(
            { bizCode: tobyRes.code, bizMessage: tobyRes.message, phone: identifier },
            '[create-member] 业管副卡创建未成功，本地不落库',
          )
          return reply.status(502).send({
            success: false,
            error: {
              code: 'BIZ_MGMT_SUBCARD_FAILED',
              message: tobyRes.message || '业管副卡创建失败',
            },
          })
        }
      } else {
        // 业管 0000：取响应回传的副卡 userId，供后续直接写 binding。
        subBizMgmtUserId = tobyRes.decryptedData?.userId ?? null
        if (!subBizMgmtUserId) {
          request.log.warn(
            { phone: identifier },
            '[create-member] 业管 0000 但未回传副卡 userId，将用 MEMBER-1001 补查',
          )
        }
      }
    } catch (err) {
      // 网络异常/超时/解密失败：502 返回，不落库
      request.log.error({ err, phone: identifier }, '[create-member] 业管副卡创建调用异常')
      return reply.status(502).send({
        success: false,
        error: {
          code: 'BIZ_MGMT_SUBCARD_UNREACHABLE',
          message: err instanceof Error ? err.message : '业管接口调用失败',
        },
      })
    }

    // 业管副卡已创建成功，下面开始写本地数据（users → team_members → workspaces → workspace_members）。

    // 如果用户不存在则创建
    let userId: string
    if (!existingUser) {
      const newUser = await db
        .insertInto('users')
        .values({
          account: identifier,
          email: null,
          phone: identifier,
          username,
          password_hash: passwordHash,
          role: 'member',
          status: 'active',
          plan_tier: 'free',
          password_change_required: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      userId = newUser.id
    } else {
      userId = existingUser.id
    }

    // 加入团队
    await db
      .insertInto('team_members')
      .values({
        team_id: teamId,
        user_id: userId,
        role,
      })
      .execute()

    // 创建个人工作区
    const workspaceName = `${username}工作区`
    const workspace = await db
      .insertInto('workspaces')
      .values({
        team_id: teamId,
        name: workspaceName,
        created_by: request.user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    // 将用户加入工作区
    const wsRole = role === 'viewer' ? 'viewer' : 'editor'
    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: workspace.id,
        user_id: userId,
        role: wsRole,
      })
      .execute()

    // 将 owner 也加入工作区（admin 角色）
    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: workspace.id,
        user_id: request.user.id,
        role: 'admin',
      })
      .execute()

    // ── 写入副卡业管绑定 biz_mgmt_member_bindings ──────────────────────────────
    // 关键：本地 user 必须与业管副卡 biz_mgmt_user_id 绑定，否则成员列表显示「未同步」、
    // A 豆余额查不到、A 豆变更按钮不出现（即「新建账号与业管账号对不上、A 豆没了」）。
    //
    // 业管 0000 成功时 subBizMgmtUserId 已就绪；「已存在」或 0000 未回传 userId 时为空。
    // 统一用 MEMBER-1001 按手机号补查拿完整身份（含 comp_name 等非空字段）：
    // - 有已知 userId → 精确匹配该副卡（避免一手机号多副卡取错）；
    // - 无已知 userId → 按「公司副卡（userType=2 且 !isMaster 且 status=1）」筛选。
    // 绑定指向刚创建的 team/workspace（不重复建团队）。补查/写入失败不阻断本次创建（本地数据已落），
    // 仅 log；主卡仍可后续用「同步业管身份」按钮兜底。
    try {
      const members = await fetchBizMgmtMembersByPhone(identifier)
      const subMember = subBizMgmtUserId
        ? members.find((m) => m.bizMgmtUserId === subBizMgmtUserId)
        : members.find((m) => m.userType === '2' && !m.isMaster && m.status === 1)

      if (subMember) {
        await db
          .insertInto('biz_mgmt_member_bindings')
          .values({
            local_user_id: userId,
            biz_mgmt_user_id: subMember.bizMgmtUserId,
            phone: subMember.phone,
            user_name: subMember.userName,
            user_type: subMember.userType,
            status: subMember.status,
            is_master: subMember.isMaster,
            comp_name: subMember.compName,
            goods_id: subMember.goodsId,
            goods_name: subMember.goodsName,
            biz_mgmt_created_at: subMember.bizMgmtCreatedAt
              ? sql`${subMember.bizMgmtCreatedAt}::timestamptz`
              : null,
            team_id: teamId,
            workspace_id: workspace.id,
            last_synced_at: sql`now()`,
            updated_at: sql`now()`,
          })
          .onConflict((oc) =>
            oc.column('biz_mgmt_user_id').doUpdateSet({
              local_user_id: userId,
              phone: subMember.phone,
              user_name: subMember.userName,
              user_type: subMember.userType,
              status: subMember.status,
              is_master: subMember.isMaster,
              comp_name: subMember.compName,
              goods_id: subMember.goodsId,
              goods_name: subMember.goodsName,
              biz_mgmt_created_at: subMember.bizMgmtCreatedAt
                ? sql`${subMember.bizMgmtCreatedAt}::timestamptz`
                : null,
              team_id: teamId,
              workspace_id: workspace.id,
              last_synced_at: sql`now()`,
              updated_at: sql`now()`,
            }),
          )
          .execute()
        request.log.info(
          { bizMgmtUserId: subMember.bizMgmtUserId, alreadyExists: memberAlreadyExists, phone: identifier },
          '[create-member] 副卡业管绑定写入成功',
        )
      } else {
        request.log.warn(
          { phone: identifier, memberCount: members.length, knownUserId: subBizMgmtUserId },
          '[create-member] 未找到对应副卡身份，跳过绑定写入（可后续手动同步）',
        )
      }
    } catch (err) {
      request.log.error({ err, phone: identifier }, '[create-member] 补查/写入副卡绑定失败，不阻断创建')
    }

    return reply.status(201).send({
      user_id: userId,
      username,
      workspace_id: workspace.id,
      workspace_name: workspaceName,
      account: identifier,
      // 仅全新用户返回一次性密码让团长转告；已存在用户保留原密码，不回传。
      one_time_password: existingUser ? null : oneTimePassword,
      created_new_user: !existingUser,
      // 业管「会员已存在」时为 true，前端可据此提示「该手机号在业管已有会员，已直接加入」。
      biz_mgmt_member_already_exists: memberAlreadyExists,
    })
  })
}

export default route
