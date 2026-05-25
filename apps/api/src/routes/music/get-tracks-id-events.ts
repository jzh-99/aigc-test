import type { FastifyPluginAsync } from 'fastify'
import { Redis } from 'ioredis'
import { getDb } from '@aigc/db'
import {
  canReadMusicWorkspace,
  createMusicSseCleanup,
  mapMusicTrackResponse,
  sendMusicRouteError,
} from './_shared.js'

const ALLOWED_EVENTS = new Set(['status', 'lyrics_delta', 'stream_url', 'completed', 'failed'])
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

async function getTrackSnapshot(db: ReturnType<typeof getDb>, trackId: string) {
  const row = await db
    .selectFrom('music_tracks as mt')
    .leftJoin('music_voice_clones as mvc', 'mvc.id', 'mt.voice_clone_id')
    .leftJoin('tasks as t', 't.id', 'mt.task_id')
    .selectAll('mt')
    .select([
      'mvc.name as voice_name',
      't.estimated_credits as estimated_credits',
      't.credits_cost as credits_cost',
      't.completed_at as completed_at',
    ])
    .where('mt.id', '=', trackId)
    .executeTakeFirst()
  return row ? mapMusicTrackResponse(row, { name: row.voice_name }) : null
}

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/music/tracks/:id/events', async (request, reply) => {
    try {
      const db = getDb()
      const snapshot = await getTrackSnapshot(db, request.params.id)
      if (!snapshot) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '音乐记录未找到' },
        })
      }

      if (!(await canReadMusicWorkspace(db, snapshot.workspace_id, request.user.id, request.user.role))) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: '你无权访问此音乐记录' },
        })
      }

      const raw = reply.raw

      const sendEvent = (event: string, data: unknown) => {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        ;(raw as any).flush?.()
      }
      const sendPing = () => {
        raw.write(': ping\n\n')
        ;(raw as any).flush?.()
      }

      if (TERMINAL_STATUSES.has(snapshot.status)) {
        raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        sendEvent('status', snapshot)
        raw.end()
        return reply.hijack()
      }

      const channel = `sse:music_track:${request.params.id}`
      const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
      sub.on('error', (error) => app.log.error({ err: error, channel }, 'Music SSE Redis error'))
      const cleanup = createMusicSseCleanup({
        requestRaw: request.raw,
        raw,
        subscriber: sub,
        channel,
        logger: app.log,
      })

      try {
        await sub.subscribe(channel)
      } catch (error) {
        cleanup({ endRaw: false })
        throw error
      }

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      sendEvent('status', snapshot)

      sub.on('message', async (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as { event?: string; data?: unknown }
          const event = parsed.event && ALLOWED_EVENTS.has(parsed.event) ? parsed.event : 'status'
          sendEvent(event, parsed.data ?? {})
          if (event === 'completed' || event === 'failed') cleanup()
        } catch {
          const fresh = await getTrackSnapshot(db, request.params.id)
          if (!fresh) return
          sendEvent(TERMINAL_STATUSES.has(fresh.status) ? fresh.status : 'status', fresh)
          if (TERMINAL_STATUSES.has(fresh.status)) cleanup()
        }
      })

      const heartbeat = setInterval(sendPing, 15_000)
      cleanup.setHeartbeat(heartbeat)

      return reply.hijack()
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music SSE request failed')
    }
  })
}

export default route
