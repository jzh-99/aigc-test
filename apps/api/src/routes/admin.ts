import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import bcrypt from 'bcryptjs'
import { adminGuard } from '../plugins/guards.js'
import { signAssetUrl } from '../lib/storage.js'
import { stripHtml } from '../lib/sanitize.js'
import type { CreateTeamRequest, TopUpCreditsRequest } from '@aigc/types'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // All admin routes require admin role
  app.addHook('preHandler', adminGuard())

  // GET /admin/teams — list all teams with member count and credit balance
  app.get('/admin/teams', async () => {
    const db = getDb()
    const teams = await db
      .selectFrom('teams')
      .leftJoin('credit_accounts', (join) =>
        join
          .onRef('credit_accounts.team_id', '=', 'teams.id')
          .on('credit_accounts.owner_type', '=', 'team')
      )
      .select([
        'teams.id', 'teams.name', 'teams.owner_id', 'teams.plan_tier', 'teams.team_type', 'teams.created_at', 'teams.allow_member_topup',
        'credit_accounts.balance', 'credit_accounts.frozen_credits',
        'credit_accounts.total_earned', 'credit_accounts.total_spent',
      ])
      .where('teams.is_deleted', '=', false)
      .orderBy('teams.created_at', 'asc')
      .execute()

    // Get member counts
    const memberCounts = await db
      .selectFrom('team_members')
      .select(['team_id', db.fn.count('user_id').as('member_count')])
      .groupBy('team_id')
      .execute()

    const countMap = new Map(memberCounts.map(m => [m.team_id, Number(m.member_count)]))

    // Get workspace counts
    const wsCounts = await db
      .selectFrom('workspaces')
      .select(['team_id', db.fn.count('id').as('workspace_count')])
      .where('is_deleted', '=', false)
      .groupBy('team_id')
      .execute()

    const wsCountMap = new Map(wsCounts.map(w => [w.team_id, Number(w.workspace_count)]))

    // Get owner usernames
    const ownerIds = [...new Set(teams.map(t => t.owner_id).filter(Boolean))]
    const ownerMap = new Map<string, string>()
    if (ownerIds.length > 0) {
      const owners = await db
        .selectFrom('users')
        .select(['id', 'username'])
        .where('id', 'in', ownerIds)
        .execute()
      for (const o of owners) ownerMap.set(o.id, o.username)
    }

    // Get lifetime generation usage per team from ledger (confirm entries only)
    const teamIds = teams.map(t => t.id)
    const lifetimeMap = new Map<string, number>()
    if (teamIds.length > 0) {
      const rows = await db
        .selectFrom('credits_ledger')
        .innerJoin('credit_accounts', 'credit_accounts.id', 'credits_ledger.credit_account_id')
        .select(['credit_accounts.team_id', db.fn.sum('credits_ledger.amount').as('total')])
        .where('credits_ledger.type', '=', 'confirm')
        .where('credit_accounts.team_id', 'in', teamIds)
        .groupBy('credit_accounts.team_id')
        .execute()
      for (const r of rows) {
        if (r.team_id) lifetimeMap.set(r.team_id, Math.abs(Number(r.total ?? 0)))
      }
    }

    return {
      data: teams.map(t => ({
        ...t,
        balance: t.balance ?? 0,
        frozen_credits: t.frozen_credits ?? 0,
        total_earned: t.total_earned ?? 0,
        total_spent: t.total_spent ?? 0,
        lifetime_used: lifetimeMap.get(t.id) ?? 0,
        member_count: countMap.get(t.id) ?? 0,
        workspace_count: wsCountMap.get(t.id) ?? 0,
        owner_username: ownerMap.get(t.owner_id) ?? null,
      })),
    }
  })

  // GET /admin/teams/:id/members — list team members with credit usage
  app.get<{ Params: { id: string } }>('/admin/teams/:id/members', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const db = getDb()
    const teamId = request.params.id

    const team = await db
      .selectFrom('teams')
      .select('id')
      .where('id', '=', teamId)
      .executeTakeFirst()
    if (!team) return reply.notFound('Team not found')

    const members = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select([
        'users.id', 'users.username', 'users.account', 'users.avatar_url',
        'team_members.role', 'team_members.credit_quota', 'team_members.credit_used',
        'team_members.joined_at',
      ])
      .where('team_members.team_id', '=', teamId)
      .orderBy('team_members.joined_at', 'asc')
      .execute()

    return { data: members }
  })

  // PATCH /admin/teams/:id/members/:uid — admin update member quota/period
  app.patch<{
    Params: { id: string; uid: string }
    Body: { credit_quota?: number | null; quota_period?: string | null }
  }>('/admin/teams/:id/members/:uid', {
    config: { rateLimit: false },
    schema: {
      body: {
        type: 'object',
        properties: {
          credit_quota: { type: ['number', 'null'], minimum: 0, maximum: 1000000 },
          quota_period: { type: ['string', 'null'], enum: ['weekly', 'monthly', null] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { credit_quota, quota_period } = request.body
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
      .where('user_id', '=', request.params.uid)
      .execute()
    return { success: true }
  })

  // POST /admin/teams/:id/members/:uid/reset-credits — admin reset member credit_used to 0
  app.post<{ Params: { id: string; uid: string } }>('/admin/teams/:id/members/:uid/reset-credits', {
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
    if (member.quota_period) {
      const now = new Date()
      updates.quota_reset_at = member.quota_period === 'weekly'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
        : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
    }
    await db
      .updateTable('team_members')
      .set(updates)
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()
    return { success: true, credit_used: 0 }
  })

  // GET /admin/teams/:id/workspaces — list team workspaces with batch stats
  app.get<{ Params: { id: string } }>('/admin/teams/:id/workspaces', async (request, reply) => {
    const db = getDb()
    const teamId = request.params.id

    const team = await db
      .selectFrom('teams')
      .select('id')
      .where('id', '=', teamId)
      .executeTakeFirst()
    if (!team) return reply.notFound('Team not found')

    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'created_at'])
      .where('team_id', '=', teamId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute()

    // Get member counts per workspace
    const wsIds = workspaces.map(w => w.id)
    const wsMemberMap = new Map<string, number>()
    const wsBatchMap = new Map<string, { total: number; completed: number; failed: number }>()

    if (wsIds.length > 0) {
      const wsMemberCounts = await db
        .selectFrom('workspace_members')
        .select(['workspace_id', db.fn.count('user_id').as('count')])
        .where('workspace_id', 'in', wsIds)
        .groupBy('workspace_id')
        .execute()
      for (const m of wsMemberCounts) wsMemberMap.set(m.workspace_id, Number(m.count))

      // Get batch stats per workspace
      const batchStats = await sql<{ workspace_id: string; total: string; completed: string; failed: string }>`
        SELECT
          workspace_id,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM task_batches
        WHERE workspace_id = ANY(${wsIds}::uuid[]) AND is_deleted = false
        GROUP BY workspace_id
      `.execute(db)
      for (const s of batchStats.rows) {
        wsBatchMap.set(s.workspace_id, {
          total: Number(s.total),
          completed: Number(s.completed),
          failed: Number(s.failed),
        })
      }
    }

    return {
      data: workspaces.map(w => ({
        ...w,
        member_count: wsMemberMap.get(w.id) ?? 0,
        batch_total: wsBatchMap.get(w.id)?.total ?? 0,
        batch_completed: wsBatchMap.get(w.id)?.completed ?? 0,
        batch_failed: wsBatchMap.get(w.id)?.failed ?? 0,
      })),
    }
  })

  // GET /admin/workspaces/:id/batches — list workspace batches with user info
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/admin/workspaces/:id/batches', async (request) => {
    const db = getDb()
    const wsId = request.params.id
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .where('workspace_id', '=', wsId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .limit(limit + 1)

    if (request.query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(request.query.cursor, 'base64').toString('utf-8'))
        query = query.where((eb: any) =>
          eb.or([
            eb('created_at', '<', decoded.created_at),
            eb.and([
              eb('created_at', '=', decoded.created_at),
              eb('id', '<', decoded.id),
            ]),
          ]),
        )
      } catch {
        // ignore invalid cursor
      }
    }

    const rows = await query.execute()
    const hasMore = rows.length > limit
    const batches = hasMore ? rows.slice(0, limit) : rows

    // Fetch user info
    const userIds = [...new Set(batches.map((b: any) => b.user_id))]
    const userMap = new Map<string, { id: string; username: string }>()
    if (userIds.length > 0) {
      const users = await db
        .selectFrom('users')
        .select(['id', 'username'])
        .where('id', 'in', userIds)
        .execute()
      for (const u of users) userMap.set(u.id, { id: u.id, username: u.username })
    }

    // Fetch thumbnails
    const batchIds = batches.map((b: any) => b.id)
    const thumbnailMap = new Map<string, string[]>()
    if (batchIds.length > 0) {
      const assets = await db
        .selectFrom('assets')
        .select(['batch_id', 'storage_url', 'original_url'])
        .where('batch_id', 'in', batchIds)
        .where('is_deleted', '=', false)
        .execute()
      for (const a of assets) {
        const rawUrl = (a as any).storage_url ?? (a as any).original_url
        if (!rawUrl) continue
        const signedUrl = await signAssetUrl(rawUrl)
        if (!signedUrl) continue
        const list = thumbnailMap.get((a as any).batch_id) ?? []
        list.push(signedUrl)
        thumbnailMap.set((a as any).batch_id, list)
      }
    }

    const nextCursor = hasMore && batches.length > 0
      ? Buffer.from(JSON.stringify({
          created_at: batches[batches.length - 1].created_at,
          id: batches[batches.length - 1].id,
        })).toString('base64')
      : null

    return {
      data: batches.map((b: any) => ({
        id: b.id,
        module: b.module,
        provider: b.provider,
        model: b.model,
        prompt: b.prompt,
        params: b.params,
        quantity: b.quantity,
        completed_count: b.completed_count,
        failed_count: b.failed_count,
        status: b.status,
        estimated_credits: b.estimated_credits,
        actual_credits: b.actual_credits,
        created_at: b.created_at?.toISOString?.() ?? String(b.created_at),
        tasks: [],
        thumbnail_urls: thumbnailMap.get(b.id) ?? [],
        user: userMap.get(b.user_id) ?? undefined,
      })),
      cursor: nextCursor,
    }
  })

  // POST /admin/teams — create team + owner user + credit_account + default workspace
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

    // Validate phone: exactly 11 digits
    if (owner_phone && !/^\d{11}$/.test(owner_phone)) {
      return reply.badRequest('手机号必须是 11 位数字')
    }

    const db = getDb()

    // Check duplicate team name
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

    // Check if owner user exists (by email or phone)
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
      // Create owner user
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
      // User exists — reactivate if suspended, and update password if a new one is provided
      const updates: Record<string, unknown> = {}
      if (owner.status === 'suspended') updates.status = 'active'
      if (owner_password && owner_password.length >= 8) {
        updates.password_hash = await bcrypt.hash(owner_password, 12)
      }
      if (Object.keys(updates).length > 0) {
        await db.updateTable('users').set(updates).where('id', '=', owner.id).execute()
      }
    }

    // Check owner uniqueness: one active team per owner
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

    // Create team
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

    // Add owner to team_members
    await db
      .insertInto('team_members')
      .values({
        team_id: team.id,
        user_id: owner.id,
        role: 'owner',
      })
      .execute()

    // Create credit account for team
    await db
      .insertInto('credit_accounts')
      .values({
        owner_type: 'team',
        team_id: team.id,
        balance: initial_credits ?? 0,
      })
      .execute()

    // Create default workspace
    const workspace = await db
      .insertInto('workspaces')
      .values({
        team_id: team.id,
        name: '默认工作区',
        created_by: owner.id,
      })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow()

    // Add owner to workspace
    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: workspace.id,
        user_id: owner.id,
        role: 'admin',
      })
      .execute()

    // If initial credits > 0, add ledger entry
    if (initial_credits && initial_credits > 0) {
      const creditAccount = await db
        .selectFrom('credit_accounts')
        .select('id')
        .where('team_id', '=', team.id)
        .where('owner_type', '=', 'team')
        .executeTakeFirstOrThrow()

      await db
        .insertInto('credits_ledger')
        .values({
          credit_account_id: creditAccount.id,
          user_id: request.user.id,
          amount: initial_credits,
          type: 'topup',
          description: 'Initial team credits',
        })
        .execute()
    }

    return reply.status(201).send({
      team,
      owner: { id: owner.id, account: owner.account, username: owner.username, existing: ownerWasExisting },
      workspace: { id: workspace.id, name: workspace.name },
    })
  })

  // PATCH /admin/teams/:id — update team settings (team_type, allow_member_topup)
  app.patch<{ Params: { id: string }; Body: { team_type?: 'standard' | 'company_a' | 'avatar_enabled'; allow_member_topup?: boolean } }>('/admin/teams/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          team_type: { type: 'string', enum: ['standard', 'company_a', 'avatar_enabled'] },
          allow_member_topup: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const { team_type, allow_member_topup } = request.body

    const team = await db.selectFrom('teams').select('id').where('id', '=', id).executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在' } })

    const updates: Record<string, unknown> = {}
    if (team_type !== undefined) updates.team_type = team_type
    if (allow_member_topup !== undefined) updates.allow_member_topup = allow_member_topup

    if (Object.keys(updates).length > 0) {
      await db.updateTable('teams').set(updates as any).where('id', '=', id).execute()
    }

    return reply.send({ success: true })
  })

  // DELETE /admin/teams/:id — soft-delete team + cascade workspaces + task_batches
  app.delete<{ Params: { id: string } }>('/admin/teams/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams')
      .select(['id', 'name'])
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在' } })

    const now = new Date()

    // Cascade: soft-delete all workspaces
    const wsIds = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', id)
      .where('is_deleted', '=', false)
      .execute()

    if (wsIds.length > 0) {
      const wsIdList = wsIds.map(w => w.id)
      await db
        .updateTable('workspaces')
        .set({ is_deleted: true, deleted_at: now })
        .where('id', 'in', wsIdList)
        .execute()

      // Cascade: soft-delete task_batches in those workspaces
      await db
        .updateTable('task_batches')
        .set({ is_deleted: true, deleted_at: now })
        .where('workspace_id', 'in', wsIdList)
        .where('is_deleted', '=', false)
        .execute()
    }

    // Soft-delete the team
    await db
      .updateTable('teams')
      .set({ is_deleted: true, deleted_at: now })
      .where('id', '=', id)
      .execute()

    // Suspend members who no longer belong to any active team
    const memberIds = (await db
      .selectFrom('team_members')
      .select('user_id')
      .where('team_id', '=', id)
      .execute()
    ).map(m => m.user_id)

    if (memberIds.length > 0) {
      // Count active teams per member (excluding the just-deleted team)
      const activeCounts = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', db.fn.count('team_members.team_id').as('count')])
        .where('team_members.user_id', 'in', memberIds)
        .where('teams.is_deleted', '=', false)
        .groupBy('team_members.user_id')
        .execute()

      const countMap = new Map(activeCounts.map(r => [r.user_id, Number(r.count)]))
      const toSuspend = memberIds.filter(uid => (countMap.get(uid) ?? 0) === 0)

      if (toSuspend.length > 0) {
        await db
          .updateTable('users')
          .set({ status: 'suspended' })
          .where('id', 'in', toSuspend)
          .execute()

        await db
          .updateTable('refresh_tokens')
          .set({ revoked_at: sql`NOW()` })
          .where('user_id', 'in', toSuspend)
          .where('revoked_at', 'is', null)
          .execute()
      }
    }

    return { success: true }
  })

  // GET /admin/trash — list soft-deleted teams and workspaces (within 7 days)
  app.get('/admin/trash', async () => {
    const db = getDb()
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const teams = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id', 'deleted_at'])
      .where('is_deleted', '=', true)
      .where('deleted_at', '>=', cutoff as any)
      .orderBy('deleted_at', 'desc')
      .execute()

    const workspaces = await db
      .selectFrom('workspaces')
      .select(['id', 'name', 'team_id', 'deleted_at'])
      .where('is_deleted', '=', true)
      .where('deleted_at', '>=', cutoff as any)
      // Only show workspaces whose parent team is NOT deleted (team-level deletes are under teams tab)
      .where((eb) =>
        eb.not(eb.exists(
          eb.selectFrom('teams')
            .select('id')
            .whereRef('teams.id', '=', 'workspaces.team_id')
            .where('teams.is_deleted', '=', true)
        ))
      )
      .orderBy('deleted_at', 'desc')
      .execute()

    // Owner usernames for teams
    const ownerIds = [...new Set(teams.map(t => t.owner_id))]
    const ownerMap = new Map<string, string>()
    if (ownerIds.length > 0) {
      const owners = await db
        .selectFrom('users')
        .select(['id', 'username'])
        .where('id', 'in', ownerIds)
        .execute()
      for (const o of owners) ownerMap.set(o.id, o.username)
    }

    // Team names for workspaces
    const teamIds = [...new Set(workspaces.map(w => w.team_id))]
    const teamNameMap = new Map<string, string>()
    if (teamIds.length > 0) {
      const teamRows = await db
        .selectFrom('teams')
        .select(['id', 'name'])
        .where('id', 'in', teamIds)
        .execute()
      for (const t of teamRows) teamNameMap.set(t.id, t.name)
    }

    return {
      teams: teams.map(t => ({
        ...t,
        owner_username: ownerMap.get(t.owner_id) ?? null,
        deleted_at: t.deleted_at,
      })),
      workspaces: workspaces.map(w => ({
        ...w,
        team_name: teamNameMap.get(w.team_id) ?? null,
      })),
    }
  })

  // POST /admin/trash/teams/:id/restore — restore soft-deleted team
  app.post<{ Params: { id: string } }>('/admin/trash/teams/:id/restore', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams')
      .select(['id', 'name', 'owner_id'])
      .where('id', '=', id)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '已删除的团队不存在或已过期' } })

    // Check owner uniqueness before restoring
    const ownerConflict = await db
      .selectFrom('teams')
      .select('id')
      .where('owner_id', '=', team.owner_id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (ownerConflict) {
      return reply.status(409).send({
        success: false,
        error: { code: 'USER_ALREADY_OWNER', message: '该团队组长已成为其他团队的组长，无法恢复' },
      })
    }

    // Check team name uniqueness before restoring
    const nameConflict = await db
      .selectFrom('teams')
      .select('id')
      .where('name', '=', team.name)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (nameConflict) {
      return reply.status(409).send({
        success: false,
        error: { code: 'TEAM_NAME_TAKEN', message: `已有同名团队"${team.name}"，恢复前请先重命名现有团队` },
      })
    }

    // Restore team
    await db
      .updateTable('teams')
      .set({ is_deleted: false, deleted_at: null })
      .where('id', '=', id)
      .execute()

    // Restore workspaces and their task_batches that were deleted at the same time
    const wsIds = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', id)
      .where('is_deleted', '=', true)
      .execute()

    if (wsIds.length > 0) {
      const wsIdList = wsIds.map(w => w.id)
      await db
        .updateTable('workspaces')
        .set({ is_deleted: false, deleted_at: null })
        .where('id', 'in', wsIdList)
        .execute()

      await db
        .updateTable('task_batches')
        .set({ is_deleted: false, deleted_at: null })
        .where('workspace_id', 'in', wsIdList)
        .where('is_deleted', '=', true)
        .execute()
    }

    // Re-activate suspended members who have no other active teams (this team is their only one)
    const memberIds = (await db
      .selectFrom('team_members')
      .select('user_id')
      .where('team_id', '=', id)
      .execute()
    ).map(m => m.user_id)

    if (memberIds.length > 0) {
      // Find suspended members with no other active team
      const activeCounts = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', db.fn.count('team_members.team_id').as('count')])
        .where('team_members.user_id', 'in', memberIds)
        .where('teams.is_deleted', '=', false)
        .where('team_members.team_id', '!=', id)  // exclude restored team itself to find "only this team" members
        .groupBy('team_members.user_id')
        .execute()

      const countMap = new Map(activeCounts.map(r => [r.user_id, Number(r.count)]))
      // Members with no OTHER active teams are those suspended because of this deletion
      const toReactivate = memberIds.filter(uid => (countMap.get(uid) ?? 0) === 0)

      if (toReactivate.length > 0) {
        await db
          .updateTable('users')
          .set({ status: 'active' })
          .where('id', 'in', toReactivate)
          .where('status', '=', 'suspended')
          .execute()
      }
    }

    return { success: true }
  })

  // DELETE /admin/trash/teams/:id — permanently delete team and all data
  app.delete<{ Params: { id: string } }>('/admin/trash/teams/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const team = await db
      .selectFrom('teams')
      .select('id')
      .where('id', '=', id)
      .where('is_deleted', '=', true)
      .executeTakeFirst()
    if (!team) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '团队不存在或未被删除' } })

    // Get workspace IDs
    const wsIds = (await db.selectFrom('workspaces').select('id').where('team_id', '=', id).execute()).map(w => w.id)

    if (wsIds.length > 0) {
      // Get task_batch IDs
      const batchIds = (await db.selectFrom('task_batches').select('id').where('workspace_id', 'in', wsIds).execute()).map(b => b.id)

      if (batchIds.length > 0) {
        // Permanently delete assets
        await db.deleteFrom('assets').where('batch_id', 'in', batchIds).execute()
        // Permanently delete tasks
        await db.deleteFrom('tasks').where('batch_id', 'in', batchIds).execute()
        // Permanently delete task_batches
        await db.deleteFrom('task_batches').where('id', 'in', batchIds).execute()
      }

      // Delete workspace members
      await db.deleteFrom('workspace_members').where('workspace_id', 'in', wsIds).execute()
      // Delete workspaces
      await db.deleteFrom('workspaces').where('id', 'in', wsIds).execute()
    }

    // Delete team members
    await db.deleteFrom('team_members').where('team_id', '=', id).execute()
    // Delete the team (credit_accounts preserved as soft-delete)
    await db.deleteFrom('teams').where('id', '=', id).execute()

    return { success: true }
  })

  // PATCH /admin/users/:id/password — admin change any user's password
  app.patch<{ Params: { id: string }; Body: { new_password: string; unlock_account?: boolean } }>('/admin/users/:id/password', {
    schema: {
      body: {
        type: 'object',
        required: ['new_password'],
        properties: {
          new_password: { type: 'string', minLength: 8, maxLength: 72 },
          unlock_account: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { new_password, unlock_account } = request.body

    if (!/[a-zA-Z]/.test(new_password) || !/\d/.test(new_password)) {
      return reply.badRequest('密码必须包含字母和数字')
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'account'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } })

    const passwordHash = await bcrypt.hash(new_password, 12)
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash })
      .where('id', '=', id)
      .execute()

    // Revoke all refresh tokens so user must re-login
    await db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sql`NOW()` })
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute()

    // Optionally clear account lockout from Redis
    if (unlock_account) {
      const redis = (app as any).redis as import('ioredis').default
      await redis.del(`auth:locked:${user.account.toLowerCase()}`)
      await redis.del(`auth:attempts:${user.account.toLowerCase()}`)
    }

    return { success: true }
  })

  // POST /admin/teams/:id/credits — adjust team credits (positive = top-up, negative = deduct)
  app.post<{ Params: { id: string }; Body: TopUpCreditsRequest }>('/admin/teams/:id/credits', {
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: -1000000, maximum: 1000000 },
          description: { type: 'string', maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { amount, description: rawDesc } = request.body
    if (amount === 0) return reply.badRequest('amount must be a non-zero number')
    // Sanitize description: truncate and strip HTML
    const description = rawDesc ? stripHtml(rawDesc).slice(0, 200) : undefined

    const db = getDb()

    const creditAccount = await db
      .selectFrom('credit_accounts')
      .select(['id', 'balance', 'frozen_credits'])
      .where('team_id', '=', request.params.id)
      .where('owner_type', '=', 'team')
      .executeTakeFirst()

    if (!creditAccount) return reply.notFound('Team credit account not found')

    if (amount > 0) {
      // Top-up
      await db
        .updateTable('credit_accounts')
        .set({
          balance: sql`balance + ${amount}`,
          total_earned: sql`total_earned + ${amount}`,
        })
        .where('id', '=', creditAccount.id)
        .execute()

      await db
        .insertInto('credits_ledger')
        .values({
          credit_account_id: creditAccount.id,
          user_id: request.user.id,
          amount,
          type: 'topup',
          description: description ?? 'Admin top-up',
        })
        .execute()
    } else {
      // Deduction (amount is negative)
      const deduction = Math.abs(amount)
      const available = Number(creditAccount.balance) - Number(creditAccount.frozen_credits)
      if (available < deduction) {
        return reply.badRequest('可扣减余额不足，请检查当前余额和冻结金额')
      }

      await db
        .updateTable('credit_accounts')
        .set({
          balance: sql`balance - ${deduction}`,
          total_spent: sql`total_spent + ${deduction}`,
        })
        .where('id', '=', creditAccount.id)
        .execute()

      await db
        .insertInto('credits_ledger')
        .values({
          credit_account_id: creditAccount.id,
          user_id: request.user.id,
          amount,
          type: 'refund',
          description: description ?? 'Admin deduction',
        })
        .execute()
    }

    const updated = await db
      .selectFrom('credit_accounts')
      .select(['balance', 'frozen_credits', 'total_earned', 'total_spent'])
      .where('id', '=', creditAccount.id)
      .executeTakeFirstOrThrow()

    return updated
  })

  // GET /admin/users — list all users with credit usage
  app.get('/admin/users', async () => {
    const db = getDb()
    const users = await db
      .selectFrom('users')
      .select(['id', 'account', 'username', 'avatar_url', 'role', 'status', 'created_at'])
      .orderBy('created_at', 'desc')
      .execute()

    // Get credit usage per user from team_members (current period) + ledger (lifetime)
    const userIds = users.map(u => u.id)
    const creditUsageMap = new Map<string, { total_quota: number | null; total_used: number }>()
    const lifetimeUsageMap = new Map<string, number>()

    if (userIds.length > 0) {
      const memberRows = await db
        .selectFrom('team_members')
        .select(['user_id', 'credit_quota', 'credit_used'])
        .where('user_id', 'in', userIds)
        .execute()

      for (const m of memberRows) {
        const existing = creditUsageMap.get(m.user_id)
        const used = (m.credit_used ?? 0)
        const quota = m.credit_quota
        if (existing) {
          existing.total_used += used
          if (quota !== null && quota !== undefined) {
            existing.total_quota = (existing.total_quota ?? 0) + quota
          }
        } else {
          creditUsageMap.set(m.user_id, {
            total_quota: quota ?? null,
            total_used: used,
          })
        }
      }

      // Lifetime usage from ledger: sum of all 'confirm' debits per user
      const ledgerRows = await db
        .selectFrom('credits_ledger')
        .select(['user_id', db.fn.sum('amount').as('total')])
        .where('user_id', 'in', userIds)
        .where('type', '=', 'confirm')
        .groupBy('user_id')
        .execute()

      for (const r of ledgerRows) {
        // confirm entries have negative amounts, so negate to get positive usage
        lifetimeUsageMap.set(r.user_id, Math.abs(Number(r.total ?? 0)))
      }
    }

    // Get team names, team_id, and priority_boost per user
    const teamMap = new Map<string, string[]>()
    const teamIdMap = new Map<string, string>()
    const priorityBoostMap = new Map<string, boolean>()
    if (userIds.length > 0) {
      const teamRows = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', 'team_members.team_id', 'team_members.priority_boost', 'teams.name'])
        .where('team_members.user_id', 'in', userIds)
        .where('teams.is_deleted', '=', false)
        .execute()
      for (const r of teamRows) {
        const list = teamMap.get(r.user_id) ?? []
        list.push(r.name)
        teamMap.set(r.user_id, list)
        // Store first team_id and priority_boost (most users belong to one team)
        if (!teamIdMap.has(r.user_id)) {
          teamIdMap.set(r.user_id, r.team_id)
          priorityBoostMap.set(r.user_id, r.priority_boost ?? false)
        }
      }
    }

    return {
      data: users.map(u => ({
        ...u,
        credit_used: creditUsageMap.get(u.id)?.total_used ?? 0,
        credit_quota: creditUsageMap.get(u.id)?.total_quota ?? null,
        lifetime_used: lifetimeUsageMap.get(u.id) ?? 0,
        teams: teamMap.get(u.id) ?? [],
        team_id: teamIdMap.get(u.id) ?? null,
        priority_boost: priorityBoostMap.get(u.id) ?? false,
      })),
    }
  })

  // GET /admin/batches — all generation records (kept for backwards compat)
  app.get<{ Querystring: { team_id?: string; workspace_id?: string; cursor?: string; limit?: string } }>('/admin/batches', async (request, reply) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit + 1)

    if (request.query.team_id) {
      query = query.where('team_id', '=', request.query.team_id)
    }
    if (request.query.workspace_id) {
      query = query.where('workspace_id', '=', request.query.workspace_id)
    }
    if (request.query.cursor) {
      const cursorDate = new Date(request.query.cursor)
      if (isNaN(cursorDate.getTime())) return reply.badRequest('Invalid cursor')
      query = query.where('created_at', '<', cursorDate as any)
    }

    const rows = await query.execute()
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows

    return {
      data,
      cursor: hasMore ? String(data[data.length - 1].created_at) : null,
    }
  })

  // GET /admin/errors — global error dashboard (recent failed tasks + AI errors across all users)
  app.get<{ Querystring: { limit?: string; since?: string } }>(
    '/admin/errors',
    async (request) => {
      const db = getDb()
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200)
      const sinceMs = parseInt(request.query.since ?? String(7 * 24 * 60 * 60 * 1000), 10)
      const since = new Date(Date.now() - sinceMs)

      // Recent failed tasks across all users
      const failedTasks = await db
        .selectFrom('tasks')
        .innerJoin('task_batches', 'task_batches.id', 'tasks.batch_id')
        .innerJoin('users', 'users.id', 'tasks.user_id')
        .select([
          'tasks.id as task_id',
          'tasks.batch_id',
          'tasks.error_message',
          'tasks.retry_count',
          'tasks.completed_at',
          'task_batches.module',
          'task_batches.provider',
          'task_batches.model',
          'task_batches.prompt',
          'task_batches.canvas_id',
          'task_batches.created_at as submitted_at',
          'users.id as user_id',
          'users.username',
          'users.account',
        ])
        .where('tasks.status', '=', 'failed')
        .where('task_batches.created_at', '>=', since as any)
        .orderBy('task_batches.created_at', 'desc')
        .limit(limit)
        .execute()

      // Recent AI assistant errors across all users
      const aiErrors = await db
        .selectFrom('ai_assistant_errors')
        .innerJoin('users', 'users.id', 'ai_assistant_errors.user_id')
        .select([
          'ai_assistant_errors.id',
          'ai_assistant_errors.http_status',
          'ai_assistant_errors.error_detail',
          'ai_assistant_errors.created_at',
          'users.id as user_id',
          'users.username',
          'users.account',
        ])
        .where('ai_assistant_errors.created_at', '>=', since as any)
        .orderBy('ai_assistant_errors.created_at', 'desc')
        .limit(limit)
        .execute()

      // Recent submission errors across all users
      const submissionErrors = await db
        .selectFrom('submission_errors')
        .innerJoin('users', 'users.id', 'submission_errors.user_id')
        .select([
          'submission_errors.id',
          'submission_errors.source',
          'submission_errors.error_code',
          'submission_errors.http_status',
          'submission_errors.detail',
          'submission_errors.model',
          'submission_errors.canvas_id',
          'submission_errors.created_at',
          'users.id as user_id',
          'users.username',
          'users.account',
        ])
        .where('submission_errors.created_at', '>=', since as any)
        .orderBy('submission_errors.created_at', 'desc')
        .limit(limit)
        .execute()

      // Error frequency summary: group failed tasks + submission errors
      const errorGroups = new Map<string, { count: number; last_seen: string; example: string }>()
      for (const t of failedTasks) {
        const key = (t.error_message ?? '（无错误信息）').slice(0, 120)
        const existing = errorGroups.get(key)
        const ts = t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at)
        if (!existing) {
          errorGroups.set(key, { count: 1, last_seen: ts, example: key })
        } else {
          existing.count++
          if (ts > existing.last_seen) existing.last_seen = ts
        }
      }
      for (const s of submissionErrors) {
        const key = `[提交:${s.source}] ${s.error_code}${s.http_status ? ` (HTTP ${s.http_status})` : ''}`
        const existing = errorGroups.get(key)
        const ts = s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at)
        if (!existing) {
          errorGroups.set(key, { count: 1, last_seen: ts, example: key })
        } else {
          existing.count++
          if (ts > existing.last_seen) existing.last_seen = ts
        }
      }
      const topErrors = [...errorGroups.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([message, stats]) => ({ message, ...stats }))

      return {
        failed_tasks: failedTasks.map(t => ({
          ...t,
          source: t.canvas_id ? 'canvas' : 'generation',
          submitted_at: t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at),
          completed_at: t.completed_at instanceof Date ? t.completed_at.toISOString() : (t.completed_at ? String(t.completed_at) : null),
        })),
        ai_errors: aiErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
        submission_errors: submissionErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
        top_errors: topErrors,
        since: since.toISOString(),
      }
    },
  )

  // GET /admin/users/:id/diagnosis — per-user error diagnosis
  // Returns: failed tasks (with raw error_message + source), AI assistant errors
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/admin/users/:id/diagnosis',
    async (request, reply) => {
      const db = getDb()
      const userId = request.params.id
      const limit = Math.min(parseInt(request.query.limit ?? '30', 10), 100)

      // Verify user exists
      const user = await db
        .selectFrom('users')
        .select(['id', 'username', 'account', 'email', 'phone', 'status'])
        .where('id', '=', userId)
        .executeTakeFirst()
      if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } })

      // Failed tasks with batch info (raw error_message, source: canvas or generation)
      const failedTasks = await db
        .selectFrom('tasks')
        .innerJoin('task_batches', 'task_batches.id', 'tasks.batch_id')
        .select([
          'tasks.id as task_id',
          'tasks.batch_id',
          'tasks.error_message',
          'tasks.status as task_status',
          'tasks.retry_count',
          'tasks.completed_at',
          'task_batches.module',
          'task_batches.provider',
          'task_batches.model',
          'task_batches.prompt',
          'task_batches.status as batch_status',
          'task_batches.canvas_id',
          'task_batches.canvas_node_id',
          'task_batches.created_at as submitted_at',
        ])
        .where('tasks.user_id', '=', userId)
        .where('tasks.status', '=', 'failed')
        .orderBy('task_batches.created_at', 'desc')
        .limit(limit)
        .execute()

      // AI assistant errors (last 7 days)
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const aiErrors = await db
        .selectFrom('ai_assistant_errors')
        .select(['id', 'http_status', 'error_detail', 'created_at'])
        .where('user_id', '=', userId)
        .where('created_at', '>=', since7d as any)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute()

      // Submission errors (last 7 days)
      const submissionErrors = await db
        .selectFrom('submission_errors')
        .select(['id', 'source', 'error_code', 'http_status', 'detail', 'model', 'canvas_id', 'created_at'])
        .where('user_id', '=', userId)
        .where('created_at', '>=', since7d as any)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute()

      return {
        user,
        failed_tasks: failedTasks.map(t => ({
          ...t,
          source: t.canvas_id ? 'canvas' : 'generation',
          submitted_at: t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at),
          completed_at: t.completed_at instanceof Date ? t.completed_at.toISOString() : (t.completed_at ? String(t.completed_at) : null),
        })),
        ai_assistant_errors: aiErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
        submission_errors: submissionErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
      }
    },
  )
}
