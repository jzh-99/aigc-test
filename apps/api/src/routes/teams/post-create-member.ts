import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'
import { generateOneTimePassword } from '../../services/biz-mgmt-member-sync.js'
import { syncTobyMemberSubCard } from '../../lib/toby-open-api.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/create — 公司主卡创建成员（业管副卡同步）。
  // 本地 A 豆上限已废弃：A 豆账户由业管平台管理，创建成员通过 MEMBER-1002 副卡同步建立。
  // 初始密码由后端生成一次性密码（与业管首登 OTP 一致），返回给团长转告，不再写死 123456。
  //
  // 【同步语义，不再走队列】2026-06-30 改造：先同步调业管 MEMBER-1002 创建副卡，
  // 业管返回成功后才写本地 users/team_members/workspaces/workspace_members。
  // 业管失败（1000 参数/验签/业务规则异常、9999 系统异常、网络超时）一律 502 返回，
  // 本地不落任何数据，避免出现「本地有成员但业管侧无 A 豆账户」的脏数据。
  // outbox 事件类型 member_sub_card_sync 及 worker 派发链路保留不动，仅用于消费改造前的遗留 pending 事件。
  app.post<{
    Params: { id: string }
    Body: {
      identifier: string
      username: string
      role?: 'editor' | 'viewer'
      // 新成员的初始 A 豆额度，透传给业管 MEMBER-1002 initialPointsNum。
      // 默认 1000，主卡创建时可在前端编辑（>=0）；A 豆账户实际由业管平台管理。
      initial_points_num?: number
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
          initial_points_num: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      identifier: rawIdentifier,
      username: rawUsername,
      role = 'editor',
      initial_points_num: rawInitialPointsNum,
    } = request.body
    // 业管 MEMBER-1002 约束 initialPointsNum >= 0；未传默认 1000（历史默认值）
    const initialPointsNum = Math.max(0, Math.trunc(rawInitialPointsNum ?? 1000))
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
    // 业管失败（1000/9999/超时）一律 502 直接返回，本地不留任何痕迹。
    // ownerBinding.biz_mgmt_user_id 作为副卡的 belongId（所属公司主卡会员编号）。
    // 幂等性：业管侧按 phone+belongId 判重，同一手机号重复创建会返回业务错误（已被上方 existingUser 拦截本地重复）。
    try {
      const tobyRes = await syncTobyMemberSubCard({
        phone: identifier,
        userName: username,
        belongId: ownerBinding.biz_mgmt_user_id,
        initialPointsNum,
      })
      if (tobyRes.code !== '0000') {
        request.log.error({ tobyRes, phone: identifier }, '[create-member] 业管副卡创建返回非成功，准备 502 返回')
        // 业管返回非成功（参数错/业务规则错/系统异常）：记录并 502 返回，不落库
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

    return reply.status(201).send({
      user_id: userId,
      username,
      workspace_id: workspace.id,
      workspace_name: workspaceName,
      account: identifier,
      // 仅全新用户返回一次性密码让团长转告；已存在用户保留原密码，不回传。
      one_time_password: existingUser ? null : oneTimePassword,
      created_new_user: !existingUser,
      // 回传本次为该成员配置的初始 A 豆额度（已透传给业管 MEMBER-1002）
      initial_points_num: initialPointsNum,
    })
  })
}

export default route
