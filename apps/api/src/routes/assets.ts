import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl, extractStorageKey, signThumbnailUrl, verifyThumbnailSig, getS3ObjectBuffer } from '../lib/storage.js'

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // In-memory thumbnail cache: key = "storageKey:width", value = WebP Buffer
  const thumbnailCache = new Map<string, { data: Buffer; createdAt: number }>()
  const THUMBNAIL_CACHE_MAX = 500

  // GET /assets/thumbnail — serve resized WebP (no auth required, HMAC-signed URL)
  app.get<{ Querystring: { key: string; w?: string; exp: string; sig: string } }>(
    '/assets/thumbnail',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['key', 'exp', 'sig'],
          properties: {
            key: { type: 'string' },
            w: { type: 'string' },
            exp: { type: 'string' },
            sig: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { key, w, exp, sig } = request.query
      const width = Math.min(parseInt(w ?? '400', 10) || 400, 1200)
      const expNum = parseInt(exp, 10)

      if (!verifyThumbnailSig(key, width, expNum, sig)) {
        return reply.code(403).send({ error: 'Invalid or expired thumbnail URL' })
      }

      const cacheKey = `${key}:${width}`
      const cached = thumbnailCache.get(cacheKey)
      if (cached) {
        reply.header('Content-Type', 'image/webp')
        reply.header('Cache-Control', 'public, max-age=86400, immutable')
        reply.header('X-Cache', 'HIT')
        return reply.send(cached.data)
      }

      let rawBuffer: Buffer
      try {
        rawBuffer = await getS3ObjectBuffer(key)
      } catch (err) {
        app.log.warn({ err, key }, 'Failed to fetch asset from S3 for thumbnail')
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      let resultBuffer: Buffer
      let contentType: string
      try {
        const sharp = (await import('sharp')).default
        resultBuffer = await sharp(rawBuffer)
          .resize(width, null, { withoutEnlargement: true, fit: 'inside' })
          .webp({ quality: 82 })
          .toBuffer()
        contentType = 'image/webp'
      } catch {
        // Fallback: serve original bytes
        resultBuffer = rawBuffer
        contentType = 'image/jpeg'
      }

      if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
        const oldest = [...thumbnailCache.entries()]
          .sort((a, b) => a[1].createdAt - b[1].createdAt)
          .slice(0, 100)
          .map(([k]) => k)
        for (const k of oldest) thumbnailCache.delete(k)
      }
      thumbnailCache.set(cacheKey, { data: resultBuffer, createdAt: Date.now() })

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=86400, immutable')
      reply.header('X-Cache', 'MISS')
      return reply.send(resultBuffer)
    },
  )
  app.get<{ Querystring: { workspace_id?: string; type?: string; date?: string; cursor?: string; limit?: string } }>(
    '/assets',
    async (request, reply) => {
      const db = getDb()
      const { workspace_id, type, date, cursor, limit: limitStr } = request.query
      const userId = request.user.id

      if (!workspace_id) {
        return reply.badRequest('workspace_id is required')
      }

      // Verify workspace membership
      if (request.user.role !== 'admin') {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', workspace_id)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!wsMember) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' },
          })
        }
      }

      const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200)

      let decodedCursor: { created_at: string; id: string } | null = null
      if (cursor) {
        try {
          decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
        } catch {
          return reply.badRequest('Invalid cursor')
        }
      }

      let query = db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select([
          'a.id',
          'a.type',
          'a.storage_url',
          'a.original_url',
          'a.created_at',
          'b.id as batch_id',
          'b.prompt',
          'b.model',
        ])
        .where('b.workspace_id', '=', workspace_id)
        .where('a.is_deleted', '=', false)
        .where('a.transfer_status', '=', 'completed')
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(limit + 1)

      if (type) {
        query = query.where('a.type', '=', type)
      }

      // Filter by local date (YYYY-MM-DD) using UTC date of created_at
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        query = query
          .where('a.created_at', '>=', new Date(`${date}T00:00:00.000Z`) as any)
          .where('a.created_at', '<',  new Date(`${date}T24:00:00.000Z`) as any)
      }

      if (decodedCursor) {
        query = query.where((eb: any) =>
          eb.or([
            eb('a.created_at', '<', decodedCursor!.created_at),
            eb.and([
              eb('a.created_at', '=', decodedCursor!.created_at),
              eb('a.id', '<', decodedCursor!.id),
            ]),
          ]),
        )
      }

      const rows = await query.execute()

      const hasMore = rows.length > limit
      const assets = hasMore ? rows.slice(0, limit) : rows

      // Sign URLs and build thumbnail URLs
      const signed = await Promise.all(
        assets.map(async (a: any) => {
          const rawUrl: string | null = a.storage_url
          const storageKey = rawUrl ? extractStorageKey(rawUrl) : null
          let thumbnail_url: string | null = null
          if (storageKey) {
            // Our MinIO/S3 — HMAC-signed thumbnail endpoint
            thumbnail_url = signThumbnailUrl(storageKey, 400) || null
          } else if (rawUrl?.startsWith('http://')) {
            // External HTTP storage — proxy with resize
            thumbnail_url = `/api/v1/assets/proxy?url=${encodeURIComponent(rawUrl)}&w=400`
          }
          return {
            id: a.id,
            type: a.type,
            storage_url: rawUrl ? await signAssetUrl(rawUrl) : null,
            thumbnail_url,
            original_url: a.original_url ?? null,
            created_at: a.created_at.toISOString?.() ?? String(a.created_at),
            batch: { id: a.batch_id, prompt: a.prompt, model: a.model },
          }
        }),
      )

      const nextCursor = hasMore && assets.length > 0
        ? Buffer.from(
            JSON.stringify({
              created_at: assets[assets.length - 1].created_at.toISOString?.() ?? String(assets[assets.length - 1].created_at),
              id: assets[assets.length - 1].id,
            }),
          ).toString('base64')
        : null

      return reply.send({ data: signed, cursor: nextCursor })
    },
  )

  // DELETE /assets/:id — soft-delete an asset
  app.delete<{ Params: { id: string } }>(
    '/assets/:id',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.user_id', 'b.workspace_id'])
        .where('a.id', '=', id)
        .where('a.is_deleted', '=', false)
        .executeTakeFirst()

      if (!asset) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '资产未找到' },
        })
      }

      // Authorization: must own the asset, be a workspace member, or be admin
      if (asset.user_id !== userId && request.user.role !== 'admin') {
        if (asset.workspace_id) {
          const wsMember = await db
            .selectFrom('workspace_members')
            .select('role')
            .where('workspace_id', '=', asset.workspace_id)
            .where('user_id', '=', userId)
            .executeTakeFirst()
          if (!wsMember) {
            return reply.status(403).send({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Not authorized' },
            })
          }
        } else {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized' },
          })
        }
      }

      await db
        .updateTable('assets')
        .set({ is_deleted: true, deleted_at: new Date() })
        .where('id', '=', id)
        .execute()

      return reply.status(204).send()
    },
  )

  // GET /assets/trash — list soft-deleted assets for a workspace (within 7 days)
  app.get<{ Querystring: { workspace_id?: string } }>(
    '/assets/trash',
    async (request, reply) => {
      const db = getDb()
      const { workspace_id } = request.query
      const userId = request.user.id

      if (!workspace_id) return reply.badRequest('workspace_id is required')

      if (request.user.role !== 'admin') {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', workspace_id)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!wsMember) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' } })
      }

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const assets = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.deleted_at', 'b.prompt'])
        .where('b.workspace_id', '=', workspace_id)
        .where('a.is_deleted', '=', true)
        .where('a.deleted_at', '>=', cutoff as any)
        .orderBy('a.deleted_at', 'desc')
        .execute()

      const signed = await Promise.all(
        assets.map(async (a: any) => ({
          id: a.id,
          type: a.type,
          storage_url: a.storage_url ? await signAssetUrl(a.storage_url) : null,
          original_url: a.original_url ?? null,
          deleted_at: a.deleted_at,
          prompt: a.prompt,
        }))
      )

      return { data: signed }
    }
  )

  // POST /assets/trash/:id/restore — restore a soft-deleted asset
  app.post<{ Params: { id: string } }>(
    '/assets/trash/:id/restore',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets as a')
        .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
        .select(['a.id', 'a.user_id', 'b.workspace_id'])
        .where('a.id', '=', id)
        .where('a.is_deleted', '=', true)
        .executeTakeFirst()

      if (!asset) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '资产不存在' } })

      if (asset.user_id !== userId && request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      }

      await db
        .updateTable('assets')
        .set({ is_deleted: false, deleted_at: null })
        .where('id', '=', id)
        .execute()

      return { success: true }
    }
  )

  // DELETE /assets/trash/:id — permanently delete an asset
  app.delete<{ Params: { id: string } }>(
    '/assets/trash/:id',
    async (request, reply) => {
      const db = getDb()
      const { id } = request.params
      const userId = request.user.id

      const asset = await db
        .selectFrom('assets')
        .select(['id', 'user_id'])
        .where('id', '=', id)
        .where('is_deleted', '=', true)
        .executeTakeFirst()

      if (!asset) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '资产不存在' } })

      if (asset.user_id !== userId && request.user.role !== 'admin') {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } })
      }

      await db.deleteFrom('assets').where('id', '=', id).execute()

      return reply.status(204).send()
    }
  )
}
