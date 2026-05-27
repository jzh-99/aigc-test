import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertPictureBookProjectAccess, calculateProjectChargeTotal } from './_shared.js'

const notFound = { error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } }

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/picture-book/projects/:id', async (request, reply) => {
    const access = await assertPictureBookProjectAccess(request.params.id, request.user.id)
    if (!access) return reply.status(404).send(notFound)

    return reply.send(access)
  })

  app.get<{ Params: { id: string } }>('/picture-book/projects/:id/charges', async (request, reply) => {
    const access = await assertPictureBookProjectAccess(request.params.id, request.user.id)
    if (!access) return reply.status(404).send(notFound)

    const charges = await getDb()
      .selectFrom('picture_book_project_charges')
      .selectAll()
      .where('project_id', '=', request.params.id)
      .orderBy('created_at', 'desc')
      .execute()

    return reply.send({
      charges,
      summary: calculateProjectChargeTotal(charges),
    })
  })
}

export default route
