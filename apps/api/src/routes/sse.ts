import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { Redis } from 'ioredis'
import { getBatchSnapshot, isTerminal } from '../lib/batch-snapshot.js'

export async function sseRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/sse/batches/:id', async (request, reply) => {
    const { id: batchId } = request.params
    const db = getDb()

    // Authorization check: verify user has access to this batch
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

    // Set SSE headers on raw response
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    // Helper to send SSE event
    const sendEvent = (data: unknown) => {
      raw.write(`event: batch_update\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const sendPing = () => {
      raw.write(': ping\n\n')
    }

    // Send initial snapshot
    const snapshot = await getBatchSnapshot(batchId)
    if (!snapshot) {
      raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Batch not found' })}\n\n`)
      raw.end()
      return reply.hijack()
    }

    sendEvent(snapshot)

    // If already terminal, close
    if (isTerminal(snapshot.status)) {
      raw.end()
      return reply.hijack()
    }

    // Subscribe to Redis Pub/Sub
    const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
    sub.on('error', () => {}) // prevent unhandled EPIPE from crashing the process on client disconnect
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
        // ignore errors during SSE
      }
    })

    // Heartbeat
    const heartbeat = setInterval(sendPing, 30_000)

    // Cleanup function
    const cleanup = () => {
      clearInterval(heartbeat)
      sub.unsubscribe(channel).catch(() => {})
      sub.quit().catch(() => {})
      raw.end()
    }

    // Cleanup on client disconnect
    request.raw.on('close', cleanup)

    return reply.hijack()
  })
}
