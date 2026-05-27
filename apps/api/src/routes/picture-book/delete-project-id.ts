import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess } from './_shared.js'

const notFound = { error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } }

async function assertDeletedProjectWriteAccess(projectId: string, userId: string) {
  const project = await getDb()
    .selectFrom('picture_book_projects')
    .innerJoin('workspaces', 'workspaces.id', 'picture_book_projects.workspace_id')
    .innerJoin('workspace_members', 'workspace_members.workspace_id', 'picture_book_projects.workspace_id')
    .select(['picture_book_projects.id', 'workspace_members.role'])
    .where('picture_book_projects.id', '=', projectId)
    .where('picture_book_projects.is_deleted', '=', true)
    .where('workspaces.is_deleted', '=', false)
    .where('workspace_members.user_id', '=', userId)
    .executeTakeFirst()

  if (!project || project.role === 'viewer') return null
  return project
}

const route: FastifyPluginAsync = async (app) => {
  app.delete<{ Params: { id: string } }>('/picture-book/projects/:id', async (request, reply) => {
    const access = await assertPictureBookProjectAccess(request.params.id, request.user.id, true)
    if (!access) return reply.status(404).send(notFound)

    await getDb()
      .updateTable('picture_book_projects')
      .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', request.params.id)
      .where('is_deleted', '=', false)
      .execute()

    return reply.send({ success: true })
  })

  app.post<{ Params: { id: string } }>('/picture-book/projects/:id/restore', async (request, reply) => {
    const access = await assertDeletedProjectWriteAccess(request.params.id, request.user.id)
    if (!access) return reply.status(404).send(notFound)

    await getDb()
      .updateTable('picture_book_projects')
      .set({ is_deleted: false, deleted_at: null, updated_at: sql`now()` })
      .where('id', '=', request.params.id)
      .where('is_deleted', '=', true)
      .execute()

    return reply.send({ success: true })
  })

  app.delete<{ Params: { id: string } }>('/picture-book/projects/:id/permanent', async (request, reply) => {
    const activeAccess = await assertPictureBookProjectAccess(request.params.id, request.user.id, true)
    const deletedAccess = activeAccess ? null : await assertDeletedProjectWriteAccess(request.params.id, request.user.id)
    if (!activeAccess && !deletedAccess) return reply.status(404).send(notFound)

    await getDb()
      .deleteFrom('picture_book_projects')
      .where('id', '=', request.params.id)
      .execute()

    return reply.send({ success: true })
  })
}

export default route
