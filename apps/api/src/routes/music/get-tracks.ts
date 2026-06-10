import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { getDb } from '@aigc/db'
import {
  canReadMusicWorkspace,
  decodeMusicTrackCursor,
  encodeMusicTrackCursor,
  mapMusicTrackResponse,
  sendMusicRouteError,
} from './_shared.js'

interface TracksQuery {
  workspace_id?: string
  page?: string | number
  limit?: string | number
  cursor?: string
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    success: false,
    error: { code: 'BAD_REQUEST', message },
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TracksQuery }>('/music/tracks', async (request, reply) => {
    try {
      const workspaceId = request.query.workspace_id?.trim()
      if (!workspaceId) return badRequest(reply, 'workspace_id 不能为空')

      const page = Math.max(1, Number(request.query.page ?? 1) || 1)
      const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20) || 20))
      const db = getDb()

      if (!(await canReadMusicWorkspace(db, workspaceId, request.user.id, request.user.role))) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: '你无权访问此工作区' },
        })
      }

      let query = db
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
        .where('mt.workspace_id', '=', workspaceId)

      // 查询总数（用于分页导航）
      const [{ count: total }] = await db
        .selectFrom('music_tracks')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('workspace_id', '=', workspaceId)
        .execute()

      if (request.query.cursor) {
        let cursor: ReturnType<typeof decodeMusicTrackCursor>
        try {
          cursor = decodeMusicTrackCursor(request.query.cursor)
        } catch {
          return badRequest(reply, 'cursor 不是有效时间')
        }
        query = cursor.id
          ? query.where((eb: any) =>
            eb.or([
              eb('mt.created_at', '<', cursor.createdAt),
              eb.and([
                eb('mt.created_at', '=', cursor.createdAt),
                eb('mt.id', '<', cursor.id),
              ]),
            ]),
          )
          : query.where('mt.created_at', '<', cursor.createdAt)
      } else {
        query = query.offset((page - 1) * limit)
      }

      const rows = await query
        .orderBy('mt.created_at', 'desc')
        .orderBy('mt.id', 'desc')
        .limit(limit + 1)
        .execute()

      const pageRows = rows.slice(0, limit)
      const data = await Promise.all(pageRows.map((row) => mapMusicTrackResponse(row, { name: row.voice_name })))
      const last = pageRows.at(-1)

      return reply.send({
        data,
        page,
        page_size: limit,
        total: Number(total),
        total_pages: Math.ceil(Number(total) / limit),
        has_more: rows.length > limit,
        next_cursor: rows.length > limit && last ? encodeMusicTrackCursor(last) : null,
      })
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music track list request failed')
    }
  })
}

export default route
