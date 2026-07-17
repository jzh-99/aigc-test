import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl, encryptProxyUrl } from '../../lib/storage.js'
import { normalizeBatchSource } from './source-filter.js'

// 构建批次列表查询（供 get-hidden.ts 复用）
export function buildBatchListQuery(db: ReturnType<typeof getDb>, isHidden: boolean) {
  return db
    .selectFrom('task_batches')
    .select([
      'id', 'module', 'provider', 'model', 'prompt', 'params', 'quantity',
      'completed_count', 'failed_count', 'status', 'estimated_credits',
      'actual_credits', 'created_at', 'user_id', 'workspace_id', 'source',
    ])
    .where('is_deleted', '=', false)
    .where('is_hidden', '=', isHidden)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
}

const route: FastifyPluginAsync = async (app) => {
  // GET /batches/hidden — list hidden batches (same pagination as GET /batches)
  app.get<{ Querystring: { workspace_id?: string; source?: string; cursor?: string; limit?: string } }>(
    '/batches/hidden',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id

      // 解析并验证 source 参数
      let source: 'generation' | 'studio' | 'canvas'
      try {
        source = normalizeBatchSource(request.query.source)
      } catch {
        return reply.badRequest('Invalid batch source')
      }

      const limit = Math.min(parseInt(request.query.limit ?? '10', 10) || 10, 50)
      const cursor = request.query.cursor

      let decodedCursor: { created_at: string; id: string } | null = null
      if (cursor) {
        try {
          decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
        } catch {
          return reply.badRequest('Invalid cursor')
        }
      }

      let query = buildBatchListQuery(db, true).where('source', '=', source).limit(limit + 1)

      const workspaceId = request.query.workspace_id
      if (workspaceId) {
        if (request.user.role !== 'admin') {
          const wsMember = await db.selectFrom('workspace_members').select('role')
            .where('workspace_id', '=', workspaceId).where('user_id', '=', userId).executeTakeFirst()
          if (!wsMember) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' } })
        }
        query = query.where('workspace_id', '=', workspaceId)
      } else {
        if (request.user.role !== 'admin') query = query.where('user_id', '=', userId)
      }

      if (decodedCursor) {
        query = query.where((eb: any) =>
          eb.or([
            eb('created_at', '<', decodedCursor!.created_at),
            eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
          ]),
        )
      }

      const rows = await query.execute()
      const hasMore = rows.length > limit
      const batches = hasMore ? rows.slice(0, limit) : rows

      const batchIds = batches.map((b: any) => b.id)
      const thumbnailMap = new Map<string, string[]>()
      const resourceMap = new Map<string, Array<{ url: string; type: 'image' | 'video' | 'audio' }>>()
      if (batchIds.length > 0) {
        const assets = await db.selectFrom('assets').select(['batch_id', 'storage_url', 'original_url', 'type'])
          .where('batch_id', 'in', batchIds).where('is_deleted', '=', false).execute()
        const signed = await Promise.all(assets.map(async (a) => {
          const rawUrl: string | null = (a as any).storage_url ?? (a as any).original_url
          if (!rawUrl) return null
          const assetType = (a as any).type as 'image' | 'video' | 'audio'
          const isVideo = assetType === 'video'
          let processedUrl: string
          if (rawUrl.startsWith('http://')) {
            // 加密内网 URL，避免暴露存储服务器 IP
            const token = encryptProxyUrl(rawUrl)
            processedUrl = `/api/v1/assets/proxy?token=${token}${isVideo ? '' : '&w=128'}`
          } else {
            const s = await signAssetUrl(rawUrl)
            if (!s) return null
            processedUrl = s
          }
          return { batchId: (a as any).batch_id as string, url: processedUrl, type: assetType }
        }))
        for (const entry of signed) {
          if (!entry) continue
          const thumbList = thumbnailMap.get(entry.batchId) ?? []
          thumbList.push(entry.url)
          thumbnailMap.set(entry.batchId, thumbList)

          const resList = resourceMap.get(entry.batchId) ?? []
          resList.push({ url: entry.url, type: entry.type })
          resourceMap.set(entry.batchId, resList)
        }
      }

      const nextCursor = hasMore && batches.length > 0
        ? Buffer.from(JSON.stringify({
            created_at: batches[batches.length - 1].created_at.toISOString?.() ?? String(batches[batches.length - 1].created_at),
            id: batches[batches.length - 1].id,
          })).toString('base64')
        : null

      return reply.send({
        data: batches.map((b: any) => ({
          id: b.id, module: b.module, provider: b.provider, model: b.model,
          prompt: b.prompt, params: b.params ?? {}, quantity: b.quantity,
          completed_count: b.completed_count, failed_count: b.failed_count,
          status: b.status, estimated_credits: b.estimated_credits, actual_credits: b.actual_credits,
          created_at: b.created_at.toISOString?.() ?? String(b.created_at),
          source: b.source,
          tasks: [],
          thumbnail_urls: thumbnailMap.get(b.id) ?? [],
          resources: resourceMap.get(b.id) ?? [],
        })),
        cursor: nextCursor,
      })
    },
  )
}

export default route
