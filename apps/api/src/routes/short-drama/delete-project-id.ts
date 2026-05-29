import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import { assertShortDramaProjectAccess } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.delete<{
    Params: { id: string }
  }>('/short-drama/projects/:id', async (request, reply) => {
    const { id } = request.params

    // 校验项目访问权限（需要写权限）
    try {
      await assertShortDramaProjectAccess(id, request.user.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目不存在'
      return reply.status(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message }
      })
    }

    // 软删除项目
    await getDb()
      .updateTable('short_drama_projects')
      .set({
        is_deleted: true,
        deleted_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute()

    return { ok: true }
  })
}

export default route
