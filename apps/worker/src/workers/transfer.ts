import { Worker } from 'bullmq'
import pino from 'pino'
import { getDb } from '@aigc/db'
import type { TransferJobData } from '@aigc/types'
import { getRedis } from '../lib/redis.js'
import { validateExternalUrl } from '../lib/url-validator.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const EXTERNAL_STORAGE_URL = process.env.EXTERNAL_STORAGE_URL
if (!EXTERNAL_STORAGE_URL) throw new Error('EXTERNAL_STORAGE_URL env var is required')

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

// Upload a local file buffer to external storage as an image
async function uploadBufferToExternalStorage(taskId: string, buffer: Buffer): Promise<string> {
  const base64 = buffer.toString('base64')
  const dataUrl = `data:image/jpeg;base64,${base64}`

  // Use the same API but pass a data URL — fallback: upload as jpg type
  const res = await fetch(EXTERNAL_STORAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: `${taskId}-thumb`, url: dataUrl, type: 'jpg' }),
  })

  if (!res.ok) throw new Error(`Thumbnail upload error: ${res.status}`)
  const body = (await res.json()) as ExternalStorageResponse
  if (body.code !== 10000 || !body.data?.url) throw new Error(`Thumbnail upload failed: ${body.msg}`)
  return body.data.url
}

// Extract first frame from a video URL using ffmpeg, return as JPEG buffer
async function extractVideoThumbnail(videoUrl: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'aigc-thumb-'))
  const outPath = join(tmpDir, 'thumb.jpg')
  try {
    await execFileAsync('ffmpeg', [
      '-i', videoUrl,
      '-ss', '0',
      '-frames:v', '1',
      '-vf', 'scale=512:-1',  // resize to max 512px wide, keep aspect ratio
      '-q:v', '3',            // JPEG quality
      '-y',
      outPath,
    ], { timeout: 30_000 })

    const buf = await readFile(outPath)
    return buf
  } catch (err) {
    logger.warn({ err: String(err), videoUrl }, 'ffmpeg thumbnail extraction failed')
    return null
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export const transferWorker = new Worker<TransferJobData>(
  'transfer-queue',
  async (job) => {
    const { taskId, assetId, originalUrl } = job.data
    const assetType = job.data.assetType ?? 'image'
    logger.info({ jobId: job.id, taskId, assetId, assetType }, 'Processing transfer job')

    try {
      // SSRF protection: validate URL before fetching
      validateExternalUrl(originalUrl)

      const storageUrl = await uploadToExternalStorage(taskId, originalUrl, assetType)

      // For videos: extract first frame thumbnail via ffmpeg
      let thumbnailUrl: string | null = null
      if (assetType === 'video') {
        try {
          const thumbBuf = await extractVideoThumbnail(originalUrl)
          if (thumbBuf) {
            thumbnailUrl = await uploadBufferToExternalStorage(taskId, thumbBuf)
            logger.info({ jobId: job.id, taskId, thumbnailUrl }, 'Video thumbnail extracted and uploaded')
          }
        } catch (thumbErr) {
          // Thumbnail failure is non-fatal — video still transfers successfully
          logger.warn({ jobId: job.id, taskId, err: String(thumbErr) }, 'Video thumbnail step failed (non-fatal)')
        }
      }

      const db = getDb()
      await db
        .updateTable('assets')
        .set({
          storage_url: storageUrl,
          transfer_status: 'completed',
          ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
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
