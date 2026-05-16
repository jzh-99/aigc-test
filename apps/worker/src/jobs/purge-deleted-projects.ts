import { getDb } from '@aigc/db'
import pino_ from 'pino'
import { getBucket, getPublicUrl, getTos } from '../lib/storage.js'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const PROJECT_RETENTION_DAYS = 7

function extractStorageKey(storageUrl: string | null | undefined): string | null {
  if (!storageUrl) return null
  const publicUrl = getPublicUrl()
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) return null
  const key = storageUrl.slice(publicUrl.length + 1)
  return key || null
}

async function deleteStoredUrls(urls: Array<string | null | undefined>) {
  const keys = Array.from(new Set(urls.flatMap((url) => {
    const key = extractStorageKey(url)
    return key ? [key] : []
  })))
  const tos = getTos()
  const bucket = getBucket()
  await Promise.all(keys.map((key) => tos.deleteObject({ bucket, key })))
}

async function purgeCanvasProject(canvasId: string) {
  const db = getDb()
  const canvas = await db.selectFrom('canvases').select('thumbnail_url').where('id', '=', canvasId).executeTakeFirst()
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
    await trx.deleteFrom('assets').where('batch_id', 'in', trx.selectFrom('task_batches').select('id').where('canvas_id', '=', canvasId)).execute()
    await trx.deleteFrom('canvas_node_outputs').where('canvas_id', '=', canvasId).execute()
    await trx.updateTable('task_batches').set({ canvas_id: null, canvas_node_id: null }).where('canvas_id', '=', canvasId).execute()
    await trx.deleteFrom('canvases').where('id', '=', canvasId).execute()
  })
}

async function purgeVideoStudioProject(projectId: string) {
  const db = getDb()
  const project = await db.selectFrom('video_studio_projects').select('id').where('id', '=', projectId).executeTakeFirst()
  if (!project) return

  const assetRows = await db
    .selectFrom('assets as a')
    .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
    .select(['a.storage_url', 'a.original_url', 'a.thumbnail_url'])
    .where('b.video_studio_project_id', '=', projectId)
    .execute()

  await deleteStoredUrls(assetRows.flatMap((row) => [row.storage_url, row.original_url, row.thumbnail_url]))

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('assets').where('batch_id', 'in', trx.selectFrom('task_batches').select('id').where('video_studio_project_id', '=', projectId)).execute()
    await trx.updateTable('task_batches').set({ video_studio_project_id: null }).where('video_studio_project_id', '=', projectId).execute()
    await trx.deleteFrom('video_studio_projects').where('id', '=', projectId).execute()
  })
}

export async function runPurgeDeletedProjects(): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - PROJECT_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const canvases = await db.selectFrom('canvases').select('id').where('is_deleted', '=', true).where('deleted_at', '<', cutoff as any).limit(100).execute()
  const videoProjects = await db.selectFrom('video_studio_projects').select('id').where('is_deleted', '=', true).where('deleted_at', '<', cutoff as any).limit(100).execute()

  let purgedCanvases = 0
  let purgedVideoProjects = 0

  for (const canvas of canvases) {
    try {
      await purgeCanvasProject(canvas.id)
      purgedCanvases += 1
    } catch (err) {
      logger.error({ err, canvasId: canvas.id }, 'Failed to purge deleted canvas')
    }
  }

  for (const project of videoProjects) {
    try {
      await purgeVideoStudioProject(project.id)
      purgedVideoProjects += 1
    } catch (err) {
      logger.error({ err, projectId: project.id }, 'Failed to purge deleted video studio project')
    }
  }

  if (purgedCanvases > 0 || purgedVideoProjects > 0) {
    logger.info({ purgedCanvases, purgedVideoProjects }, 'Purged deleted projects')
  }
}
