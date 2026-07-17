import type { FastifyPluginAsync } from 'fastify'
import { Redis } from 'ioredis'
import { getDb } from '@aigc/db'
import {
  canReadMusicWorkspace,
  createMusicSseCleanup,
  mapMusicVoiceCloneResponse,
  sendMusicRouteError,
} from './_shared.js'

const ALLOWED_EVENTS = new Set(['status', 'ready', 'failed'])
const TERMINAL_STATUSES = new Set(['ready', 'failed'])

async function getVoiceCloneSnapshot(db: ReturnType<typeof getDb>, voiceCloneId: string) {
  const row = await db
    .selectFrom('music_voice_clones')
    .selectAll()
    .where('id', '=', voiceCloneId)
    .executeTakeFirst()
  return row ? mapMusicVoiceCloneResponse(row) : null
}

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/music/voice-clones/:id/events', async (request, reply) => {
    try {
      const db = getDb()
      const snapshot = await getVoiceCloneSnapshot(db, request.params.id)
      if (!snapshot) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '音色克隆记录未找到' },
        })
      }

      if (!(await canReadMusicWorkspace(db, snapshot.workspace_id, request.user.id, request.user.role))) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: '你无权访问此音色克隆记录' },
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
        sendEvent(snapshot.status, snapshot)
        raw.end()
        return reply.hijack()
      }

      const channel = `sse:music_voice_clone:${request.params.id}`
      const sub = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
      sub.on('error', (error) => app.log.error({ err: error, channel }, 'Music voice clone SSE Redis error'))
      const cleanup = createMusicSseCleanup({
        requestRaw: request.raw,
        raw,
        subscriber: sub,
        channel,
        logger: app.log,
      })
      const isConnectionClosed = () => cleanup.isCleaned() || request.raw.destroyed || raw.destroyed || raw.writableEnded

      try {
        await sub.subscribe(channel)
      } catch (error) {
        cleanup({ endRaw: false })
        throw error
      }

      if (isConnectionClosed()) {
        cleanup({ endRaw: false })
        return reply.hijack()
      }

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      sendEvent('status', snapshot)

      sub.on('message', async (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as { event?: string } & Record<string, unknown>
          const event = parsed.event && ALLOWED_EVENTS.has(parsed.event) ? parsed.event : 'status'
          sendEvent(event, parsed)
          if (event === 'ready' || event === 'failed') cleanup()
        } catch {
          const fresh = await getVoiceCloneSnapshot(db, request.params.id)
          if (!fresh) return
          const event = TERMINAL_STATUSES.has(fresh.status) ? fresh.status : 'status'
          sendEvent(event, fresh)
          if (TERMINAL_STATUSES.has(fresh.status)) cleanup()
        }
      })

      const heartbeat = setInterval(sendPing, 15_000)
      cleanup.setHeartbeat(heartbeat)

      return reply.hijack()
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music voice clone SSE request failed')
    }
  })
}

export default route
