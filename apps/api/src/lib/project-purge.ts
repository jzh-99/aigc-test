import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { deleteTosObject, extractStorageKey } from './storage.js'

async function deleteStoredUrls(urls: Array<string | null | undefined>) {
  const keys = Array.from(new Set(urls.flatMap((url) => {
    if (!url) return []
    const key = extractStorageKey(url)
    return key ? [key] : []
  })))

  await Promise.all(keys.map((key) => deleteTosObject(key)))
}

export async function purgeCanvasProject(db: Kysely<any>, canvasId: string) {
  const canvas = await db
    .selectFrom('canvases')
    .select(['thumbnail_url'])
    .where('id', '=', canvasId)
    .executeTakeFirst()

  if (!canvas) return

  const assetRows = await db
    .selectFrom('assets as a')
    .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
    .select(['a.storage_url', 'a.original_url', 'a.thumbnail_url'])
    .where('b.canvas_id', '=', canvasId)
    .execute()

  const outputRows = await db
    .selectFrom('canvas_node_outputs')
    .select('output_urls')
    .where('canvas_id', '=', canvasId)
    .execute()

  await deleteStoredUrls([
    canvas.thumbnail_url,
    ...assetRows.flatMap((row) => [row.storage_url, row.original_url, row.thumbnail_url]),
    ...outputRows.flatMap((row) => row.output_urls ?? []),
  ])

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('assets')
      .where('batch_id', 'in', trx
        .selectFrom('task_batches')
        .select('id')
        .where('canvas_id', '=', canvasId))
      .execute()

    await trx
      .deleteFrom('canvas_node_outputs')
      .where('canvas_id', '=', canvasId)
      .execute()

    await trx
      .updateTable('task_batches')
      .set({ canvas_id: null, canvas_node_id: null })
      .where('canvas_id', '=', canvasId)
      .execute()

    await trx.deleteFrom('canvases').where('id', '=', canvasId).execute()
  })
}

export async function purgeVideoStudioProject(db: Kysely<any>, projectId: string) {
  const project = await db
    .selectFrom('video_studio_projects')
    .select('id')
    .where('id', '=', projectId)
    .executeTakeFirst()

  if (!project) return

  const assetRows = await db
    .selectFrom('assets as a')
    .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
    .select(['a.storage_url', 'a.original_url', 'a.thumbnail_url'])
    .where('b.video_studio_project_id', '=', projectId)
    .execute()

  await deleteStoredUrls(assetRows.flatMap((row) => [row.storage_url, row.original_url, row.thumbnail_url]))

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('assets')
      .where('batch_id', 'in', trx
        .selectFrom('task_batches')
        .select('id')
        .where('video_studio_project_id', '=', projectId))
      .execute()

    await trx
      .updateTable('task_batches')
      .set({ video_studio_project_id: null })
      .where('video_studio_project_id', '=', projectId)
      .execute()

    await trx.deleteFrom('video_studio_projects').where('id', '=', projectId).execute()
  })
}

export async function softDeleteProjectAssets(db: any, field: 'canvas_id' | 'video_studio_project_id', id: string) {
  await db
    .updateTable('assets')
    .set({ is_deleted: true, deleted_at: sql`now()` })
    .where('batch_id', 'in', db
      .selectFrom('task_batches')
      .select('id')
      .where(field, '=', id))
    .execute()
}

export async function restoreProjectAssets(db: any, field: 'canvas_id' | 'video_studio_project_id', id: string) {
  await db
    .updateTable('assets')
    .set({ is_deleted: false, deleted_at: null })
    .where('batch_id', 'in', db
      .selectFrom('task_batches')
      .select('id')
      .where(field, '=', id))
    .execute()
}
