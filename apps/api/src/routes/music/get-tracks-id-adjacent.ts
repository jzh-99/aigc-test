import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { mapMusicTrackResponse } from './_shared.js'

async function canReadWorkspace(db: ReturnType<typeof getDb>, workspaceId: string, userId: string, userRole: 'admin' | 'member') {
  if (userRole === 'admin') return true
  const member = await db
    .selectFrom('workspace_members')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return Boolean(member)
}

async function fetchTrackForResponse(db: ReturnType<typeof getDb>, id: string) {
  return db
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
    .where('mt.id', '=', id)
    .executeTakeFirst()
}

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/music/tracks/:id/adjacent', async (request, reply) => {
    const db = getDb()
    const current = await db
      .selectFrom('music_tracks')
      .select(['id', 'workspace_id', 'created_at'])
      .where('id', '=', request.params.id)
      .executeTakeFirst()

    if (!current) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '音乐记录未找到' },
      })
    }

    if (!(await canReadWorkspace(db, current.workspace_id, request.user.id, request.user.role))) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '你无权访问此音乐记录' },
      })
    }

    const previousId = await db
      .selectFrom('music_tracks')
      .select('id')
      .where('workspace_id', '=', current.workspace_id)
      .where('created_at', '>', current.created_at)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst()

    const nextId = await db
      .selectFrom('music_tracks')
      .select('id')
      .where('workspace_id', '=', current.workspace_id)
      .where('created_at', '<', current.created_at)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()

    const [previous, next] = await Promise.all([
      previousId ? fetchTrackForResponse(db, previousId.id) : null,
      nextId ? fetchTrackForResponse(db, nextId.id) : null,
    ])

    return reply.send({
      previous: previous ? await mapMusicTrackResponse(previous, { name: previous.voice_name }) : null,
      next: next ? await mapMusicTrackResponse(next, { name: next.voice_name }) : null,
    })
  })
}

export default route
