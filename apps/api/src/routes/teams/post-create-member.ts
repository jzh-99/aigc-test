import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/create — 创建单个成员（设置默认密码）
  app.post<{
    Params: { id: string }
    Body: {
      identifier: string
      role?: 'editor' | 'viewer'
      credit_quota?: number
      default_password: string
    }
  }>('/teams/:id/members/create', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'default_password'],
        properties: {
          identifier: { type: 'string', maxLength: 254 },
          role: { type: 'string', enum: ['editor', 'viewer'] },
          credit_quota: { type: 'number', minimum: 0, maximum: 1000000 },
          default_password: { type: 'string', minLength: 6, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { identifier: rawIdentifier, role = 'editor', credit_quota = 1000, default_password } = request.body
    const teamId = request.params.id
    const db = getDb()

    const identifier = rawIdentifier.trim()
    if (!identifier) {
      return reply.badRequest('账号不能为空')
    }

    // 判断是邮箱还是手机号
    const isEmail = identifier.includes('@')
    const isPhone = /^\d{11}$/.test(identifier)

    if (!isEmail && !isPhone) {
      return reply.badRequest('格式错误（需要邮箱或11位手机号）')
    }

    // 检查用户是否已存在
    const existingUser = await db
      .selectFrom('users')
      .select(['id', 'account'])
      .$if(isEmail, (qb) => qb.where('email', '=', identifier))
      .$if(isPhone, (qb) => qb.where('phone', '=', identifier))
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

    // 生成唯一用户名
    const baseUsername = isEmail ? identifier.split('@')[0] : identifier.slice(-4)
    let username = baseUsername
    let suffix = 1
    while (true) {
      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst()
      if (!existing) break
      username = `${baseUsername}_${suffix++}`
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
          email: isEmail ? identifier : null,
          phone: isPhone ? identifier : null,
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
