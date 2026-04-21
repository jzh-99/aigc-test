import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../plugins/guards.js'
import type { InviteMemberRequest, UpdateQuotaRequest, TeamMemberRole } from '@aigc/types'
import rateLimit from '@fastify/rate-limit'

export async function teamRoutes(app: FastifyInstance): Promise<void> {

  // Rate limit invite endpoint: 20 invites per hour per user
  await app.register(rateLimit, {
    max: 20,
    timeWindow: '1 hour',
    keyGenerator: (request) => `invite:${request.user?.id ?? request.ip}`,
    errorResponseBuilder: () => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: '邀请操作过于频繁，请稍后再试' },
    }),
  })

  // Rate limit batch invite endpoint: 15 batch operations per hour per user
  await app.register(rateLimit, {
    max: 15,
    timeWindow: '1 hour',
    keyGenerator: (request) => `batch-invite:${request.user?.id ?? request.ip}`,
    errorResponseBuilder: () => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: '批量添加操作过于频繁，请稍后再试' },
    }),
  })

  // GET /teams/:id — team info + members + credit balance
  app.get<{ Params: { id: string } }>('/teams/:id', {
    preHandler: teamRoleGuard('editor'),
    config: { rateLimit: false },
  }, async (request) => {
    const db = getDb()
    const team = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id', 'plan_tier', 'created_at', 'allow_member_topup'])
      .where('id', '=', request.params.id)
      .executeTakeFirstOrThrow()

    const members = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select([
        'users.id as user_id', 'users.account', 'users.username', 'users.avatar_url',
        'team_members.role', 'team_members.credit_quota', 'team_members.credit_used',
        'team_members.quota_period', 'team_members.quota_reset_at', 'team_members.joined_at',
        'team_members.priority_boost',
      ])
      .where('team_members.team_id', '=', request.params.id)
      .execute()

    const creditAccount = await db
      .selectFrom('credit_accounts')
      .select(['balance', 'frozen_credits', 'total_earned', 'total_spent'])
      .where('owner_type', '=', 'team')
      .where('team_id', '=', request.params.id)
      .executeTakeFirst()

    return { ...team, members, credits: creditAccount ?? { balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 } }
  })

  // POST /teams/:id/members — invite member by email or phone
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

    // Validate phone: exactly 11 digits
    if (phone && !/^\d{11}$/.test(phone)) {
      return reply.badRequest('手机号必须是 11 位数字')
    }

    const memberRole: TeamMemberRole = (role as TeamMemberRole) ?? 'editor'

    const db = getDb()
    const teamId = request.params.id

    // Resolve target workspace
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

      // Add the owner to the new workspace too
      await db
        .insertInto('workspace_members')
        .values({
          workspace_id: targetWsId,
          user_id: request.user.id,
          role: 'admin',
        })
        .execute()
    } else if (workspace_id) {
      // Verify workspace belongs to this team
      const ws = await db
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', workspace_id)
        .where('team_id', '=', teamId)
        .executeTakeFirst()
      if (!ws) return reply.badRequest('工作区不存在或不属于此团队')
      targetWsId = ws.id
    }

    // Check if user already exists
    let user = await db
      .selectFrom('users')
      .select(['id', 'email', 'phone'])
      .$if(!!email, (qb) => qb.where('email', '=', email!))
      .$if(!email && !!phone, (qb) => qb.where('phone', '=', phone!))
      .executeTakeFirst()

    const identifier = email ?? phone!

    if (!user) {
      // Create placeholder user
      const account = identifier
      const username = email ? email.split('@')[0] : phone!.slice(-4)
      const result = await db
        .insertInto('users')
        .values({
          account,
          email: email ?? null,
          phone: phone ?? null,
          username,
          password_hash: '',  // placeholder, filled on accept-invite
          role: 'member',
          status: 'suspended',  // inactive until invite accepted
          plan_tier: 'free',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      user = { id: result.id, email: email ?? null, phone: phone ?? null }
    }

    // Check if already a team member
    const existing = await db
      .selectFrom('team_members')
      .select('user_id')
      .where('team_id', '=', teamId)
      .where('user_id', '=', user.id)
      .executeTakeFirst()

    if (existing) {
      // If user hasn't accepted invite yet (suspended), allow regenerating the invite
      const targetUser = await db
        .selectFrom('users')
        .select(['id', 'status'])
        .where('id', '=', user.id)
        .executeTakeFirst()

      if (targetUser?.status === 'suspended') {
        // Invalidate old invite tokens before creating a new one
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
          invite_token: inviteToken, // SECURITY: Remove once email service sends tokens directly
          regenerated: true,
        })
      }

      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_MEMBER', message: '该用户已是团队成员' },
      })
    }

    // Add to team
    await db
      .insertInto('team_members')
      .values({
        team_id: teamId,
        user_id: user.id,
        role: memberRole,
        credit_quota: 1000,
      })
      .execute()

    // Add to workspace
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

    // Create invite token
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
      invite_token: inviteToken, // SECURITY: Remove once email service sends tokens directly
    })
  })

  // POST /teams/:id/members/create — create single member with default password (aligned with batch)
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

    // Determine if email or phone
    const isEmail = identifier.includes('@')
    const isPhone = /^\d{11}$/.test(identifier)

    if (!isEmail && !isPhone) {
      return reply.badRequest('格式错误（需要邮箱或11位手机号）')
    }

    // Check if user already exists
    const existingUser = await db
      .selectFrom('users')
      .select(['id', 'account'])
      .$if(isEmail, (qb) => qb.where('email', '=', identifier))
      .$if(isPhone, (qb) => qb.where('phone', '=', identifier))
      .executeTakeFirst()

    if (existingUser) {
      // Check if already a team member
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

    // Generate username
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

    // Hash password
    const passwordHash = await bcrypt.hash(default_password, 10)

    // Create user if not exists
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

    // Add to team
    await db
      .insertInto('team_members')
      .values({
        team_id: teamId,
        user_id: userId,
        role,
        credit_quota,
      })
      .execute()

    // Create personal workspace
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

    // Add user to workspace
    const wsRole = role === 'viewer' ? 'viewer' : 'editor'
    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: workspace.id,
        user_id: userId,
        role: wsRole,
      })
      .execute()

    // Also add owner to workspace as admin
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

  // POST /teams/:id/members/batch — batch create members with default password
  app.post<{
    Params: { id: string }
    Body: {
      identifiers: string[]
      role?: 'editor' | 'viewer'
      credit_quota?: number
      default_password: string
    }
  }>('/teams/:id/members/batch', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['identifiers', 'default_password'],
        properties: {
          identifiers: {
            type: 'array',
            items: { type: 'string', maxLength: 254 },
            minItems: 1,
            maxItems: 50,
          },
          role: { type: 'string', enum: ['editor', 'viewer'] },
          credit_quota: { type: 'number', minimum: 0, maximum: 1000000 },
          default_password: { type: 'string', minLength: 6, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { identifiers, role = 'editor', credit_quota = 1000, default_password } = request.body
    const teamId = request.params.id
    const db = getDb()

    // Hash password once for all users
    const passwordHash = await bcrypt.hash(default_password, 10)

    interface BatchResult {
      identifier: string
      status: 'success' | 'failed' | 'exists'
      user_id?: string
      workspace_id?: string
      workspace_name?: string
      username?: string
      error?: string
    }

    const results: BatchResult[] = []
    let successCount = 0
    let failedCount = 0
    let existsCount = 0

    // Helper: generate unique username
    async function generateUsername(baseUsername: string): Promise<string> {
      let username = baseUsername
      let suffix = 1
      while (true) {
        const existing = await db
          .selectFrom('users')
          .select('id')
          .where('username', '=', username)
          .executeTakeFirst()
        if (!existing) return username
        username = `${baseUsername}_${suffix++}`
      }
    }

    // Process each identifier
    for (const rawIdentifier of identifiers) {
      const identifier = rawIdentifier.trim()
      if (!identifier) {
        results.push({ identifier, status: 'failed', error: '标识符为空' })
        failedCount++
        continue
      }

      try {
        // Determine if email or phone
        const isEmail = identifier.includes('@')
        const isPhone = /^\d{11}$/.test(identifier)

        if (!isEmail && !isPhone) {
          results.push({ identifier, status: 'failed', error: '格式错误（需要邮箱或11位手机号）' })
          failedCount++
          continue
        }

        // Check if user already exists
        let existingUser = await db
          .selectFrom('users')
          .select(['id', 'account'])
          .$if(isEmail, (qb) => qb.where('email', '=', identifier))
          .$if(isPhone, (qb) => qb.where('phone', '=', identifier))
          .executeTakeFirst()

        if (existingUser) {
          // Check if already a team member
          const isMember = await db
            .selectFrom('team_members')
            .select('user_id')
            .where('team_id', '=', teamId)
            .where('user_id', '=', existingUser.id)
            .executeTakeFirst()

          if (isMember) {
            results.push({ identifier, status: 'exists', user_id: existingUser.id, error: '已是团队成员' })
            existsCount++
            continue
          }
        }

        // Generate username
        const baseUsername = isEmail ? identifier.split('@')[0] : identifier.slice(-4)
        const username = await generateUsername(baseUsername)

        // Create user if not exists
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

        // Add to team
        await db
          .insertInto('team_members')
          .values({
            team_id: teamId,
            user_id: userId,
            role,
            credit_quota,
          })
          .execute()

        // Create personal workspace
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

        // Add user to workspace
        const wsRole = role === 'viewer' ? 'viewer' : 'editor'
        await db
          .insertInto('workspace_members')
          .values({
            workspace_id: workspace.id,
            user_id: userId,
            role: wsRole,
          })
          .execute()

        // Also add owner to workspace as admin
        await db
          .insertInto('workspace_members')
          .values({
            workspace_id: workspace.id,
            user_id: request.user.id,
            role: 'admin',
          })
          .execute()

        results.push({
          identifier,
          status: 'success',
          user_id: userId,
          workspace_id: workspace.id,
          workspace_name: workspaceName,
          username,
        })
        successCount++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        app.log.error({ identifier, err: errMsg }, 'Batch user creation failed for identifier')
        results.push({ identifier, status: 'failed', error: errMsg.slice(0, 200) })
        failedCount++
      }
    }

    return reply.status(200).send({
      success: successCount,
      failed: failedCount,
      exists: existsCount,
      results,
    })
  })

  // PATCH /teams/:id/members/:uid — update member role, quota, or period
  app.patch<{ Params: { id: string; uid: string }; Body: { role?: string; credit_quota?: number | null; quota_period?: string | null; priority_boost?: boolean } }>('/teams/:id/members/:uid', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const { role, credit_quota, quota_period, priority_boost } = request.body ?? {}
    if (role === undefined && credit_quota === undefined && quota_period === undefined && priority_boost === undefined) {
      return reply.badRequest('At least one field (role, credit_quota, quota_period, priority_boost) is required')
    }

    // Only global admin can set priority_boost
    if (priority_boost !== undefined && request.user.role !== 'admin') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '只有管理员可以设置优先特权' } })
    }

    if (quota_period !== undefined && quota_period !== null && quota_period !== 'weekly' && quota_period !== 'monthly') {
      return reply.badRequest('quota_period must be "weekly", "monthly", or null')
    }

    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (role !== undefined) updates.role = role
    if (credit_quota !== undefined) updates.credit_quota = credit_quota
    if (priority_boost !== undefined) updates.priority_boost = priority_boost
    if (quota_period !== undefined) {
      updates.quota_period = quota_period
      if (quota_period) {
        // Set first reset date based on period
        const now = new Date()
        if (quota_period === 'weekly') {
          updates.quota_reset_at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
        } else {
          updates.quota_reset_at = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
        }
      } else {
        updates.quota_reset_at = null
      }
    }

    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    return { success: true }
  })

  // POST /teams/:id/members/:uid/reset-credits — manually reset member credit_used to 0
  app.post<{ Params: { id: string; uid: string } }>('/teams/:id/members/:uid/reset-credits', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()

    const member = await db
      .selectFrom('team_members')
      .select(['credit_used', 'quota_period'])
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .executeTakeFirst()

    if (!member) return reply.notFound('成员不存在')

    const updates: Record<string, unknown> = { credit_used: 0 }

    // If periodic quota is set, recalculate next reset from now
    if (member.quota_period) {
      const now = new Date()
      if (member.quota_period === 'weekly') {
        updates.quota_reset_at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
      } else {
        updates.quota_reset_at = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
      }
    }

    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    return { success: true, credit_used: 0 }
  })

  // DELETE /teams/:id/members/:uid — remove member
  app.delete<{ Params: { id: string; uid: string } }>('/teams/:id/members/:uid', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()

    // Don't allow removing the owner
    const member = await db
      .selectFrom('team_members')
      .select('role')
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .executeTakeFirst()

    if (!member) return reply.notFound('Member not found')
    if (member.role === 'owner') {
      return reply.status(403).send({
        success: false,
        error: { code: 'CANNOT_REMOVE_OWNER', message: 'Cannot remove the team owner' },
      })
    }

    // Check for in-flight generation tasks
    const pendingBatches = await db
      .selectFrom('task_batches')
      .select(db.fn.count('id').as('count'))
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirstOrThrow()

    if (Number(pendingBatches.count) > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'HAS_PENDING_TASKS',
          message: '该成员有进行中的生成任务，请等待任务完成后再移除',
        },
      })
    }

    // Remove from all workspaces in this team
    const workspaceIds = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', request.params.id)
      .execute()

    if (workspaceIds.length > 0) {
      await db
        .deleteFrom('workspace_members')
        .where('user_id', '=', request.params.uid)
        .where('workspace_id', 'in', workspaceIds.map(w => w.id))
        .execute()
    }

    await db
      .deleteFrom('team_members')
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    // If user has no remaining teams, suspend the account
    const remainingTeams = await db
      .selectFrom('team_members')
      .select(db.fn.count('team_id').as('count'))
      .where('user_id', '=', request.params.uid)
      .executeTakeFirstOrThrow()

    if (Number(remainingTeams.count) === 0) {
      await db
        .updateTable('users')
        .set({ status: 'suspended' })
        .where('id', '=', request.params.uid)
        .execute()

      // Revoke all refresh tokens so suspended user can't keep using the app
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('user_id', '=', request.params.uid)
        .where('revoked_at', 'is', null)
        .execute()
    }

    return { success: true }
  })

  // PATCH /teams/:id/members/batch-quota — bulk update quota & period for multiple members
  app.patch<{
    Params: { id: string }
    Body: { user_ids: string[]; credit_quota?: number | null; quota_period?: string | null }
  }>('/teams/:id/members/batch-quota', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
    schema: {
      body: {
        type: 'object',
        required: ['user_ids'],
        properties: {
          user_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 200 },
          credit_quota: { type: ['number', 'null'], minimum: 0, maximum: 1000000 },
          quota_period: { type: ['string', 'null'], enum: ['weekly', 'monthly', null] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { user_ids, credit_quota, quota_period } = request.body
    if (credit_quota === undefined && quota_period === undefined) {
      return reply.badRequest('At least one of credit_quota or quota_period is required')
    }

    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (credit_quota !== undefined) updates.credit_quota = credit_quota
    if (quota_period !== undefined) {
      updates.quota_period = quota_period
      if (quota_period) {
        const now = new Date()
        updates.quota_reset_at = quota_period === 'weekly'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
          : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
      } else {
        updates.quota_reset_at = null
      }
    }

    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', 'in', user_ids)
      .where('role', '!=', 'owner')
      .execute()

    return { success: true, updated: user_ids.length }
  })

  // GET /teams/:id/workspaces — all workspaces in team (for team owner management view)
  app.get<{ Params: { id: string } }>('/teams/:id/workspaces', {
    preHandler: teamRoleGuard('owner'),
    config: { rateLimit: false },
  }, async (request) => {
    const db = getDb()
    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'description', 'created_at'])
      .where('team_id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute()

    const memberCounts = await db
      .selectFrom('workspace_members')
      .select(['workspace_id', db.fn.count('id').as('count')])
      .where('workspace_id', 'in', workspaces.map(w => w.id))
      .groupBy('workspace_id')
      .execute()

    const countMap = Object.fromEntries(memberCounts.map(r => [r.workspace_id, Number(r.count)]))
    return { data: workspaces.map(w => ({ ...w, member_count: countMap[w.id] ?? 0 })) }
  })

  // GET /teams/:id/batches — all team generation records
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/teams/:id/batches', {
    preHandler: teamRoleGuard('owner'),
  }, async (request) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .where('team_id', '=', request.params.id)
      .orderBy('created_at', 'desc')
      .limit(limit + 1)

    if (request.query.cursor) {
      query = query.where('created_at', '<', request.query.cursor as any)
    }

    const rows = await query.execute()
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows

    return {
      data,
      cursor: hasMore ? String(data[data.length - 1].created_at) : null,
    }
  })

  // PATCH /teams/:id/allow-member-topup — owner toggles member topup permission
  app.patch<{ Params: { id: string }; Body: { allow: boolean } }>('/teams/:id/allow-member-topup', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['allow'],
        properties: { allow: { type: 'boolean' } },
      },
    },
  }, async (request) => {
    const db = getDb()
    await db.updateTable('teams')
      .set({ allow_member_topup: request.body.allow })
      .where('id', '=', request.params.id)
      .execute()
    return { success: true }
  })
}
