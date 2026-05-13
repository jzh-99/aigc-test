import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/users/:id/diagnosis — 单用户错误诊断
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/admin/users/:id/diagnosis',
    async (request, reply) => {
      const db = getDb()
      const userId = request.params.id
      const limit = Math.min(parseInt(request.query.limit ?? '30', 10), 100)

      const user = await db
        .selectFrom('users')
        .select(['id', 'username', 'account', 'email', 'phone', 'status'])
        .where('id', '=', userId)
        .executeTakeFirst()
      if (!user) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } })

      const failedTasks = await db
        .selectFrom('tasks')
        .innerJoin('task_batches', 'task_batches.id', 'tasks.batch_id')
        .select([
          'tasks.id as task_id', 'tasks.batch_id', 'tasks.error_message',
          'tasks.status as task_status', 'tasks.retry_count', 'tasks.completed_at',
          'task_batches.module', 'task_batches.provider', 'task_batches.model',
          'task_batches.prompt', 'task_batches.status as batch_status',
          'task_batches.canvas_id', 'task_batches.canvas_node_id',
          'task_batches.created_at as submitted_at',
        ])
        .where('tasks.user_id', '=', userId)
        .where('tasks.status', '=', 'failed')
        .orderBy('task_batches.created_at', 'desc')
        .limit(limit)
        .execute()

      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const aiErrors = await db
        .selectFrom('ai_assistant_errors')
        .select(['id', 'http_status', 'error_detail', 'created_at'])
        .where('user_id', '=', userId)
        .where('created_at', '>=', since7d as any)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute()

      const submissionErrors = await db
        .selectFrom('submission_errors')
        .select(['id', 'source', 'error_code', 'http_status', 'detail', 'model', 'canvas_id', 'created_at'])
        .where('user_id', '=', userId)
        .where('created_at', '>=', since7d as any)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute()

      return {
        user,
        failed_tasks: failedTasks.map(t => ({
          ...t,
          source: t.canvas_id ? 'canvas' : 'generation',
          submitted_at: t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at),
          completed_at: t.completed_at instanceof Date ? t.completed_at.toISOString() : (t.completed_at ? String(t.completed_at) : null),
        })),
        ai_assistant_errors: aiErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
        submission_errors: submissionErrors.map(e => ({
          ...e,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        })),
      }
    },
  )
}

export default route
