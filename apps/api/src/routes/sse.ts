import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import Redis from 'ioredis'
import { signAssetUrl } from '../lib/storage.js'

async function getBatchSnapshot(batchId: string) {
  const db = getDb()

  const batch = await db
    .selectFrom('task_batches')
    .selectAll()
    .where('id', '=', batchId)
    .executeTakeFirst()

  if (!batch) return null

  const tasks = await db
    .selectFrom('tasks')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute()

  const assets = await db
    .selectFrom('assets')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute()

  const assetByTask: Map<string, any> = new Map(assets.map((a: any) => [a.task_id, a]))

  return {
    id: batch.id,
    module: batch.module,
    provider: batch.provider,
    model: batch.model,
    prompt: batch.prompt,
    params: batch.params,
    quantity: batch.quantity,
    completed_count: batch.completed_count,
    failed_count: batch.failed_count,
    status: batch.status,
    estimated_credits: batch.estimated_credits,
    actual_credits: batch.actual_credits,
    created_at: batch.created_at.toISOString?.() ?? String(batch.created_at),
    tasks: await Promise.all(tasks.map(async (t: any) => {
      const asset = assetByTask.get(t.id)
      return {
        id: t.id,
        version_index: t.version_index,
        status: t.status,
        estimated_credits: t.estimated_credits,
        credits_cost: t.credits_cost,
        error_message: t.error_message,
        processing_started_at: t.processing_started_at?.toISOString?.() ?? t.processing_started_at ?? null,
        completed_at: t.completed_at?.toISOString?.() ?? t.completed_at ?? null,
        asset: asset
          ? {
              id: asset.id,
              type: asset.type,
              original_url: asset.original_url,
              storage_url: await signAssetUrl(asset.storage_url),
              transfer_status: asset.transfer_status,
              file_size: asset.file_size,
              width: asset.width,
              height: asset.height,
            }
          : null,
      }
    })),
  }
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'partial_complete'
}

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
