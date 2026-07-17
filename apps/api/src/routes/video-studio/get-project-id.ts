import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'
import { assertProjectAccess } from './_shared.js'

// GET /video-studio/projects/:id — 获取项目详情（含 wizard_state 中的签名 URL）
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/video-studio/projects/:id',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params

      const project = await db
        .selectFrom('video_studio_projects')
        .selectAll()
        .where('id', '=', id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!project) return reply.status(404).send({ error: 'not found' })
      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', project.workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })

      const wizardState = project.wizard_state as Record<string, unknown> | null
      if (wizardState) {
        // 对 wizard_state 中的各类资产 URL 重新签名
        const resign = async (urlMap: unknown): Promise<Record<string, string>> => {
          if (!urlMap || typeof urlMap !== 'object') return {}
          const result: Record<string, string> = {}
          await Promise.all(Object.entries(urlMap as Record<string, string>).map(async ([k, v]) => {
            result[k] = (await signAssetUrl(v)) ?? v
          }))
          return result
        }
        const resignHistory = async (historyMap: unknown): Promise<Record<string, string[]>> => {
          if (!historyMap || typeof historyMap !== 'object') return {}
          const result: Record<string, string[]> = {}
          await Promise.all(Object.entries(historyMap as Record<string, string[]>).map(async ([k, urls]) => {
            result[k] = await Promise.all((urls ?? []).map(async (v) => (await signAssetUrl(v)) ?? v))
          }))
          return result
        }
        const resignNestedHistory = async (historyMap: unknown): Promise<Record<string, string[][]>> => {
          if (!historyMap || typeof historyMap !== 'object') return {}
          const result: Record<string, string[][]> = {}
          await Promise.all(Object.entries(historyMap as Record<string, string[][]>).map(async ([k, batches]) => {
            result[k] = await Promise.all((batches ?? []).map(async (urls) => Promise.all((urls ?? []).map(async (v) => (await signAssetUrl(v)) ?? v))))
          }))
          return result
        }
        const [characterImages, sceneImages, shotImages, shotVideos, shotVideoHistory, characterImageHistory, sceneImageHistory, sharedCharacterImages, sharedSceneImages] = await Promise.all([
          resign(wizardState.characterImages),
          resign(wizardState.sceneImages),
          resign(wizardState.shotImages),
          resign(wizardState.shotVideos),
          resignHistory(wizardState.shotVideoHistory),
          resignNestedHistory(wizardState.characterImageHistory),
          resignNestedHistory(wizardState.sceneImageHistory),
          resign(wizardState.sharedCharacterImages),
          resign(wizardState.sharedSceneImages),
        ])
        return reply.send({
          ...project,
          wizard_state: { ...wizardState, characterImages, sceneImages, shotImages, shotVideos, shotVideoHistory, characterImageHistory, sceneImageHistory, sharedCharacterImages, sharedSceneImages },
        })
      }

      return reply.send(project)
    },
  )

  // GET /video-studio/projects/:id/history — 获取项目生成历史（游标分页）
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string }
  }>('/video-studio/projects/:id/history', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '30', 10) || 30, 100)
    const cursor = request.query.cursor

    const access = await assertProjectAccess(id, request.user.id)
    if (!access) return reply.status(404).send({ error: 'not found' })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('task_batches')
      .select(['id', 'model', 'prompt', 'quantity', 'completed_count', 'failed_count', 'status', 'actual_credits', 'created_at', 'module', 'provider'])
      .where('video_studio_project_id', '=', id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limitN + 1) as any

    if (decodedCursor) {
      query = query.where((eb: any) => eb.or([
        eb('created_at', '<', decodedCursor!.created_at),
        eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
      ]))
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = await Promise.all((hasMore ? rows.slice(0, limitN) : rows).map(async (batch: any) => {
      const queuePosition = batch.status === 'pending'
        ? Number((await db
            .selectFrom('task_batches')
            .select((eb: any) => eb.fn.countAll().as('count'))
            .where('is_deleted', '=', false)
            .where('status', '=', 'pending')
            .where('provider', '=', batch.provider)
            .where('created_at', '<', batch.created_at)
            .executeTakeFirst() as any)?.count ?? 0)
        : null
      const processing = await db
        .selectFrom('tasks')
        .select('processing_started_at')
        .where('batch_id', '=', batch.id)
        .where('processing_started_at', 'is not', null)
        .orderBy('processing_started_at', 'asc')
        .executeTakeFirst()
      const { provider: _provider, ...item } = batch
      return { ...item, canvas_node_id: null, queue_position: queuePosition, processing_started_at: processing?.processing_started_at ?? null }
    }))

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items, nextCursor })
  })

  // GET /video-studio/projects/:id/assets — 获取项目资产列表（游标分页）
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string; type?: string }
  }>('/video-studio/projects/:id/assets', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
    const cursor = request.query.cursor
    const type = request.query.type

    const access = await assertProjectAccess(id, request.user.id)
    if (!access) return reply.status(404).send({ error: 'not found' })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('assets as a')
      .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
      .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.created_at', 'b.id as batch_id', 'b.prompt', 'b.model'])
      .where('b.video_studio_project_id', '=', id)
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
      query = query.where((eb: any) => eb.or([
        eb('a.created_at', '<', decodedCursor!.created_at),
        eb.and([eb('a.created_at', '=', decodedCursor!.created_at), eb('a.id', '<', decodedCursor!.id)]),
      ]))
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = hasMore ? rows.slice(0, limitN) : rows
    const signedItems = await Promise.all(items.map(async (item: any) => ({
      ...item,
      canvas_node_id: null,
      storage_url: await signAssetUrl(item.storage_url),
      original_url: item.original_url ? await signAssetUrl(item.original_url) : null,
    })))

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items: signedItems, nextCursor })
  })
}

export default route
