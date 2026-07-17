import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { workspaceGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /workspaces/:id — 工作区详情
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
}

export default route
