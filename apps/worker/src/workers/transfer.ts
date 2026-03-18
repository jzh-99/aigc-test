import { Worker } from 'bullmq'
import pino from 'pino'
import { getDb } from '@aigc/db'
import type { TransferJobData } from '@aigc/types'
import { getRedis } from '../lib/redis.js'
import { validateExternalUrl } from '../lib/url-validator.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const EXTERNAL_STORAGE_URL =
  process.env.EXTERNAL_STORAGE_URL ?? 'http://61.155.227.20:19092/chatAI/api/video/content'

interface ExternalStorageResponse {
  code: number
  msg: string
  data: {
    uuid: string
    url: string
  }
}

async function uploadToExternalStorage(taskId: string, sourceUrl: string, assetType: 'image' | 'video' = 'image'): Promise<string> {
  const fileType = assetType === 'video' ? 'mp4' : 'jpg'
  const res = await fetch(EXTERNAL_STORAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: taskId, url: sourceUrl, type: fileType }),
  })

  if (!res.ok) {
    throw new Error(`External storage API error: ${res.status} ${res.statusText}`)
  }

  const body = (await res.json()) as ExternalStorageResponse
  if (body.code !== 10000 || !body.data?.url) {
    throw new Error(`External storage returned error: code=${body.code} msg=${body.msg}`)
  }

  return body.data.url
}

export const transferWorker = new Worker<TransferJobData>(
  'transfer-queue',
  async (job) => {
    const { taskId, assetId, originalUrl } = job.data
    logger.info({ jobId: job.id, taskId, assetId }, 'Processing transfer job')

    try {
      // SSRF protection: validate URL before fetching
      validateExternalUrl(originalUrl)

      const storageUrl = await uploadToExternalStorage(taskId, originalUrl, job.data.assetType ?? 'image')

      const db = getDb()
      await db
        .updateTable('assets')
        .set({
          storage_url: storageUrl,
          transfer_status: 'completed',
        })
        .where('id', '=', assetId)
        .execute()

      logger.info({ jobId: job.id, taskId, storageUrl }, 'Transfer completed')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ jobId: job.id, taskId, err: msg }, 'Transfer failed')

      const db = getDb()
      await db
        .updateTable('assets')
        .set({ transfer_status: 'failed' })
        .where('id', '=', assetId)
        .execute()

      throw err
    }
  },
  {
    connection: getRedis(),
    concurrency: 5,
  },
)

transferWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Transfer worker error')
})
