import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { TransferJobData } from '@aigc/types'
import { getBullMQConnection } from '../lib/redis.js'
import { validateExternalUrl } from '../lib/url-validator.js'
import { getTos, getBucket, getPublicUrl } from '../lib/storage.js'
import { buildLogger } from '../logger.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDefaultResultOrder } from 'node:dns'

// 优先 IPv4，避免 IPv6 不通导致 fetch 超时
setDefaultResultOrder('ipv4first')

const execFileAsync = promisify(execFile)
const logger = buildLogger()

/**
 * 下载远程 URL 为 Buffer（AI 提供商 CDN 地址）
 */
async function downloadToBuffer(url: string): Promise<Buffer> {
  let res: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000) // 30s 超时
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const cause = err instanceof Error && (err as NodeJS.ErrnoException).cause
      ? ` cause=${String((err as NodeJS.ErrnoException).cause)}`
      : ''
    throw new Error(`下载网络错误: ${err instanceof Error ? err.message : String(err)}${cause} url=${url}`)
  }
  if (!res.ok) throw new Error(`下载失败: ${res.status} ${res.statusText} url=${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 将 Buffer 上传到 TOS，返回公网永久 URL
 */
async function uploadToTos(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const tos = getTos()
  const bucket = getBucket()
  await tos.putObject({ bucket, key, body: buffer, contentType })
  return `${getPublicUrl()}/${key}`
}

/**
 * 从视频 URL 提取首帧缩略图，返回 JPEG Buffer
 */
async function extractVideoThumbnail(videoUrl: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'aigc-thumb-'))
  const outPath = join(tmpDir, 'thumb.jpg')
  try {
    await execFileAsync('ffmpeg', [
      '-i', videoUrl,
      '-ss', '0',
      '-frames:v', '1',
      '-vf', 'scale=512:-1',
      '-q:v', '3',
      '-y',
      outPath,
    ], { timeout: 30_000 })
    return await readFile(outPath)
  } catch (err) {
    logger.warn({ err: String(err), videoUrl }, 'ffmpeg 缩略图提取失败')
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
    logger.info({ jobId: job.id, taskId, assetId, assetType }, '开始处理 transfer 任务')

    try {
      // SSRF 防护：校验 URL 合法性
      validateExternalUrl(originalUrl)

      // 下载 AI 生成的文件
      const buffer = await downloadToBuffer(originalUrl)

      // 上传到 TOS，key 格式：assets/{type}/{taskId}.{ext}
      const ext = assetType === 'video' ? 'mp4' : 'jpg'
      const contentType = assetType === 'video' ? 'video/mp4' : 'image/jpeg'
      const key = `assets/${assetType}/${taskId}.${ext}`
      const storageUrl = await uploadToTos(key, buffer, contentType)

      // 视频额外提取首帧缩略图并上传
      let thumbnailUrl: string | null = null
      if (assetType === 'video') {
        try {
          const thumbBuf = await extractVideoThumbnail(originalUrl)
          if (thumbBuf) {
            const thumbKey = `thumbnails/${taskId}.jpg`
            thumbnailUrl = await uploadToTos(thumbKey, thumbBuf, 'image/jpeg')
            logger.info({ jobId: job.id, taskId, thumbnailUrl }, '视频缩略图上传成功')
          }
        } catch (thumbErr) {
          // 缩略图失败不影响主流程
          logger.warn({ jobId: job.id, taskId, err: String(thumbErr) }, '视频缩略图步骤失败（非致命）')
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

      // 同步更新 canvas_node_outputs 中的 URL
      await db
        .updateTable('canvas_node_outputs')
        .set({ output_urls: sql`array_replace(output_urls, ${originalUrl}::text, ${storageUrl}::text)` })
        .where(sql<boolean>`${originalUrl}::text = ANY(output_urls)`)
        .execute()

      logger.info({ jobId: job.id, taskId, storageUrl }, 'Transfer 完成')
    } catch (err) {
      // Node.js fetch 错误的根因藏在 cause 里，必须一起打印
      const msg = err instanceof Error ? err.message : String(err)
      const cause = err instanceof Error && (err as NodeJS.ErrnoException).cause
        ? String((err as NodeJS.ErrnoException).cause)
        : undefined
      logger.error({ jobId: job.id, taskId, assetId, originalUrl, err: msg, cause }, 'Transfer 失败')

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
    connection: getBullMQConnection(),
    concurrency: 5,
    // 下载 AI 文件 + 上传 TOS + ffmpeg 提取缩略图，整个流程最长可达 3 分钟
    // 不设置会用默认 30s，进程重启时 job 容易被误判为 stalled 并丢失
    lockDuration: 300_000, // 5 分钟
  },
)

transferWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Transfer worker 错误')
})
