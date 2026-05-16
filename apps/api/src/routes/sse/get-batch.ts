import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { Redis } from 'ioredis'
import { getBatchSnapshot, isTerminal } from '../../lib/batch-snapshot.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /sse/batches/:id — 通过 Server-Sent Events 实时推送批次状态更新
  app.get<{ Params: { id: string } }>('/sse/batches/:id', async (request, reply) => {
    const { id: batchId } = request.params
    const db = getDb()

    // 鉴权：验证用户是否有权访问该批次
    const batch = await db
      .selectFrom('task_batches')
      .select(['user_id', 'workspace_id'])
      .where('id', '=', batchId)
      .executeTakeFirst()

    if (!batch) {
      return reply.notFound('Batch not found')
    }

    if (batch.user_id !== request.user.id && request.user.role !== 'admin') {
      if (batch.workspace_id) {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', batch.workspace_id)
          .where('user_id', '=', request.user.id)
          .executeTakeFirst()
        if (!wsMember) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
          })
        }
      } else {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
        })
      }
    }

    // 设置 SSE 响应头
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    // 发送 SSE 事件的辅助函数
    const sendEvent = (data: unknown) => {
      raw.write(`event: batch_update\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const sendPing = () => {
      raw.write(': ping\n\n')
    }

    // 发送初始快照
    const snapshot = await getBatchSnapshot(batchId)
    if (!snapshot) {
      raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Batch not found' })}\n\n`)
      raw.end()
      return reply.hijack()
    }

    sendEvent(snapshot)

    // 若已是终态，直接关闭连接
    if (isTerminal(snapshot.status)) {
      raw.end()
      return reply.hijack()
    }

    // 订阅 Redis Pub/Sub 频道
    const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    // 防止客户端断开时 EPIPE 错误导致进程崩溃
    sub.on('error', () => {})
    const channel = `sse:batch:${batchId}`

    await sub.subscribe(channel)

    sub.on('message', async (_ch: string, _msg: string) => {
      try {
        const fresh = await getBatchSnapshot(batchId)
        if (fresh) {
          sendEvent(fresh)
          if (isTerminal(fresh.status)) {
            cleanup()
          }
        }
      } catch {
        // 忽略 SSE 推送过程中的错误
      }
    })

    // 心跳，每 30 秒发送一次 ping 保持连接
    const heartbeat = setInterval(sendPing, 30_000)

    // 清理函数：取消订阅、关闭连接
    const cleanup = () => {
      clearInterval(heartbeat)
      sub.unsubscribe(channel).catch(() => {})
      sub.quit().catch(() => {})
      raw.end()
    }

    // 客户端断开时清理资源
    request.raw.on('close', cleanup)

    return reply.hijack()
  })
}

export default route
