import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

const route: FastifyPluginAsync = async (app) => {
  // GET /batches/stats — 返回当前用户（或工作区）全量生成统计
  app.get<{ Querystring: { workspace_id?: string } }>(
    '/batches/stats',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const workspaceId = request.query.workspace_id

      // 校验工作区成员身份
      if (workspaceId && request.user.role !== 'admin') {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', workspaceId)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!wsMember) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' },
          })
        }
      }

      let query = db
        .selectFrom('task_batches')
        .select([
          sql<string>`COALESCE(SUM(completed_count), 0)`.as('total_completed'),
          sql<string>`COALESCE(SUM(failed_count), 0)`.as('total_failed'),
        ])
        .where('is_deleted', '=', false)
        .where('is_hidden', '=', false)
        .where('canvas_id', 'is', null)
        .where('video_studio_project_id', 'is', null)
        .where('short_drama_project_id', 'is', null)
        .where('module', 'not in', ['music', 'music_voice_clone'])

      if (workspaceId) {
        query = query.where('workspace_id', '=', workspaceId)
      } else if (request.user.role !== 'admin') {
        query = query.where('user_id', '=', userId)
      }

      const compiled = await query.compile()
      const row = await query.executeTakeFirstOrThrow()

      const totalCompleted = parseInt(row.total_completed, 10)
      const totalFailed = parseInt(row.total_failed, 10)
      const totalFinished = totalCompleted + totalFailed

      return reply.send({
        total_completed: totalCompleted,
        total_failed: totalFailed,
        success_rate: totalFinished > 0 ? Math.round((totalCompleted / totalFinished) * 100) : null,
      })
    },
  )
}

export default route
