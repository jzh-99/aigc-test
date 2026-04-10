import type { FastifyInstance } from 'fastify'
import { createWriteStream, createReadStream } from 'node:fs'
import { unlink, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { signAssetUrl, signAssetUrls, uploadToS3 } from '../lib/storage.js'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const CANVAS_UPLOAD_DIR = '/tmp/canvas-uploads'
const CANVAS_UPLOAD_MAX_AGE_MS = 10 * 60 * 1000 // 10 min — enough for external storage to fetch
const SAFE_CANVAS_ID = /^[\w-]+\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)$/

function hasS3UploadConfig(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY
    && process.env.STORAGE_SECRET_KEY
    && process.env.STORAGE_PUBLIC_URL
  )
}

function rewriteExternalStorageUrl(url: string): string {
  const base = process.env.EXTERNAL_STORAGE_BASE
  if (!base) return url
  try {
    const parsed = new URL(url)
    const internal = new URL(base)
    parsed.protocol = internal.protocol
    parsed.host = internal.host
    return parsed.toString()
  } catch {
    return url
  }
}

async function uploadViaLocalTemp(fileId: string, mimeType: string): Promise<string> {
  const externalStorageUrl = process.env.EXTERNAL_STORAGE_URL
  if (!externalStorageUrl) throw new Error('上传存储服务未配置')

  const baseUrl = process.env.AI_UPLOAD_BASE_URL ?? process.env.INTERNAL_API_URL ?? ''
  const publicUrl = `${baseUrl}/api/v1/canvases/uploads/${fileId}`
  const fileType = mimeType.startsWith('video/') ? 'mp4' : 'jpg'

  const res = await fetch(externalStorageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: randomUUID(), url: publicUrl, type: fileType }),
  })

  if (!res.ok) throw new Error(`外部存储服务异常(${res.status})`)

  const payload = await res.json() as any
  if (payload?.code !== 10000 || !payload?.data?.url) {
    throw new Error(payload?.msg ?? '外部存储返回异常')
  }

  return rewriteExternalStorageUrl(payload.data.url)
}

