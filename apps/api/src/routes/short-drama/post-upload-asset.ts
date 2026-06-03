import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { ShortDramaAsset } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'

interface UploadAssetBody {
  assetId?: string
  storageKey?: string
  imageUrl?: string
  scope: 'global' | 'episode'
  episodeNumber?: number
  name?: string
  kind?: 'character' | 'scene' | 'prop' | 'bgm'
  description?: string
}

const ALLOWED_INTERNAL_HOSTS = [
  process.env.S3_PUBLIC_HOST,
  process.env.NEXT_PUBLIC_STORAGE_HOST,
  'localhost',
  '127.0.0.1',
].filter(Boolean)

function isInternalUrl(url: string): boolean {
  if (url.startsWith('/')) return true
  try {
    const parsed = new URL(url)
    return ALLOWED_INTERNAL_HOSTS.some(h => parsed.hostname === h || parsed.host === h)
  } catch {
    return false
  }
}

export default async function postUploadAsset(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: UploadAssetBody }>(
    '/short-drama/projects/:id/assets/upload',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['scope'],
          properties: {
            assetId: { type: 'string' },
            storageKey: { type: 'string', maxLength: 1000 },
            imageUrl: { type: 'string', maxLength: 2000 },
            scope: { type: 'string', enum: ['global', 'episode'] },
            episodeNumber: { type: 'integer', minimum: 1 },
            name: { type: 'string', maxLength: 200 },
            kind: { type: 'string', enum: ['character', 'scene', 'prop', 'bgm'] },
            description: { type: 'string', maxLength: 2000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params
      const { assetId, storageKey, imageUrl, scope, episodeNumber, name, kind, description } = request.body
      const userId = request.user.id

      const { project } = await assertShortDramaProjectAccess(projectId, userId, true)
      const state = project.state
      const db = getDb()

      // 确定最终图片 URL
      let finalImageUrl: string | null = null

      if (storageKey) {
        finalImageUrl = storageKey.startsWith('/') ? storageKey : `/${storageKey}`
      } else if (imageUrl) {
        if (!isInternalUrl(imageUrl)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_URL', message: '不允许使用外部图片地址，请通过平台上传' },
          })
        }
        finalImageUrl = imageUrl
      } else if (!assetId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: '必须提供 assetId、storageKey 或 imageUrl' },
        })
      }

      // 如果是更新现有 asset
      if (assetId) {
        const existing = state.assets.items.find(a => a.id === assetId)
        if (!existing) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: '素材不存在' },
          })
        }
        if (finalImageUrl) {
          existing.imageUrl = finalImageUrl
        }
        existing.status = 'completed'
        existing.updatedAt = new Date().toISOString()
      } else {
        // 创建新 asset
        const newAsset: ShortDramaAsset = {
          id: randomUUID(),
          kind: kind ?? 'character',
          scope,
          name: name ?? '未命名素材',
          aliases: [],
          description: description ?? '',
          imageUrl: finalImageUrl,
          referenceImageUrl: null,
          episodeNumber: scope === 'episode' ? (episodeNumber ?? null) : null,
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        state.assets.items.push(newAsset)
      }

      // 保存 state
      await db
        .updateTable('short_drama_projects')
        .set({
          state: JSON.stringify(state),
          updated_at: new Date(),
        })
        .where('id', '=', project.id)
        .execute()

      return reply.send({
        success: true,
        assets: state.assets.items,
      })
    }
  )
}
