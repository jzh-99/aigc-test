import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertProjectAccess } from './_shared.js'

// PUT /video-studio/projects/:id — upsert 项目（创建或更新）
const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { id: string }
    Body: { workspace_id: string; name: string; wizard_state: unknown; project_type?: 'single' | 'series' | 'episode'; series_parent_id?: string | null; episode_index?: number | null }
  }>(
    '/video-studio/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspace_id', 'name', 'wizard_state'],
          properties: {
            workspace_id: { type: 'string' },
            name: { type: 'string', maxLength: 200 },
            wizard_state: { type: 'object' },
            project_type: { type: 'string', enum: ['single', 'series', 'episode'] },
            series_parent_id: { type: ['string', 'null'] },
            episode_index: { type: ['number', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params
      const { workspace_id, name, wizard_state, project_type = 'single', series_parent_id = null, episode_index = null } = request.body

      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })

      const existing = await db
        .selectFrom('video_studio_projects')
        .select(['workspace_id', 'is_deleted'])
        .where('id', '=', id)
        .executeTakeFirst()
      if (existing?.is_deleted) return reply.status(404).send({ error: 'not found' })
      if (existing) {
        const access = await assertProjectAccess(id, userId, true)
        if (!access) return reply.status(404).send({ error: 'not found' })
        if (existing.workspace_id !== workspace_id) return reply.status(400).send({ error: 'workspace mismatch' })
      }

      if (series_parent_id) {
        const parent = await db
          .selectFrom('video_studio_projects')
          .select('workspace_id')
          .where('id', '=', series_parent_id)
          .where('workspace_id', '=', workspace_id)
          .where('is_deleted', '=', false)
          .executeTakeFirst()
        if (!parent) return reply.status(400).send({ error: 'series parent not found' })
        const parentAccess = await assertProjectAccess(series_parent_id, userId, true)
        if (!parentAccess) return reply.status(404).send({ error: 'not found' })
      }

      await db
        .insertInto('video_studio_projects')
        .values({
          id,
          workspace_id,
          user_id: userId,
          name,
          wizard_state: JSON.stringify(wizard_state),
          project_type,
          series_parent_id,
          episode_index,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            name,
            wizard_state: JSON.stringify(wizard_state) as any,
            project_type,
            series_parent_id,
            episode_index,
            updated_at: sql`now()`,
          }),
        )
        .execute()

      return reply.send({ success: true })
    },
  )

  // PATCH /video-studio/projects/:id/name — 修改项目名称
  app.patch<{
    Params: { id: string }
    Body: { name: string }
  }>(
    '/video-studio/projects/:id/name',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const name = request.body.name.trim()
      if (!name) return reply.status(400).send({ error: 'name required' })

      const access = await assertProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: 'not found' })

      await db
        .updateTable('video_studio_projects')
        .set({ name, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', false)
        .execute()

      return reply.send({ success: true, name })
    },
  )
}

export default route
