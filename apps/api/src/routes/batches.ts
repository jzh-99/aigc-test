import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl, signAssetUrls, encryptProxyUrl } from '../lib/storage.js'

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  // GET /batches/:id — batch detail with tasks + assets
  app.get<{ Params: { id: string } }>('/batches/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (!batch) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '生成记录未找到' },
      })
    }

    // Authorization: user must own the batch, be a workspace member, or be admin
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

    const tasks = await db
      .selectFrom('tasks')
      .selectAll()
      .where('batch_id', '=', id)
      .orderBy('version_index', 'asc')
      .execute()

    const assets = await db
      .selectFrom('assets')
      .selectAll()
      .where('batch_id', '=', id)
      .where('is_deleted', '=', false)
      .execute()

    const assetByTask: Map<string, any> = new Map(assets.map((a: any) => [a.task_id, a]))

    // Sign asset URLs
    for (const asset of assets) {
      if ((asset as any).storage_url) {
        (asset as any).storage_url = await signAssetUrl((asset as any).storage_url)
      }
    }

    // Fetch batch creator info
    const creator = await db
      .selectFrom('users')
      .select(['id', 'username', 'avatar_url'])
      .where('id', '=', batch.user_id)
      .executeTakeFirst()

    return reply.send({
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
      user: creator ? { id: creator.id, username: creator.username, avatar_url: creator.avatar_url ?? null } : undefined,
      tasks: tasks.map((t: any) => {
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
                original_url: await signAssetUrl(asset.original_url),
                storage_url: asset.storage_url,
                transfer_status: asset.transfer_status,
                file_size: asset.file_size,
                width: asset.width,
                height: asset.height,
              }
            : null,
        }
      }),
    })
  })

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
          user: userMap.get(b.user_id) ?? undefined,
        })),
        cursor: nextCursor,
      })
    },
  )
}
