import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { CANVAS_ENABLED_TEAM_TYPES } from './_shared.js'

// GET /canvases/trash — 列出已删除的画布（回收站）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { workspace_id?: string } }>('/canvases/trash', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const filterWsId = request.query.workspace_id

    const memberships = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .innerJoin('teams', 'teams.id', 'workspaces.team_id')
      .select(['workspace_members.workspace_id', 'workspace_members.role'])
      .where('workspace_members.user_id', '=', userId)
      .where('teams.team_type', 'in', CANVAS_ENABLED_TEAM_TYPES)
      .execute()

    const targetWsIds = memberships.map((m) => m.workspace_id).filter((id) => !filterWsId || id === filterWsId)
    if (targetWsIds.length === 0) return reply.send([])

    const canvases = await db
      .selectFrom('canvases')
      .select(['id', 'name', 'thumbnail_url', 'created_at', 'updated_at', 'deleted_at', 'user_id', 'workspace_id'])
      .where('workspace_id', 'in', targetWsIds)
      .where('is_deleted', '=', true)
      .where((eb) => eb.or([
        eb('user_id', '=', userId),
        // 管理员可以看到工作区内所有人的已删除画布
        eb('workspace_id', 'in', memberships.filter((m) => m.role === 'admin').map((m) => m.workspace_id)),
      ]))
      .orderBy('deleted_at', 'desc')
      .execute()

    return reply.send(canvases)
  })
}

export default route
