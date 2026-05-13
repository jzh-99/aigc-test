import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { teamRoleGuard } from '../../plugins/guards.js'
import type { CreateWorkspaceRequest } from '@aigc/types'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/workspaces — 创建工作区
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

    // 检查团队内工作区名称是否重复
    const existing = await db
      .selectFrom('workspaces')
      .select('id')
      .where('team_id', '=', request.params.id)
      .where('name', '=', name)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: 'WORKSPACE_NAME_TAKEN', message: `该团队下已有同名工作区"${name}"` },
      })
    }

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

    // 将创建者加入工作区（admin 角色）
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
}

export default route
