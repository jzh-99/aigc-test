import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertCanvasEnabledForWorkspace } from './_shared.js'

// GET /canvases/:id/active-tasks — 轮询画布执行进度（高频接口，单独限速）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/canvases/:id/active-tasks', {
    config: {
      rateLimit: {
        max: 240,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    try {
      await assertCanvasEnabledForWorkspace(db, canvas.workspace_id)
    } catch {
      return reply.status(403).send({ success: false, error: { code: 'CANVAS_DISABLED', message: '当前团队未开通画布能力' } })
    }

    // 从 Redis 读取脏版本号
    const redis = (app as any).redis
    let dirtyVersion = 0
    try {
      dirtyVersion = parseInt(await redis.get(`canvas:dirty:${id}`) ?? '0', 10)
    } catch (error) {
      request.log.warn({ err: error, canvasId: id }, 'Failed to read canvas dirty version')
    }

    // 获取该画布的活跃批次
    const activeRows = await db
      .selectFrom('task_batches')
      .select(['id', 'canvas_node_id', 'status', 'quantity', 'completed_count', 'failed_count', 'provider', 'created_at'])
      .where('canvas_id', '=', id)
      .where('status', 'in', ['pending', 'processing'])
      .execute()

    const batches = await Promise.all(activeRows.map(async (batch: any) => {
      // 计算队列位置（仅 pending 状态）
      const queuePosition = batch.status === 'pending'
        ? Number((await db
            .selectFrom('task_batches')
            .select((eb: any) => eb.fn.countAll().as('count'))
            .where('is_deleted', '=', false)
            .where('status', '=', 'pending')
            .where('provider', '=', batch.provider)
            .where('created_at', '<', batch.created_at)
            .executeTakeFirst() as any)?.count ?? 0)
        : null
      const processing = await db
        .selectFrom('tasks')
        .select('processing_started_at')
        .where('batch_id', '=', batch.id)
        .where('processing_started_at', 'is not', null)
        .orderBy('processing_started_at', 'asc')
        .executeTakeFirst()
      return {
        id: batch.id,
        canvas_node_id: batch.canvas_node_id,
        status: batch.status,
        quantity: batch.quantity,
        completed_count: batch.completed_count,
        failed_count: batch.failed_count,
        queue_position: queuePosition,
        processing_started_at: processing?.processing_started_at ?? null,
      }
    }))

    return reply.send({ version: dirtyVersion, batches })
  })
}

export default route
