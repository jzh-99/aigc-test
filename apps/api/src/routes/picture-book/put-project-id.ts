import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { isPictureBookPageCount, isPictureBookStyle, normalizePictureBookState } from '@aigc/types'
import { assertPictureBookProjectAccess, assertPictureBookWorkspaceAccess } from './_shared.js'

type ProjectStatus = 'draft' | 'script_ready' | 'assets_ready' | 'storyboard_ready' | 'completed' | 'failed'

interface PutProjectBody {
  workspace_id: string
  title: string
  prompt: string
  style: string
  page_count: number
  state: unknown
  status?: ProjectStatus
  cover_url?: string | null
}

const notFound = { error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } }

const route: FastifyPluginAsync = async (app) => {
  app.put<{ Params: { id: string }; Body: PutProjectBody }>(
    '/picture-book/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspace_id', 'title', 'prompt', 'style', 'page_count', 'state'],
          properties: {
            workspace_id: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            prompt: { type: 'string' },
            style: { type: 'string' },
            page_count: { type: 'number', enum: [10, 15, 20] },
            state: { type: 'object' },
            status: { type: 'string', enum: ['draft', 'script_ready', 'assets_ready', 'storyboard_ready', 'completed', 'failed'] },
            cover_url: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params
      const body = request.body
      const title = body.title.trim()
      const pageCount = body.page_count

      if (!title) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '标题不能为空' } })
      if (!isPictureBookStyle(body.style)) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '绘本风格不支持' } })
      if (!isPictureBookPageCount(pageCount)) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '页数不支持' } })

      const workspaceAccess = await assertPictureBookWorkspaceAccess(body.workspace_id, userId, true)
      if (!workspaceAccess) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权修改该工作区' } })

      const existing = await db
        .selectFrom('picture_book_projects')
        .select(['workspace_id', 'is_deleted'])
        .where('id', '=', id)
        .executeTakeFirst()

      if (existing?.is_deleted) return reply.status(404).send(notFound)
      if (existing) {
        const projectAccess = await assertPictureBookProjectAccess(id, userId, true)
        if (!projectAccess) return reply.status(404).send(notFound)
        if (existing.workspace_id !== body.workspace_id) {
          return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'workspace mismatch' } })
        }
      }

      const state = normalizePictureBookState(body.state)
      const status = body.status ?? 'draft'

      await db
        .insertInto('picture_book_projects')
        .values({
          id,
          workspace_id: body.workspace_id,
          team_id: workspaceAccess.teamId,
          user_id: userId,
          title,
          prompt: body.prompt,
          style: body.style,
          page_count: pageCount,
          status,
          active_step: state.steps.active,
          cover_url: body.cover_url ?? null,
          state: JSON.stringify(state),
          draft_saved_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            title,
            prompt: body.prompt,
            style: body.style,
            page_count: pageCount,
            status,
            active_step: state.steps.active,
            cover_url: body.cover_url ?? null,
            state: JSON.stringify(state) as any,
            draft_saved_at: sql`now()`,
            updated_at: sql`now()`,
          }),
        )
        .execute()

      return reply.send({ success: true })
    },
  )

  app.patch<{ Params: { id: string }; Body: { state: unknown } }>(
    '/picture-book/projects/:id/draft',
    {
      schema: {
        body: {
          type: 'object',
          required: ['state'],
          properties: { state: { type: 'object' } },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const access = await assertPictureBookProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send(notFound)

      const state = normalizePictureBookState(request.body.state)
      const nextStatus = access.status === 'completed' ? 'completed' : access.status || 'draft'

      await db
        .updateTable('picture_book_projects')
        .set({
          state: JSON.stringify(state) as any,
          active_step: state.steps.active,
          status: nextStatus as ProjectStatus,
          draft_saved_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', false)
        .execute()

      return reply.send({ success: true, draft_saved_at: new Date().toISOString() })
    },
  )

  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/picture-book/projects/:id/name',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim()
      if (!title) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '标题不能为空' } })

      const access = await assertPictureBookProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send(notFound)

      await getDb()
        .updateTable('picture_book_projects')
        .set({ title, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', false)
        .execute()

      return reply.send({ success: true, title })
    },
  )
}

export default route
