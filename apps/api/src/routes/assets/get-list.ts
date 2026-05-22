import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'

interface AssetThumbnailSource {
  thumbnail_url: string | null
}

type SignUrl = (url: string) => Promise<string | null>

/**
 * 资产列表只透传数据库记录的缩略图。
 * 图片资产的 thumbnail_url 允许为 null，避免接口临时生成缩略图破坏字段语义。
 */
export async function resolveAssetThumbnailUrl(
  asset: AssetThumbnailSource,
  signUrl: SignUrl = signAssetUrl,
): Promise<string | null> {
  return asset.thumbnail_url ? await signUrl(asset.thumbnail_url) : null
}

const route: FastifyPluginAsync = async (app) => {
  // GET /assets — 分页查询工作区资产列表（游标分页）
  app.get<{ Querystring: { workspace_id?: string; type?: string; date?: string; cursor?: string; limit?: string } }>(
    '/assets',
    async (request, reply) => {
      const db = getDb()
      const { workspace_id, type, date, cursor, limit: limitStr } = request.query
      const userId = request.user.id

      if (!workspace_id) {
        return reply.badRequest('workspace_id is required')
      }

      // 验证工作区成员身份
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
          'a.thumbnail_url',
          'a.original_url',
          'a.created_at',
          'b.id as batch_id',
          'b.prompt',
          'b.model',
        ])
        .where('b.workspace_id', '=', workspace_id)
        .where('b.canvas_id', 'is', null)
        .where('b.video_studio_project_id', 'is', null)
        .where('a.is_deleted', '=', false)
        .where((eb: any) => eb.or([
          eb('a.transfer_status', '=', 'completed'),
          eb('a.original_url', 'is not', null),
        ]))
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(limit + 1)

      if (type) {
        query = query.where('a.type', '=', type as 'image' | 'video' | 'audio')
      }

      // 按本地日期过滤（YYYY-MM-DD），使用 UTC 时间
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

      // 签名 URL 并生成缩略图地址
      const signed = await Promise.all(
        assets.map(async (a: any) => {
          const rawUrl: string | null = a.storage_url
          return {
            id: a.id,
            type: a.type,
            storage_url: rawUrl ? await signAssetUrl(rawUrl) : null,
            thumbnail_url: await resolveAssetThumbnailUrl(a),
            original_url: a.original_url ? await signAssetUrl(a.original_url) : null,
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
}

export default route
