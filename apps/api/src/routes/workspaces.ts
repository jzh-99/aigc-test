import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard, workspaceGuard, workspaceTeamOwnerGuard } from '../plugins/guards.js'
import type { CreateWorkspaceRequest } from '@aigc/types'

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {

  // POST /teams/:id/workspaces — create workspace
  app.post<{ Params: { id: string }; Body: CreateWorkspaceRequest }>('/teams/:id/workspaces', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: ['string', 'null'], maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, description } = request.body

    const db = getDb()
    const workspace = await db
      .insertInto('workspaces')
      .values({
        team_id: request.params.id,
        name,
        description: description ?? null,
        created_by: request.user.id,
      })
      .returning(['id', 'name', 'description', 'team_id', 'created_by', 'created_at'])
      .executeTakeFirstOrThrow()

    // Add creator as workspace admin
    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: workspace.id,
        user_id: request.user.id,
        role: 'admin',
      })
      .execute()

    return reply.status(201).send(workspace)
  })

  // GET /workspaces/:id — workspace detail
  app.get<{ Params: { id: string } }>('/workspaces/:id', {
    preHandler: workspaceGuard('viewer'),
  }, async (request) => {
    const db = getDb()
    const workspace = await db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', request.params.id)
      .executeTakeFirstOrThrow()

    const memberCount = await db
      .selectFrom('workspace_members')
      .select(db.fn.count('id').as('count'))
      .where('workspace_id', '=', request.params.id)
      .executeTakeFirstOrThrow()

    return { ...workspace, member_count: Number(memberCount.count) }
  })

  // GET /workspaces/:id/members — list workspace members
  app.get<{ Params: { id: string } }>('/workspaces/:id/members', {
    preHandler: workspaceTeamOwnerGuard(),
  }, async (request) => {
    const db = getDb()
    const members = await db
      .selectFrom('workspace_members')
      .innerJoin('users', 'users.id', 'workspace_members.user_id')
      .select([
        'users.id as user_id', 'users.email', 'users.username', 'users.avatar_url',
        'workspace_members.role', 'workspace_members.created_at',
      ])
      .where('workspace_members.workspace_id', '=', request.params.id)
      .execute()

    return { data: members }
  })

  // POST /workspaces/:id/members — add member to workspace
  app.post<{ Params: { id: string }; Body: { user_id: string; role?: string } }>('/workspaces/:id/members', {
    preHandler: workspaceTeamOwnerGuard(),
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { user_id, role } = request.body

    const db = getDb()

    // Verify the workspace exists and get its team_id
    const workspace = await db
      .selectFrom('workspaces')
      .select('team_id')
      .where('id', '=', request.params.id)
      .executeTakeFirst()

    if (!workspace) return reply.notFound('Workspace not found')

    // Verify user is a team member
    const teamMember = await db
      .selectFrom('team_members')
      .select(['user_id', 'role'])
      .where('team_id', '=', workspace.team_id)
      .where('user_id', '=', user_id)
      .executeTakeFirst()

    if (!teamMember) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NOT_TEAM_MEMBER', message: 'User must be a team member first' },
      })
    }

    // Cap workspace role: can't exceed team role level
    const TEAM_TO_WS_MAX: Record<string, number> = { owner: 2, admin: 2, editor: 1, viewer: 0 }
    const WS_ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }
    const WS_RANK_TO_ROLE = ['viewer', 'editor', 'admin'] as const
    const requestedRole = (role ?? 'editor') as string
    const maxRank = TEAM_TO_WS_MAX[teamMember.role] ?? 0
    const requestedRank = WS_ROLE_RANK[requestedRole] ?? 1
    const effectiveRole = WS_RANK_TO_ROLE[Math.min(requestedRank, maxRank)]

    // Check if already a workspace member
    const existing = await db
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', request.params.id)
      .where('user_id', '=', user_id)
      .executeTakeFirst()

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_MEMBER', message: 'User is already a workspace member' },
      })
    }

    await db
      .insertInto('workspace_members')
      .values({
        workspace_id: request.params.id,
        user_id,
        role: effectiveRole,
      })
      .execute()

    return reply.status(201).send({ success: true })
  })

  // DELETE /workspaces/:id/members/:uid — remove from workspace
  app.delete<{ Params: { id: string; uid: string } }>('/workspaces/:id/members/:uid', {
    preHandler: workspaceTeamOwnerGuard(),
  }, async (request) => {
    const db = getDb()
    await db
      .deleteFrom('workspace_members')
      .where('workspace_id', '=', request.params.id)
      .where('user_id', '=', request.params.uid)
      .execute()

    return { success: true }
  })

  // GET /workspaces/:id/batches — workspace generation records
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>('/workspaces/:id/batches', {
    preHandler: workspaceGuard('editor'),
  }, async (request) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100)

    let query = db
      .selectFrom('task_batches')
      .selectAll()
      .where('workspace_id', '=', request.params.id)
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
}
