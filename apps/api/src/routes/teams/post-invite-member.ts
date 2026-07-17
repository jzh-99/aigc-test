import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import crypto from 'node:crypto'
import { teamRoleGuard } from '../../plugins/guards.js'
import type { InviteMemberRequest, TeamMemberRole } from '@aigc/types'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members — 通过邮箱或手机号邀请成员
  app.post<{ Params: { id: string }; Body: InviteMemberRequest }>('/teams/:id/members', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          phone: { type: 'string', maxLength: 20 },
          role: { type: 'string', enum: ['editor', 'viewer', 'admin', 'owner'] },
          workspace_id: { type: 'string', format: 'uuid' },
          new_workspace_name: { type: 'string', maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const email = request.body.email?.trim()
    const phone = request.body.phone?.trim()
    const { role, workspace_id, new_workspace_name } = request.body

    if (!email && !phone) {
      return reply.badRequest('必须提供邮箱或手机号')
    }

    // 手机号必须是 11 位数字
    if (phone && !/^\d{11}$/.test(phone)) {
      return reply.badRequest('手机号必须是 11 位数字')
    }

    const memberRole: TeamMemberRole = (role as TeamMemberRole) ?? 'editor'

    const db = getDb()
    const teamId = request.params.id

    // 解析目标工作区
    let targetWsId: string | null = null
    if (new_workspace_name) {
      const ws = await db
        .insertInto('workspaces')
        .values({
          team_id: teamId,
          name: new_workspace_name,
          created_by: request.user.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      targetWsId = ws.id

      // 将 owner 也加入新工作区
      await db
        .insertInto('workspace_members')
        .values({
          workspace_id: targetWsId,
          user_id: request.user.id,
          role: 'admin',
        })
        .execute()
    } else if (workspace_id) {
      // 验证工作区属于此团队
      const ws = await db
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', workspace_id)
        .where('team_id', '=', teamId)
        .executeTakeFirst()
      if (!ws) return reply.badRequest('工作区不存在或不属于此团队')
      targetWsId = ws.id
    }

    // 检查用户是否已存在
    let user = await db
      .selectFrom('users')
      .select(['id', 'email', 'phone'])
      .$if(!!email, (qb) => qb.where('email', '=', email!))
      .$if(!email && !!phone, (qb) => qb.where('phone', '=', phone!))
      .executeTakeFirst()

    const identifier = email ?? phone!

    if (!user) {
      // 创建占位用户
      const account = identifier
      const username = email ? email.split('@')[0] : phone!.slice(-4)
      const result = await db
        .insertInto('users')
        .values({
          account,
          email: email ?? null,
          phone: phone ?? null,
          username,
          password_hash: '',  // 占位，接受邀请时填充
          role: 'member',
          status: 'suspended',  // 未激活，直到接受邀请
          plan_tier: 'free',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      user = { id: result.id, email: email ?? null, phone: phone ?? null }
    }

    // 检查是否已是团队成员
    const existing = await db
      .selectFrom('team_members')
      .select('user_id')
      .where('team_id', '=', teamId)
      .where('user_id', '=', user.id)
      .executeTakeFirst()

    if (existing) {
      // 如果用户尚未接受邀请（suspended），允许重新生成邀请
      const targetUser = await db
        .selectFrom('users')
        .select(['id', 'status'])
        .where('id', '=', user.id)
        .executeTakeFirst()

      if (targetUser?.status === 'suspended') {
        // 作废旧邀请 token
        await db
          .updateTable('email_verifications')
          .set({ used_at: sql`NOW()` })
          .where('user_id', '=', user.id)
          .where('used_at', 'is', null)
          .execute()

        const inviteToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex')

        await db
          .insertInto('email_verifications')
          .values({
            user_id: user.id,
            token_hash: tokenHash,
            type: 'verify_email',
            expires_at: sql`NOW() + INTERVAL '7 days'`,
          })
          .execute()

        return reply.status(200).send({
          user_id: user.id,
          email: user.email,
          phone: user.phone,
          role: memberRole,
          invite_token: inviteToken, // SECURITY: 邮件服务直接发送 token 后移除此字段
          regenerated: true,
        })
      }

      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_MEMBER', message: '该用户已是团队成员' },
      })
    }

    // 加入团队
    await db
      .insertInto('team_members')
      .values({
        team_id: teamId,
        user_id: user.id,
        role: memberRole,
        credit_quota: 1000,
      })
      .execute()

    // 加入工作区
    if (targetWsId) {
      await db
        .insertInto('workspace_members')
        .values({
          workspace_id: targetWsId,
          user_id: user.id,
          role: memberRole === 'owner' ? 'admin' : memberRole === 'viewer' ? 'viewer' : 'editor',
        })
        .execute()
    }

    // 创建邀请 token
    const inviteToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex')

    await db
      .insertInto('email_verifications')
      .values({
        user_id: user.id,
        token_hash: tokenHash,
        type: 'verify_email',
        expires_at: sql`NOW() + INTERVAL '7 days'`,
      })
      .execute()

    return reply.status(201).send({
      user_id: user.id,
      email: user.email,
      phone: user.phone,
      role: memberRole,
      invite_token: inviteToken, // SECURITY: 邮件服务直接发送 token 后移除此字段
    })
  })
}

export default route
