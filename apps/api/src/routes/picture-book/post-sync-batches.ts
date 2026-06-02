import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, calculateProjectChargeTotal, jsonbArray, PICTURE_BOOK_MODELS } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { project_id: string } }>(
    '/picture-book/sync-batches',
    {
      schema: {
        body: {
          type: 'object',
          required: ['project_id'],
          properties: { project_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const access = await assertPictureBookProjectAccess(request.body.project_id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } })

      await recoverMissingAssetLinks(request.body.project_id, access)

      const rows = await getDb()
        .selectFrom('picture_book_project_assets as pba')
        .leftJoin('task_batches as tb', 'tb.id', 'pba.batch_id')
        .leftJoin('assets as a', 'a.batch_id', 'pba.batch_id')
        .select([
          'pba.id',
          'pba.batch_id as batchId',
          'pba.kind',
          'pba.ref_id as refId',
          'tb.status as batchStatus',
          'tb.actual_credits as actualCredits',
          'a.id as assetId',
          'a.storage_url as storageUrl',
          'a.original_url as originalUrl',
        ])
        .where('pba.project_id', '=', request.body.project_id)
        .execute()

      const state = access.state
      for (const row of rows) {
        const url = row.storageUrl ?? row.originalUrl ?? null
        const status = normalizeAssetStatus(row.batchStatus)
        if (url || status !== 'pending') {
          await getDb()
            .updateTable('picture_book_project_assets')
            .set({
              selected_asset_url: url,
              selected_asset_id: row.assetId ?? null,
              status,
              updated_at: sql`now()`,
            })
            .where('id', '=', row.id)
            .execute()
        }

        applySyncedAssetToState(state, row.kind, row.refId, url, status)
      }

      state.steps = normalizeStepsAfterSync(state)

      const charges = await getDb()
        .selectFrom('picture_book_project_charges')
        .select(['id', 'batch_ids as batchIds'])
        .where('project_id', '=', request.body.project_id)
        .execute()

      for (const row of rows) {
        if (!row.batchId || (row.batchStatus !== 'completed' && row.batchStatus !== 'failed')) continue
        const charge = charges.find(item => Array.isArray(item.batchIds) && item.batchIds.includes(row.batchId!))
        if (!charge) continue
        await getDb()
          .updateTable('picture_book_project_charges')
          .set({
            status: row.batchStatus === 'completed' ? 'completed' : 'failed',
            actual_credits: row.batchStatus === 'completed' ? row.actualCredits ?? 0 : null,
            updated_at: sql`now()`,
          })
          .where('id', '=', charge.id)
          .execute()
      }

      const updatedCharges = await getDb()
        .selectFrom('picture_book_project_charges')
        .select(['estimated_credits', 'actual_credits', 'status'])
        .where('project_id', '=', request.body.project_id)
        .execute()
      const totals = calculateProjectChargeTotal(updatedCharges)

      const coverUrl = state.storyboard?.find((page: any) => page.imageUrl)?.imageUrl ?? null

      await getDb()
        .updateTable('picture_book_projects')
        .set({
          state: JSON.stringify({ ...state, draft: { dirty: false, savedAt: new Date().toISOString() } }) as any,
          cover_url: coverUrl,
          estimated_credits: totals.estimatedCredits,
          actual_credits: totals.actualCredits,
          updated_at: sql`now()`,
        })
        .where('id', '=', request.body.project_id)
        .execute()

      return reply.send({ success: true, assets: rows.length, state })
    },
  )
}

