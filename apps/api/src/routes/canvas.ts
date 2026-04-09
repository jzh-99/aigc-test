import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { signAssetUrl, signAssetUrls } from '../lib/storage.js'

export async function canvasRoutes(app: FastifyInstance): Promise<void> {
  // GET /canvases — list user's canvases (via workspace membership)
  app.get('/canvases', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id

    // Get all workspace IDs the user belongs to
    const memberships = await db
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('user_id', '=', userId)
      .execute()

    const wsIds = memberships.map((m: any) => m.workspace_id)
    if (wsIds.length === 0) return reply.send([])

    const canvases = await db
      .selectFrom('canvases')
      .select(['id', 'name', 'thumbnail_url', 'created_at', 'updated_at'])
      .where('workspace_id', 'in', wsIds)
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
  app.get<{ Params: { id: string } }>('/canvases/:id/active-tasks', async (request, reply) => {
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
  app.get<{ Params: { id: string; nodeId: string } }>('/canvases/:id/node-outputs/:nodeId', async (request, reply) => {
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

  // GET /canvases/:id/history — batch list for this canvas (with tasks+asset info)
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string }
  }>('/canvases/:id/history', async (request, reply) => {
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
  }>('/canvases/:id/assets', async (request, reply) => {
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
}
