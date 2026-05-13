import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import type { CreateTeamRequest } from '@aigc/types'

// POST /admin/teams — 创建团队 + 组长用户 + 积分账户 + 默认工作区
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateTeamRequest }>('/admin/teams', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          owner_email: { type: 'string', format: 'email', maxLength: 254 },
          owner_phone: { type: 'string', maxLength: 20 },
          owner_username: { type: 'string', maxLength: 50 },
          owner_password: { type: 'string', minLength: 8, maxLength: 72 },
          initial_credits: { type: 'integer', minimum: 0, maximum: 10000000 },
          team_type: { type: 'string', enum: ['standard', 'company_a', 'avatar_enabled'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, owner_username, owner_password, initial_credits, team_type } = request.body
    const owner_email = request.body.owner_email?.trim()
    const owner_phone = request.body.owner_phone?.trim()

    if (!owner_email && !owner_phone) {
      return reply.badRequest('必须提供 owner_email 或 owner_phone')
    }
    if (owner_phone && !/^\d{11}$/.test(owner_phone)) {
      return reply.badRequest('手机号必须是 11 位数字')
    }

    const db = getDb()

    const existingTeam = await db
      .selectFrom('teams')
      .select('id')
      .where('name', '=', name)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (existingTeam) {
      return reply.status(409).send({
        success: false,
        error: { code: 'TEAM_NAME_TAKEN', message: `已有同名团队"${name}"，请换一个名称` },
      })
    }

    let owner = await db
      .selectFrom('users')
      .select(['id', 'account', 'username', 'status'])
      .$if(!!owner_email, (qb) => qb.where('email', '=', owner_email!))
      .$if(!owner_email && !!owner_phone, (qb) => qb.where('phone', '=', owner_phone!))
      .executeTakeFirst()

    const ownerWasExisting = !!owner

    if (!owner) {
      if (!owner_password || owner_password.length < 8) {
        return reply.badRequest('新用户需要提供至少 8 位的 owner_password')
      }
      const passwordHash = await bcrypt.hash(owner_password, 12)
      const account = owner_email ?? owner_phone!
      const defaultUsername = owner_email
        ? owner_email.split('@')[0]
        : owner_phone!.slice(-4)

      const result = await db
        .insertInto('users')
        .values({
          account,
          email: owner_email ?? null,
          phone: owner_phone ?? null,
          username: owner_username ?? defaultUsername,
          password_hash: passwordHash,
          role: 'member',
          status: 'active',
          plan_tier: 'free',
        })
        .returning(['id', 'account', 'username'])
        .executeTakeFirstOrThrow()
      owner = { id: result.id, account: result.account, username: result.username, status: 'active' }
    } else {
      const updates: Record<string, unknown> = {}
      if (owner.status === 'suspended') updates.status = 'active'
      if (owner_password && owner_password.length >= 8) {
        updates.password_hash = await bcrypt.hash(owner_password, 12)
      }
      if (Object.keys(updates).length > 0) {
        await db.updateTable('users').set(updates).where('id', '=', owner.id).execute()
      }
    }

    const existingOwnership = await db
      .selectFrom('teams')
      .select('id')
      .where('owner_id', '=', owner.id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (existingOwnership) {
      return reply.status(409).send({
        success: false,
        error: { code: 'USER_ALREADY_OWNER', message: '该用户已是其他团队的组长，同一账号只能担任一个团队的组长' },
      })
    }

    const team = await db
      .insertInto('teams')
      .values({
        name,
        owner_id: owner.id,
        plan_tier: 'free',
        team_type: team_type ?? 'standard',
      })
      .returning(['id', 'name', 'created_at'])
      .executeTakeFirstOrThrow()

    await db.insertInto('team_members').values({ team_id: team.id, user_id: owner.id, role: 'owner' }).execute()

    await db.insertInto('credit_accounts').values({
      owner_type: 'team',
      team_id: team.id,
      balance: initial_credits ?? 0,
    }).execute()

    const workspace = await db
      .insertInto('workspaces')
      .values({ team_id: team.id, name: '默认工作区', created_by: owner.id })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow()

    await db.insertInto('workspace_members').values({
      workspace_id: workspace.id,
      user_id: owner.id,
      role: 'admin',
    }).execute()

    if (initial_credits && initial_credits > 0) {
      const creditAccount = await db
        .selectFrom('credit_accounts')
        .select('id')
        .where('team_id', '=', team.id)
        .where('owner_type', '=', 'team')
        .executeTakeFirstOrThrow()

      await db.insertInto('credits_ledger').values({
        credit_account_id: creditAccount.id,
        user_id: request.user.id,
        amount: initial_credits,
        type: 'topup',
        description: 'Initial team credits',
      }).execute()
    }

    return reply.status(201).send({
      team,
      owner: { id: owner.id, account: owner.account, username: owner.username, existing: ownerWasExisting },
      workspace: { id: workspace.id, name: workspace.name },
    })
  })
}

export default route
