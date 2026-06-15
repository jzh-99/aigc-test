import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { Redis } from 'ioredis'
import { getBatchSnapshot, isTerminal } from '../../lib/batch-snapshot.js'
import { buildLogger } from '../../logger.js'

const logger = buildLogger()

function hasPendingAssetTransfers(batch: Awaited<ReturnType<typeof getBatchSnapshot>>): boolean {
  return Boolean(batch?.tasks?.some((task: any) =>
    task.status === 'completed' &&
    task.asset &&
    task.asset.transfer_status === 'pending'
  ))
}

function shouldCloseSse(batch: Awaited<ReturnType<typeof getBatchSnapshot>>): boolean {
  return Boolean(batch && isTerminal(batch.status) && !hasPendingAssetTransfers(batch))
}

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
      logger.warn({ batchId, userId: request.user.id }, 'Batch not found')
      return reply.notFound('Batch not found')
    }

    logger.info({ batchId, userId: request.user.id }, '客户端请求连接，验证权限中')

    if (batch.user_id !== request.user.id && request.user.role !== 'admin') {
      if (batch.workspace_id) {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', batch.workspace_id)
          .where('user_id', '=', request.user.id)
          .executeTakeFirst()
        if (!wsMember) {
          logger.warn({ batchId, userId: request.user.id }, '用户不在工作区，拒绝访问')
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
          })
        }
      } else {
        logger.warn({ batchId, userId: request.user.id }, '非 batch 创建者且无权限，拒绝访问')
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
        })
      }
    }
    logger.info({ batchId, userId: request.user.id }, '权限验证通过')

    // 设置 SSE 响应头
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // 'X-Accel-Buffering': 'no', // 防止 Nginx 等代理缓冲
    })

    // 发送 SSE 事件的辅助函数
    const sendEvent = (data: unknown) => {
      const eventString = `event: batch_update\ndata: ${JSON.stringify(data)}\n\n`
      if (raw.socket) {
        raw.socket.cork()
        try {
          raw.write(eventString)
          // 强制刷新缓冲区
          ;(raw as any).flush?.()
          raw.socket.write('') // 空写触发刷新
        } finally {
          raw.socket.uncork()
        }
      } else {
        raw.write(eventString)
        ;(raw as any).flush?.()
      }
    }

    const sendPing = () => {
      const pingString = ': ping\n\n'
      if (raw.socket) {
        raw.socket.cork()
        try {
          raw.write(pingString)
          ;(raw as any).flush?.()
          raw.socket.write('')
        } finally {
          raw.socket.uncork()
        }
      } else {
        raw.write(pingString)
        ;(raw as any).flush?.()
      }
    }

    // 发送初始快照
    const snapshot = await getBatchSnapshot(batchId)
    if (!snapshot) {
      logger.error({ batchId }, '获取初始快照失败')
      raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Batch not found' })}\n\n`)
      raw.end()
      return reply.hijack()
    }
    logger.info({ batchId, status: snapshot.status }, '初始快照已发送')
    sendEvent(snapshot)

    // 若已是终态，直接关闭连接
    if (shouldCloseSse(snapshot)) {
      logger.info({ batchId, status: snapshot.status }, '初始状态已是终态且资产转存结束，关闭连接')
      raw.end()
      return reply.hijack()
    }

    // 订阅 Redis Pub/Sub 频道
    const channel = `sse:batch:${batchId}`
    logger.info({ batchId, channel }, '准备订阅 Redis Pub/Sub 频道')
    const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    sub.on('error', (err) => logger.error({ batchId, err }, 'Redis 订阅错误'))

    await sub.subscribe(channel)
    logger.info({ batchId, channel }, 'Redis Pub/Sub 订阅成功')

    sub.on('message', async (_ch: string, _msg: string) => {
      logger.info({ batchId }, '收到 Redis 消息，准备获取快照')
      try {
        const fresh = await getBatchSnapshot(batchId)
        if (fresh) {
          logger.info({ batchId, status: fresh.status, completedCount: fresh.completed_count }, '推送 batch_update 事件到客户端')
          sendEvent(fresh)
          if (shouldCloseSse(fresh)) {
            logger.info({ batchId, status: fresh.status }, '检测到终态且资产转存结束，准备关闭连接')
            cleanup()
          }
        } else {
          logger.warn({ batchId }, '获取快照返回 null')
        }
      } catch (err) {
        logger.error({ batchId, err }, '处理 SSE 消息时出错')
      }
    })

    // 心跳，每 15 秒发送一次 ping 保持连接（视频任务可能需要几分钟，间隔太长会导致连接断开）
    logger.info({ batchId }, '启动心跳，每 15 秒发送一次 ping')
    const heartbeat = setInterval(() => {
      logger.info({ batchId }, '发送心跳 ping')
      sendPing()
    }, 15_000)

    // 清理函数：取消订阅、关闭连接（幂等，防止重复调用）
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      logger.info({ batchId }, '执行清理：取消订阅、关闭连接')
      clearInterval(heartbeat)
      sub.unsubscribe(channel).catch((err) => logger.error({ batchId, err }, '取消订阅失败'))
      sub.quit().catch((err) => logger.error({ batchId, err }, 'Redis 连接关闭失败'))
      setImmediate(() => raw.end())
    }

    // 客户端断开时清理资源
    request.raw.on('close', () => {
      logger.info({ batchId }, '客户端连接已关闭，触发清理')
      cleanup()
    })

    return reply.hijack()
  })
}

export default route
