import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, calculateProjectChargeTotal } from './_shared.js'

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

        applySyncedAssetToState(state, row.kind, row.refId, url)
      }

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

      await getDb()
        .updateTable('picture_book_projects')
        .set({
          state: JSON.stringify({ ...state, draft: { dirty: false, savedAt: new Date().toISOString() } }) as any,
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

function normalizeAssetStatus(status: string | null): 'pending' | 'processing' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'processing') return 'processing'
  return 'pending'
}

function applySyncedAssetToState(state: any, kind: string, refId: string, url: string | null): void {
  if (!url) return
  if (kind === 'character') {
    state.assets.characters = state.assets.characters.map((item: any) => item.id === refId ? { ...item, imageUrl: url } : item)
    return
  }
  if (kind === 'background') {
    state.assets.backgrounds = state.assets.backgrounds.map((item: any) => item.id === refId ? { ...item, imageUrl: url } : item)
    return
  }
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

export default route
