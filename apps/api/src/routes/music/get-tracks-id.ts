import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { canReadMusicWorkspace, mapMusicTrackResponse, sendMusicRouteError } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/music/tracks/:id', async (request, reply) => {
    try {
      const db = getDb()
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
        .where('mt.id', '=', request.params.id)
        .executeTakeFirst()

      if (!row) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '音乐记录未找到' },
        })
      }

      if (!(await canReadMusicWorkspace(db, row.workspace_id, request.user.id, request.user.role))) {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: '你无权访问此音乐记录' },
        })
      }

      return reply.send(await mapMusicTrackResponse(row, { name: row.voice_name }))
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music track detail request failed')
    }
  })
}

export default route
