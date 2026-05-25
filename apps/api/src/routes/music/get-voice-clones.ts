import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { mapMusicVoiceCloneResponse } from './_shared.js'

interface VoiceClonesQuery {
  workspace_id?: string
  limit?: string | number
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
  app.get<{ Querystring: VoiceClonesQuery }>('/music/voice-clones', async (request, reply) => {
    const workspaceId = request.query.workspace_id?.trim()
    if (!workspaceId) return badRequest(reply, 'workspace_id 不能为空')

    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 50) || 50))
    const db = getDb()

    if (!(await canReadWorkspace(db, workspaceId, request.user.id, request.user.role))) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '你无权访问此工作区' },
      })
    }

    const rows = await db
      .selectFrom('music_voice_clones')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .orderBy(sql`CASE WHEN status = 'ready' THEN 0 ELSE 1 END`)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()

    return reply.send({
      data: await Promise.all(rows.map((row) => mapMusicVoiceCloneResponse(row))),
    })
  })
}

export default route
