import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertProjectAccess } from './_shared.js'

// GET /video-studio/projects — 获取工作区项目列表（不含系列子集）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { workspace_id: string } }>(
    '/video-studio/projects',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { workspace_id } = request.query
      if (!workspace_id) return reply.status(400).send({ error: 'workspace_id required' })

      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })

      const projects = await db
        .selectFrom('video_studio_projects')
        .select(['id', 'name', 'created_at', 'updated_at', 'project_type', 'series_parent_id', 'episode_index'])
        .where('workspace_id', '=', workspace_id)
        .where('is_deleted', '=', false)
        .where('series_parent_id', 'is', null)
        .where((eb) => eb.or([
          eb('user_id', '=', userId),
          eb.exists(db
            .selectFrom('workspace_members')
            .select('workspace_id')
            .where('workspace_id', '=', workspace_id)
            .where('user_id', '=', userId)
            .where('role', '=', 'admin')),
        ]))
        .orderBy('updated_at', 'desc')
        .execute()

      return reply.send(projects)
    },
  )

  // GET /video-studio/projects/trash — 获取已删除项目列表
  app.get<{ Querystring: { workspace_id: string } }>('/video-studio/projects/trash', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const { workspace_id } = request.query
    if (!workspace_id) return reply.status(400).send({ error: 'workspace_id required' })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', workspace_id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ error: 'forbidden' })

    const projects = await db
      .selectFrom('video_studio_projects')
      .select(['id', 'name', 'created_at', 'updated_at', 'deleted_at', 'user_id', 'workspace_id'])
      .where('workspace_id', '=', workspace_id)
      .where('is_deleted', '=', true)
      .where((eb) => member.role === 'admin' ? eb.val(true) : eb('user_id', '=', userId))
      .orderBy('deleted_at', 'desc')
      .execute()

    return reply.send(projects)
  })

  // GET /video-studio/projects/:id/episodes — 获取系列剧集列表
  app.get<{ Params: { id: string } }>('/video-studio/projects/:id/episodes', async (request, reply) => {
    const db = getDb()
    const access = await assertProjectAccess(request.params.id, request.user.id)
    if (!access) return reply.status(404).send({ error: 'not found' })

    const episodes = await db
      .selectFrom('video_studio_projects')
      .select(['id', 'name', 'created_at', 'updated_at', 'project_type', 'series_parent_id', 'episode_index', 'wizard_state'])
      .where('series_parent_id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .orderBy('episode_index', 'asc')
      .execute()

    return reply.send(episodes)
  })
}

export default route
