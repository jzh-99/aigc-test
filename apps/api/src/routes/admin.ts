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
        'teams.id', 'teams.name', 'teams.owner_id', 'teams.plan_tier', 'teams.created_at',
        'credit_accounts.balance', 'credit_accounts.frozen_credits',
        'credit_accounts.total_earned', 'credit_accounts.total_spent',
      ])
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
  app.get<{ Params: { id: string } }>('/admin/teams/:id/members', async (request, reply) => {
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
        'users.id', 'users.username', 'users.email', 'users.avatar_url',
        'team_members.role', 'team_members.credit_quota', 'team_members.credit_used',
        'team_members.joined_at',
      ])
      .where('team_members.team_id', '=', teamId)
      .orderBy('team_members.joined_at', 'asc')
      .execute()

    return { data: members }
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
        required: ['name', 'owner_email'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          owner_email: { type: 'string', format: 'email', maxLength: 254 },
          owner_username: { type: 'string', maxLength: 50 },
          owner_password: { type: 'string', minLength: 8, maxLength: 72 },
          initial_credits: { type: 'integer', minimum: 0, maximum: 10000000 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, owner_email, owner_username, owner_password, initial_credits } = request.body

    const db = getDb()

    // Check if owner user exists
    let owner = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', owner_email)
      .executeTakeFirst()

    if (!owner) {
      if (!owner_password || owner_password.length < 8) {
        return reply.badRequest('新用户需要提供至少 8 位的 owner_password')
      }
      // Create owner user
      const passwordHash = await bcrypt.hash(owner_password, 12)

      const result = await db
        .insertInto('users')
        .values({
          email: owner_email,
          username: owner_username ?? owner_email.split('@')[0],
          password_hash: passwordHash,
          role: 'member',
          status: 'active',
          plan_tier: 'free',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      owner = { id: result.id, email: owner_email }
    }

    // Create team
    const team = await db
      .insertInto('teams')
      .values({
        name,
        owner_id: owner.id,
        plan_tier: 'free',
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
      owner: { id: owner.id, email: owner.email },
      workspace: { id: workspace.id, name: workspace.name },
    })
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
      .select(['id', 'email', 'username', 'avatar_url', 'role', 'status', 'created_at'])
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

    // Get team names per user
    const teamMap = new Map<string, string[]>()
    if (userIds.length > 0) {
      const teamRows = await db
        .selectFrom('team_members')
        .innerJoin('teams', 'teams.id', 'team_members.team_id')
        .select(['team_members.user_id', 'teams.name'])
        .where('team_members.user_id', 'in', userIds)
        .execute()
      for (const r of teamRows) {
        const list = teamMap.get(r.user_id) ?? []
        list.push(r.name)
        teamMap.set(r.user_id, list)
      }
    }

    return {
      data: users.map(u => ({
        ...u,
        credit_used: creditUsageMap.get(u.id)?.total_used ?? 0,
        credit_quota: creditUsageMap.get(u.id)?.total_quota ?? null,
        lifetime_used: lifetimeUsageMap.get(u.id) ?? 0,
        teams: teamMap.get(u.id) ?? [],
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
}
