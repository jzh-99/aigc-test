import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'
import { enqueueBizMgmtOutboxEvent } from '../../services/biz-mgmt-outbox.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/create — 创建单个成员（设置默认密码）
  app.post<{
    Params: { id: string }
    Body: {
      identifier: string
      username: string
      role?: 'editor' | 'viewer'
      credit_quota?: number
      default_password: string
    }
  }>('/teams/:id/members/create', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'username', 'default_password'],
        properties: {
          identifier: { type: 'string', pattern: '^\\d{11}$', minLength: 11, maxLength: 11 },
          username: { type: 'string', minLength: 2, maxLength: 30 },
          role: { type: 'string', enum: ['editor', 'viewer'] },
          credit_quota: { type: 'number', minimum: 0, maximum: 1000000 },
          default_password: { type: 'string', minLength: 6, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      identifier: rawIdentifier,
      username: rawUsername,
      role = 'editor',
      credit_quota = 1000,
      default_password,
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

    // 哈希密码
    const passwordHash = await bcrypt.hash(default_password, 10)

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
        credit_quota,
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

    // 通知业管为新成员创建会员副卡（MEMBER-1002），使其在业管侧获得 A 豆账户。
    // belongId 取团长（当前操作 owner）当前选中的业管会员 ID；若团长尚未绑定业管身份，
    // 则不写入 outbox（成员后续登录时由 member-sync 兜底绑定）。
    const [teamInfo, ownerBinding] = await Promise.all([
      db.selectFrom('teams').select('name').where('id', '=', teamId).executeTakeFirst(),
      db
        .selectFrom('biz_mgmt_member_bindings')
        .select('biz_mgmt_user_id')
        .where('local_user_id', '=', request.user.id)
        .where('is_selected', '=', true)
        .where('status', '=', 1)
        .executeTakeFirst(),
    ])

    if (teamInfo && ownerBinding) {
      // 幂等键：同一团队+成员+手机号重复创建复用同一 outbox 事件
      const dedupeKey = `member-sub-card:${teamId}:${userId}:${identifier}`
      await enqueueBizMgmtOutboxEvent({
        eventType: 'member_sub_card_sync',
        dedupeKey,
        localUserId: userId,
        bizMgmtUserId: ownerBinding.biz_mgmt_user_id,
        phone: identifier,
        teamId,
        pointsNum: 0,
        payload: {
          phone: identifier,
          userName: username,
          compName: teamInfo.name,
          channel: 'aihub',
          belongId: ownerBinding.biz_mgmt_user_id,
          initialPointsNum: 0,
        },
      })
    }

    return reply.status(201).send({
      user_id: userId,
      username,
      workspace_id: workspace.id,
      workspace_name: workspaceName,
      account: identifier,
    })
  })
}

export default route
