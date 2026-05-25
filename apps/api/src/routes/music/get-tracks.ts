import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { getDb } from '@aigc/db'
import { mapMusicTrackResponse } from './_shared.js'

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

async function canReadWorkspace(db: ReturnType<typeof getDb>, workspaceId: string, userId: string, userRole: 'admin' | 'member') {
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select('workspace_members.role')
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_deleted', '=', false)
    .executeTakeFirst()

  if (member) return true
  if (userRole !== 'admin') return false

  const workspace = await db
    .selectFrom('workspaces')
    .select('id')
    .where('id', '=', workspaceId)
    .where('is_deleted', '=', false)
    .executeTakeFirst()
  return Boolean(workspace)
}

const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TracksQuery }>('/music/tracks', async (request, reply) => {
    const workspaceId = request.query.workspace_id?.trim()
    if (!workspaceId) return badRequest(reply, 'workspace_id 不能为空')

    const page = Math.max(1, Number(request.query.page ?? 1) || 1)
    const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20) || 20))
    const db = getDb()

    if (!(await canReadWorkspace(db, workspaceId, request.user.id, request.user.role))) {
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

    if (request.query.cursor) {
      const cursorDate = new Date(request.query.cursor)
      if (Number.isNaN(cursorDate.getTime())) return badRequest(reply, 'cursor 不是有效时间')
      query = query.where('mt.created_at', '<', cursorDate)
    } else {
      query = query.offset((page - 1) * limit)
    }

    const rows = await query
      .orderBy('mt.created_at', 'desc')
      .limit(limit + 1)
      .execute()

    const pageRows = rows.slice(0, limit)
    const data = await Promise.all(pageRows.map((row) => mapMusicTrackResponse(row, { name: row.voice_name })))
    const last = pageRows.at(-1)

    return reply.send({
      data,
      page,
      page_size: limit,
      has_more: rows.length > limit,
      next_cursor: rows.length > limit && last ? last.created_at.toISOString?.() ?? String(last.created_at) : null,
    })
  })
}

export default route