export async function canvasRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(CANVAS_UPLOAD_DIR, { recursive: true })

  // GET /canvases/uploads/:id — serve temp files publicly (no auth) for external storage to fetch
  app.get<{ Params: { id: string } }>('/canvases/uploads/:id', async (request, reply) => {
    const { id } = request.params
    if (!SAFE_CANVAS_ID.test(id)) return reply.status(404).send()
    const filePath = join(CANVAS_UPLOAD_DIR, id)
    try {
      const s = await stat(filePath)
      if (Date.now() - s.mtimeMs > CANVAS_UPLOAD_MAX_AGE_MS) {
        await unlink(filePath).catch(() => {})
        return reply.status(404).send()
      }
      const ext = id.split('.').pop()!
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
        gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      }
      reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream')
      reply.header('Content-Length', s.size)
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Robots-Tag', 'noindex')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send()
    }
  })

  // GET /canvases — list user's canvases, optionally filtered by workspace_id
  app.get<{ Querystring: { workspace_id?: string } }>('/canvases', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const filterWsId = (request.query as any).workspace_id as string | undefined

    // Get all workspace IDs the user belongs to
    const memberships = await db
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('user_id', '=', userId)
      .execute()

    const wsIds = memberships.map((m: any) => m.workspace_id)
    if (wsIds.length === 0) return reply.send([])

    // If workspace_id filter provided, verify membership then narrow
    const targetWsIds = filterWsId
      ? wsIds.filter((id) => id === filterWsId)
      : wsIds
    if (targetWsIds.length === 0) return reply.send([])

    const canvases = await db
      .selectFrom('canvases')
      .select(['id', 'name', 'thumbnail_url', 'created_at', 'updated_at'])
      .where('workspace_id', 'in', targetWsIds)
      .orderBy('updated_at', 'desc')
      .execute()

    return reply.send(canvases)
  })

  // POST /canvases — create new canvas
  app.post<{ Body: { name?: string; workspace_id?: string } }>('/canvases', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const { name = '未命名画布', workspace_id } = request.body ?? {}

    // Resolve workspace: use provided or pick first membership
    let wsId = workspace_id
    if (!wsId) {
      const membership = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('user_id', '=', userId)
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst()
      if (!membership) {
        return reply.status(400).send({ success: false, error: { code: 'NO_WORKSPACE', message: '用户没有可用的工作空间' } })
      }
      wsId = membership.workspace_id
    }

    // Verify membership
    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', wsId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!member) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该工作空间' } })
    }

    const canvas = await db
      .insertInto('canvases')
      .values({
        workspace_id: wsId,
        user_id: userId,
        name,
        structure_data: JSON.stringify({ nodes: [], edges: [] }),
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return reply.status(201).send(canvas)
  })

  // GET /canvases/:id — load canvas with structure_data
  app.get<{ Params: { id: string } }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const canvas = await db
      .selectFrom('canvases')
      .selectAll()
      .where('id', '=', request.params.id)
      .executeTakeFirst()

    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    // Auth: must be workspace member
    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    return reply.send(canvas)
  })

  // PATCH /canvases/:id — save structure_data (with optimistic lock)
  app.patch<{
    Params: { id: string }
    Body: { name?: string; structure_data?: any; version: number; thumbnail_url?: string }
  }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const { name, structure_data, version, thumbnail_url } = request.body

    const canvas = await db
      .selectFrom('canvases')
      .select(['workspace_id', 'version'])
      .where('id', '=', id)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权修改该画布' } })

    // Optimistic lock
    let query = db.updateTable('canvases')
      .set({
        version: sql`version + 1`,
        updated_at: sql`now()`,
        ...(name !== undefined ? { name } : {}),
        ...(structure_data !== undefined ? { structure_data: JSON.stringify(structure_data) } : {}),
        ...(thumbnail_url !== undefined ? { thumbnail_url } : {}),
      })
      .where('id', '=', id)
      .where('version', '=', version)
      .returning(['id', 'version'])

    const updated = await query.executeTakeFirst()
    if (!updated) {
      return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: '画布已被其他设备修改，请刷新后重试' } })
    }

    return reply.send({ id: updated.id, version: updated.version })
  })

  // DELETE /canvases/:id
  app.delete<{ Params: { id: string } }>('/canvases/:id', async (request, reply) => {
    const db = getDb()
    const canvas = await db
      .selectFrom('canvases')
      .select(['workspace_id', 'user_id'])
      .where('id', '=', request.params.id)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    // Only creator or workspace admin can delete
    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member || (canvas.user_id !== request.user.id && member.role !== 'admin')) {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权删除该画布' } })
    }

    await db.deleteFrom('canvases').where('id', '=', request.params.id).execute()
    return reply.status(204).send()
  })

  // GET /canvases/:id/active-tasks — polling endpoint for execution progress
  app.get<{ Params: { id: string } }>('/canvases/:id/active-tasks', {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    // Get dirty version from Redis
    const redis = (app as any).redis
    const dirtyVersion = parseInt(await redis.get(`canvas:dirty:${id}`) ?? '0', 10)

    // Fetch active batches for this canvas
    const batches = await db
      .selectFrom('task_batches')
      .select(['id', 'canvas_node_id', 'status', 'quantity', 'completed_count', 'failed_count'])
      .where('canvas_id', '=', id)
      .where('status', 'in', ['pending', 'processing'])
      .execute()

    return reply.send({ version: dirtyVersion, batches })
  })

  // GET /canvases/:id/node-outputs/:nodeId — load history outputs for a node
  app.get<{ Params: { id: string; nodeId: string } }>('/canvases/:id/node-outputs/:nodeId', {
    config: {
      rateLimit: {
        max: 1200,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id, nodeId } = request.params

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    const outputs = await db
      .selectFrom('canvas_node_outputs')
      .selectAll()
      .where('canvas_id', '=', id)
      .where('node_id', '=', nodeId)
      .orderBy('created_at', 'desc')
      .execute()

    // Sign each output_urls array
    const signed = await Promise.all(
      outputs.map(async (row) => ({
        ...row,
        output_urls: await signAssetUrls(row.output_urls ?? []),
      }))
    )

    return reply.send(signed)
  })

  // POST /canvases/:id/node-outputs/:nodeId/select — set selected output for a node
  app.post<{
    Params: { id: string; nodeId: string }
    Body: { output_id?: string }
  }>('/canvases/:id/node-outputs/:nodeId/select', {
    config: {
      rateLimit: {
        max: 300,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id, nodeId } = request.params
    const { output_id } = request.body ?? {}

    if (!output_id) {
      return reply.badRequest('output_id is required')
    }

    const canvas = await db
      .selectFrom('canvases')
      .select('workspace_id')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权修改该画布' } })

    const target = await db
      .selectFrom('canvas_node_outputs')
      .select('id')
      .where('id', '=', output_id)
      .where('canvas_id', '=', id)
      .where('node_id', '=', nodeId)
      .executeTakeFirst()

    if (!target) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '目标输出不存在' } })
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('canvas_node_outputs')
        .set({ is_selected: false })
        .where('canvas_id', '=', id)
        .where('node_id', '=', nodeId)
        .execute()

      await trx
        .updateTable('canvas_node_outputs')
        .set({ is_selected: true })
        .where('id', '=', output_id)
        .where('canvas_id', '=', id)
        .where('node_id', '=', nodeId)
        .execute()
    })

    return reply.send({ success: true, selected_output_id: output_id })
  })

  // GET /canvases/:id/history — batch list for this canvas (with tasks+asset info)
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string }
  }>('/canvases/:id/history', {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '30', 10) || 30, 100)
    const cursor = request.query.cursor

    const canvas = await db
      .selectFrom('canvases').select('workspace_id').where('id', '=', id).executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members').select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id).executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('task_batches')
      .select(['id', 'canvas_node_id', 'model', 'prompt', 'quantity', 'completed_count',
               'failed_count', 'status', 'actual_credits', 'created_at'])
      .where('canvas_id', '=', id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limitN + 1) as any

    if (decodedCursor) {
      query = query.where((eb: any) =>
        eb.or([
          eb('created_at', '<', decodedCursor!.created_at),
          eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
        ])
      )
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = hasMore ? rows.slice(0, limitN) : rows
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items, nextCursor })
  })

  // GET /canvases/:id/assets — asset library for this canvas
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string; type?: string }
  }>('/canvases/:id/assets', {
    config: {
      rateLimit: {
        max: 600,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
    const cursor = request.query.cursor
    const type = request.query.type

    const canvas = await db
      .selectFrom('canvases').select('workspace_id').where('id', '=', id).executeTakeFirst()
    if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

    const member = await db
      .selectFrom('workspace_members').select('role')
      .where('workspace_id', '=', canvas.workspace_id)
      .where('user_id', '=', request.user.id).executeTakeFirst()
    if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('assets as a')
      .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
      .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.created_at',
               'b.id as batch_id', 'b.canvas_node_id', 'b.prompt', 'b.model'])
      .where('b.canvas_id', '=', id)
      .where('a.is_deleted', '=', false)
      .where((eb: any) => eb.or([
        eb('a.transfer_status', '=', 'completed'),
        eb('a.original_url', 'is not', null),
      ]))
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limitN + 1) as any

    if (type) query = query.where('a.type', '=', type)

    if (decodedCursor) {
      query = query.where((eb: any) =>
        eb.or([
          eb('a.created_at', '<', decodedCursor!.created_at),
          eb.and([eb('a.created_at', '=', decodedCursor!.created_at), eb('a.id', '<', decodedCursor!.id)]),
        ])
      )
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = hasMore ? rows.slice(0, limitN) : rows

    // Sign storage URLs
    const signedItems = await Promise.all(
      items.map(async (item: any) => ({
        ...item,
        storage_url: await signAssetUrl(item.storage_url),
        original_url: item.original_url ? await signAssetUrl(item.original_url) : null,
      }))
    )

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items: signedItems, nextCursor })
  })

  // POST /canvases/asset-upload — upload an image/video file for use as an asset node
  app.post('/canvases/asset-upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: 50 * 1024 * 1024 } })
    if (!data) return reply.badRequest('No file provided')

    const mimeType: string = data.mimetype ?? ''
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      return reply.badRequest('Only image and video files are supported')
    }

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? 'bin'
    const fileId = `${randomUUID()}.${ext}`
    const filePath = join(CANVAS_UPLOAD_DIR, fileId)

    // Stream to disk first
    await pipeline(data.file, createWriteStream(filePath))

    try {
      let storageUrl: string

      if (hasS3UploadConfig()) {
        const key = `canvas-assets/${fileId}`
        try {
          const buf = await import('node:fs/promises').then((m) => m.readFile(filePath))
          storageUrl = await uploadToS3(key, buf, mimeType)
        } catch (err: any) {
          app.log.warn({ err: err?.message ?? String(err) }, 'S3 upload failed, fallback to external storage')
          storageUrl = await uploadViaLocalTemp(fileId, mimeType)
        }
      } else {
        storageUrl = await uploadViaLocalTemp(fileId, mimeType)
      }

      const signedUrl = await signAssetUrl(storageUrl)
      return reply.send({ url: signedUrl ?? storageUrl, storageUrl })
    } catch (err: any) {
      app.log.error({ err: err?.message ?? String(err) }, 'Canvas asset upload failed')
      return reply.status(502).send({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: err?.message ?? '上传服务暂时不可用，请稍后重试',
        },
      })
    } finally {
      // Clean up temp file regardless of outcome
      unlink(filePath).catch(() => {})
    }
  })
}