async function recoverMissingAssetLinks(projectId: string, access: any): Promise<void> {
  const db = getDb()
  const targets = [
    ...(access.state.assets?.characters ?? []).map((item: any) => ({ ...item, kind: 'character' as const })),
    ...(access.state.assets?.backgrounds ?? []).map((item: any) => ({ ...item, kind: 'background' as const })),
  ].filter((item: any) => item.id && item.prompt)

  for (const target of targets) {
    const existing = await db
      .selectFrom('picture_book_project_assets')
      .select('id')
      .where('project_id', '=', projectId)
      .where('kind', '=', target.kind)
      .where('ref_id', '=', target.id)
      .executeTakeFirst()
    if (existing) continue

    const batch = await db
      .selectFrom('task_batches')
      .select(['id', 'estimated_credits as estimatedCredits'])
      .where('idempotency_key', 'like', `picture_book_${projectId}_${target.kind}_${target.id}_%`)
      .where('module', '=', 'image')
      .orderBy('created_at', 'desc')
      .executeTakeFirst()
    if (!batch) continue

    const estimatedCredits = Number(batch.estimatedCredits ?? 0)
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('task_batches')
        .set({ picture_book_project_id: projectId, source: 'studio' })
        .where('id', '=', batch.id)
        .execute()

      await trx
        .insertInto('picture_book_project_assets')
        .values({
          project_id: projectId,
          kind: target.kind,
          ref_id: target.id,
          name: target.name,
          prompt: target.prompt,
          batch_id: batch.id,
          status: 'pending',
          metadata: JSON.stringify({ model: PICTURE_BOOK_MODELS.image, recovered: true }),
        })
        .onConflict((oc) =>
          oc.columns(['project_id', 'kind', 'ref_id']).doNothing(),
        )
        .execute()

      await trx
        .insertInto('picture_book_project_charges')
        .values({
          project_id: projectId,
          workspace_id: access.workspaceId,
          team_id: access.teamId,
          user_id: access.ownerId,
          charge_type: 'project',
          model: PICTURE_BOOK_MODELS.image,
          target_count: 1,
          estimated_credits: estimatedCredits,
          actual_credits: null,
          status: 'processing',
          batch_ids: jsonbArray([batch.id]),
          metadata: JSON.stringify({ operation: 'asset_image', kind: target.kind, ref_id: target.id, recovered: true }),
        })
        .execute()
    })
  }
}

function normalizeAssetStatus(status: string | null): 'pending' | 'processing' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'processing') return 'processing'
  return 'pending'
}

function applySyncedAssetToState(state: any, kind: string, refId: string, url: string | null, status: string): void {
  if (kind === 'character') {
    state.assets.characters = state.assets.characters.map((item: any) => item.id === refId ? { ...item, imageUrl: url ?? item.imageUrl ?? null, status } : item)
    return
  }
  if (kind === 'background') {
    state.assets.backgrounds = state.assets.backgrounds.map((item: any) => item.id === refId ? { ...item, imageUrl: url ?? item.imageUrl ?? null, status } : item)
    return
  }
  if (!url) return
  if (kind === 'page_image') {
    state.storyboard = state.storyboard.map((page: any) => `page_${page.page}` === refId ? { ...page, imageUrl: url } : page)
    return
  }
  if (kind === 'page_audio_zh') {
    state.storyboard = state.storyboard.map((page: any) => `page_${page.page}` === refId ? { ...page, voice: { ...page.voice, zh: url } } : page)
    return
  }
  if (kind === 'page_audio_en') {
    state.storyboard = state.storyboard.map((page: any) => `page_${page.page}` === refId ? { ...page, voice: { ...page.voice, en: url } } : page)
  }
}

function normalizeStepsAfterSync(state: any): any {
  const completed = new Set(Array.isArray(state.steps?.completed) ? state.steps.completed : [])
  const characters = Array.isArray(state.assets?.characters) ? state.assets.characters : []
  const backgrounds = Array.isArray(state.assets?.backgrounds) ? state.assets.backgrounds : []
  const storyboard = Array.isArray(state.storyboard) ? state.storyboard : []

  if (characters.length + backgrounds.length > 0 && characters.concat(backgrounds).every((item: any) => item.imageUrl)) {
    completed.add('script')
    completed.add('assets')
  }

  if (storyboard.length > 0 && storyboard.every((page: any) => page.imageUrl && page.voice?.zh && page.voice?.en)) {
    completed.add('script')
    completed.add('assets')
    completed.add('storyboard')
  }

  return {
    active: state.steps?.active ?? 'script',
    completed: Array.from(completed),
  }
}

export default route
