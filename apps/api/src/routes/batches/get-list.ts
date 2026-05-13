import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl, encryptProxyUrl } from '../../lib/storage.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /batches — list with cursor pagination
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/batches',
    async (request, reply) => {
      const db = getDb()

      const userId = request.user.id

      const limit = Math.min(parseInt(request.query.limit ?? '20', 10) || 20, 100)
      const cursor = request.query.cursor

      let decodedCursor: { created_at: string; id: string } | null = null
      if (cursor) {
        try {
          decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
        } catch {
          return reply.badRequest('Invalid cursor')
        }
      }

      let query = db
        .selectFrom('task_batches')
        .select([
          'id', 'module', 'provider', 'model', 'prompt', 'params', 'quantity',
          'completed_count', 'failed_count', 'status', 'estimated_credits',
          'actual_credits', 'created_at', 'user_id', 'workspace_id', 'is_deleted',
        ])
        .where('is_deleted', '=', false)
        .where('is_hidden', '=', false)
        .where('canvas_id', 'is', null)
        .where('video_studio_project_id', 'is', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1) // fetch one extra to determine if there's a next page

      // Optional workspace filter
      const workspaceId = (request.query as any).workspace_id
      if (workspaceId) {
        // If workspace_id provided, verify membership then show ALL batches in that workspace
        if (request.user.role !== 'admin') {
          const wsMember = await db
            .selectFrom('workspace_members')
            .select('role')
            .where('workspace_id', '=', workspaceId)
            .where('user_id', '=', userId)
            .executeTakeFirst()
          if (!wsMember) {
            return reply.status(403).send({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' },
            })
          }
        }
        query = query.where('workspace_id', '=', workspaceId)
      } else {
        // No workspace filter — admin sees all, normal users see only their own
        if (request.user.role !== 'admin') {
          query = query.where('user_id', '=', userId)
        }
      }

      if (decodedCursor) {
        query = query.where((eb: any) =>
          eb.or([
            eb('created_at', '<', decodedCursor!.created_at),
            eb.and([
              eb('created_at', '=', decodedCursor!.created_at),
              eb('id', '<', decodedCursor!.id),
            ]),
          ]),
        )
      }

      const rows = await query.execute()

      const hasMore = rows.length > limit
      const batches = hasMore ? rows.slice(0, limit) : rows

      // Fetch thumbnail URLs for all batches — sign in parallel to avoid sequential await bottleneck
      const batchIds = batches.map((b: any) => b.id)
      const thumbnailMap = new Map<string, string[]>()
      if (batchIds.length > 0) {
        const assets = await db
          .selectFrom('assets')
          .select(['batch_id', 'storage_url', 'original_url', 'type'])
          .where('batch_id', 'in', batchIds)
          .where('is_deleted', '=', false)
          .execute()

        const signed = await Promise.all(assets.map(async (a) => {
          const rawUrl: string | null = (a as any).storage_url ?? (a as any).original_url
          if (!rawUrl) return null
          const isVideo = (a as any).type === 'video'
          let thumbnailUrl: string
          if (rawUrl.startsWith('http://')) {
            // Encrypt URL to hide storage server IP from browser network tab
            const token = encryptProxyUrl(rawUrl)
            thumbnailUrl = `/api/v1/assets/proxy?token=${token}${isVideo ? '' : '&w=128'}`
          } else {
            const s = await signAssetUrl(rawUrl)
            if (!s) return null
            thumbnailUrl = s
          }
          return { batchId: (a as any).batch_id as string, thumbnailUrl }
        }))

        for (const entry of signed) {
          if (!entry) continue
          const list = thumbnailMap.get(entry.batchId) ?? []
          list.push(entry.thumbnailUrl)
          thumbnailMap.set(entry.batchId, list)
        }
      }

      // Fetch user info for all batch creators in one query
      const userIds = [...new Set(batches.map((b: any) => b.user_id))]
      const userMap = new Map<string, { id: string; username: string; avatar_url: string | null }>()
      if (userIds.length > 0) {
        const users = await db
          .selectFrom('users')
          .select(['id', 'username', 'avatar_url'])
          .where('id', 'in', userIds)
          .execute()
        for (const u of users) {
          userMap.set(u.id, { id: u.id, username: u.username, avatar_url: (u as any).avatar_url ?? null })
        }
      }

      // Fetch one representative error_message per failed/partial_complete batch
      const failedBatchIds = batches
        .filter((b: any) => b.status === 'failed' || b.status === 'partial_complete')
        .map((b: any) => b.id)
      const errorMap = new Map<string, string>()
      if (failedBatchIds.length > 0) {
        const errorRows = await db
          .selectFrom('tasks')
          .select(['batch_id', 'error_message'])
          .where('batch_id', 'in', failedBatchIds)
          .where('status', '=', 'failed')
          .where('error_message', 'is not', null)
          .execute()
        for (const row of errorRows) {
          if (!errorMap.has(row.batch_id)) {
            errorMap.set(row.batch_id, row.error_message!)
          }
        }
      }

      const nextCursor = hasMore && batches.length > 0
        ? Buffer.from(
            JSON.stringify({
              created_at: batches[batches.length - 1].created_at.toISOString?.() ?? String(batches[batches.length - 1].created_at),
              id: batches[batches.length - 1].id,
            }),
          ).toString('base64')
        : null

      return reply.send({
        data: batches.map((b: any) => ({
          id: b.id,
          module: b.module,
          provider: b.provider,
          model: b.model,
          prompt: b.prompt,
          params: b.params ?? {},
          quantity: b.quantity,
          completed_count: b.completed_count,
          failed_count: b.failed_count,
          status: b.status,
          estimated_credits: b.estimated_credits,
          actual_credits: b.actual_credits,
          created_at: b.created_at.toISOString?.() ?? String(b.created_at),
          tasks: [],
          thumbnail_urls: thumbnailMap.get(b.id) ?? [],
          error_message: errorMap.get(b.id) ?? null,
          user: userMap.get(b.user_id) ?? undefined,
        })),
        cursor: nextCursor,
      })
    },
  )
}

export default route
