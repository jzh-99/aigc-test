import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertPictureBookWorkspaceAccess } from './_shared.js'

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), 1), max)
}

const projectListFields = [
  'id',
  'workspace_id',
  'team_id',
  'user_id',
  'title',
  'prompt',
  'style',
  'page_count',
  'status',
  'active_step',
  'cover_url',
  'draft_saved_at',
  'estimated_credits',
  'actual_credits',
  'created_at',
  'updated_at',
] as const

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { workspace_id: string; limit?: number } }>(
    '/picture-book/projects/recent',
    async (request, reply) => {
      const workspaceId = request.query.workspace_id
      if (!workspaceId) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'workspace_id required' } })

      const access = await assertPictureBookWorkspaceAccess(workspaceId, request.user.id)
      if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权访问该工作区' } })

      const limit = normalizeLimit(request.query.limit, 4, 20)
      const projects = await getDb()
        .selectFrom('picture_book_projects')
        .select(projectListFields)
        .where('workspace_id', '=', workspaceId)
        .where('is_deleted', '=', false)
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute()

      return reply.send(projects)
    },
  )

  app.get<{ Querystring: { workspace_id: string; limit?: number } }>('/picture-book/projects', async (request, reply) => {
    const workspaceId = request.query.workspace_id
    if (!workspaceId) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'workspace_id required' } })

    const access = await assertPictureBookWorkspaceAccess(workspaceId, request.user.id)
    if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权访问该工作区' } })

    const limit = normalizeLimit(request.query.limit, 30, 100)
    const projects = await getDb()
      .selectFrom('picture_book_projects')
      .select(projectListFields)
      .where('workspace_id', '=', workspaceId)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute()

    return reply.send(projects)
  })
}

export default route
