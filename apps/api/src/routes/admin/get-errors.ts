import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'

// GET /admin/errors — 全局错误看板（近期失败任务 + AI 错误）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string; since?: string } }>('/admin/errors', async (request) => {
    const db = getDb()
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200)
    const sinceMs = parseInt(request.query.since ?? String(7 * 24 * 60 * 60 * 1000), 10)
    const since = new Date(Date.now() - sinceMs)

    const failedTasks = await db
      .selectFrom('tasks')
      .innerJoin('task_batches', 'task_batches.id', 'tasks.batch_id')
      .innerJoin('users', 'users.id', 'tasks.user_id')
      .select([
        'tasks.id as task_id', 'tasks.batch_id', 'tasks.error_message',
        'tasks.retry_count', 'tasks.completed_at',
        'task_batches.module', 'task_batches.provider', 'task_batches.model',
        'task_batches.prompt', 'task_batches.canvas_id',
        'task_batches.created_at as submitted_at',
        'users.id as user_id', 'users.username', 'users.account',
      ])
      .where('tasks.status', '=', 'failed')
      .where('task_batches.created_at', '>=', since as any)
      .orderBy('task_batches.created_at', 'desc')
      .limit(limit)
      .execute()

    const aiErrors = await db
      .selectFrom('ai_assistant_errors')
      .innerJoin('users', 'users.id', 'ai_assistant_errors.user_id')
      .select([
        'ai_assistant_errors.id', 'ai_assistant_errors.http_status',
        'ai_assistant_errors.error_detail', 'ai_assistant_errors.created_at',
        'users.id as user_id', 'users.username', 'users.account',
      ])
      .where('ai_assistant_errors.created_at', '>=', since as any)
      .orderBy('ai_assistant_errors.created_at', 'desc')
      .limit(limit)
      .execute()

    const submissionErrors = await db
      .selectFrom('submission_errors')
      .innerJoin('users', 'users.id', 'submission_errors.user_id')
      .select([
        'submission_errors.id', 'submission_errors.source', 'submission_errors.error_code',
        'submission_errors.http_status', 'submission_errors.detail', 'submission_errors.model',
        'submission_errors.canvas_id', 'submission_errors.created_at',
        'users.id as user_id', 'users.username', 'users.account',
      ])
      .where('submission_errors.created_at', '>=', since as any)
      .orderBy('submission_errors.created_at', 'desc')
      .limit(limit)
      .execute()

    const errorGroups = new Map<string, { count: number; last_seen: string; example: string }>()
    for (const t of failedTasks) {
      const key = (t.error_message ?? '（无错误信息）').slice(0, 120)
      const existing = errorGroups.get(key)
      const ts = t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at)
      if (!existing) {
        errorGroups.set(key, { count: 1, last_seen: ts, example: key })
      } else {
        existing.count++
        if (ts > existing.last_seen) existing.last_seen = ts
      }
    }
    for (const s of submissionErrors) {
      const key = `[提交:${s.source}] ${s.error_code}${s.http_status ? ` (HTTP ${s.http_status})` : ''}`
      const existing = errorGroups.get(key)
      const ts = s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at)
      if (!existing) {
        errorGroups.set(key, { count: 1, last_seen: ts, example: key })
      } else {
        existing.count++
        if (ts > existing.last_seen) existing.last_seen = ts
      }
    }
    const topErrors = [...errorGroups.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([message, stats]) => ({ message, ...stats }))

    return {
      failed_tasks: failedTasks.map(t => ({
        ...t,
        source: t.canvas_id ? 'canvas' : 'generation',
        submitted_at: t.submitted_at instanceof Date ? t.submitted_at.toISOString() : String(t.submitted_at),
        completed_at: t.completed_at instanceof Date ? t.completed_at.toISOString() : (t.completed_at ? String(t.completed_at) : null),
      })),
      ai_errors: aiErrors.map(e => ({
        ...e,
        created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
      })),
      submission_errors: submissionErrors.map(e => ({
        ...e,
        created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
      })),
      top_errors: topErrors,
      since: since.toISOString(),
    }
  })
}

export default route
