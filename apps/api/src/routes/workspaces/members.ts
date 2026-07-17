import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { workspaceTeamOwnerGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /workspaces/:id/members — 列出工作区成员
  app.get<{ Params: { id: string } }>('/workspaces/:id/members', {
    preHandler: workspaceTeamOwnerGuard(),
  }, async (request) => {
    const db = getDb()
    const members = await db
      .selectFrom('workspace_members')
      .innerJoin('users', 'users.id', 'workspace_members.user_id')
      .select([
        'users.id as user_id', 'users.account', 'users.username', 'users.avatar_url',
        'workspace_members.role', 'workspace_members.created_at',
      ])
      .where('workspace_members.workspace_id', '=', request.params.id)
      .execute()

    return { data: members }
  })

  // POST /workspaces/:id/members — 添加成员到工作区
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

    // 验证工作区存在并获取 team_id
    const workspace = await db
      .selectFrom('workspaces')
      .select('team_id')
      .where('id', '=', request.params.id)
      .executeTakeFirst()

    if (!workspace) return reply.notFound('Workspace not found')

    // 验证用户是否为团队成员
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

    // 工作区角色上限不能超过团队角色级别
    const TEAM_TO_WS_MAX: Record<string, number> = { owner: 2, admin: 2, editor: 1, viewer: 0 }
    const WS_ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }
    const WS_RANK_TO_ROLE = ['viewer', 'editor', 'admin'] as const
    const requestedRole = (role ?? 'editor') as string
    const maxRank = TEAM_TO_WS_MAX[teamMember.role] ?? 0
    const requestedRank = WS_ROLE_RANK[requestedRole] ?? 1
    const effectiveRole = WS_RANK_TO_ROLE[Math.min(requestedRank, maxRank)]

    // 检查是否已是工作区成员
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

  // DELETE /workspaces/:id/members/:uid — 从工作区移除成员
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
}

export default route
