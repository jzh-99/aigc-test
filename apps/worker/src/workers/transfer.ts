import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { ErrorCode } from '@aigc/types'
import type { TransferJobData } from '@aigc/types'
import type { Agent } from 'node:http'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { URL } from 'node:url'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { validateExternalUrl } from '../lib/url-validator.js'
import { decodeDataUrl } from '../lib/data-url.js'
import { getTos, getBucket, getPublicUrl, getStorageRuntimeInfo } from '../lib/storage.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
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
// 连接超时：建立 TCP 连接的最长等待时间
const CONNECT_TIMEOUT_MS = 30_000
// 读取超时：连接建立后，读取数据的最长空闲时间
const READ_TIMEOUT_MS = 120_000
// 下载重试策略：立即重试 → 等待 3s → 等待 10s → 等待 30s
const DOWNLOAD_RETRY_DELAYS_MS = [0, 3_000, 10_000, 30_000]
let downloadHttpsProxyAgent: Agent | null = null

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getDownloadProxyUrl(): string | null {
  return process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY ?? null
}

function shouldBypassProxy(hostname: string): boolean {
  // 火山引擎 CDN 域名不走代理，避免代理服务器不稳定导致超时
  if (hostname.includes('volces.com') || hostname.includes('.tos-cn-')) {
    return true
  }

  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY
  if (!noProxy) return false

  const normalizedHost = hostname.toLowerCase()
  return noProxy
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .some(rule => {
      if (rule === '*') return true
      if (rule.startsWith('.')) return normalizedHost.endsWith(rule)
      return normalizedHost === rule || normalizedHost.endsWith(`.${rule}`)
    })
}

function getProxyProtocol(proxyUrl: string | null): string | null {
  if (!proxyUrl) return null
  try {
    return new URL(proxyUrl).protocol
  } catch {
    return null
  }
}

function getDownloadAgent(parsedUrl: URL): Agent | undefined {
  if (parsedUrl.protocol !== 'https:' || shouldBypassProxy(parsedUrl.hostname)) return undefined

  const proxyUrl = getDownloadProxyUrl()
  if (!proxyUrl) return undefined

  downloadHttpsProxyAgent ??= new HttpsProxyAgent(proxyUrl) as unknown as Agent
  return downloadHttpsProxyAgent
}

function requestToBuffer(url: string, redirectCount = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    let connected = false
    let connectTimer: NodeJS.Timeout | null = null
    let readTimer: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer)
      if (readTimer) clearTimeout(readTimer)
    }

    const request = (parsedUrl.protocol === 'http:' ? httpGet : httpsGet)(
      parsedUrl,
      {
        headers: {
          'User-Agent': 'aigc-worker-transfer/1.0',
          'Accept': 'image/*,video/*,*/*',
        },
        agent: getDownloadAgent(parsedUrl),
      },
      (res) => {
        connected = true
        cleanup()

        const statusCode = res.statusCode ?? 0
        const location = res.headers.location

        if (statusCode >= 300 && statusCode < 400 && location) {
          res.resume()
          if (redirectCount >= 3) {
            reject(new Error(`下载重定向过多: ${statusCode}`))
            return
          }

          try {
            const redirectUrl = new URL(location, parsedUrl).toString()
            validateExternalUrl(redirectUrl)
            requestToBuffer(redirectUrl, redirectCount + 1).then(resolve, reject)
          } catch (error) {
            // 重定向 URL 解析或校验失败：记录目标地址与错误，外层调用方会在重试日志中再次捕获
            logger.warn({ url: location, fromUrl: url, err: error }, '下载重定向解析失败')
            reject(error)
          }
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume()
          reject(new Error(`下载失败: ${statusCode} ${res.statusMessage ?? ''} url=${url}`))
          return
        }

        // 连接建立后，设置读取超时
        readTimer = setTimeout(() => {
          request.destroy(new Error(`数据读取超时: ${READ_TIMEOUT_MS}ms url=${url}`))
        }, READ_TIMEOUT_MS)

        const chunks: Buffer[] = []
        res.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          // 每次收到数据重置读取超时
          if (readTimer) clearTimeout(readTimer)
          readTimer = setTimeout(() => {
            request.destroy(new Error(`数据读取超时: ${READ_TIMEOUT_MS}ms url=${url}`))
          }, READ_TIMEOUT_MS)
        })
        res.on('end', () => {
          cleanup()
          resolve(Buffer.concat(chunks))
        })
      },
    )

    // 连接超时：仅针对 TCP 连接建立阶段
    connectTimer = setTimeout(() => {
      if (!connected) {
        request.destroy(new Error(`连接建立超时: ${CONNECT_TIMEOUT_MS}ms url=${url}`))
      }
    }, CONNECT_TIMEOUT_MS)

    request.on('error', (err) => {
      cleanup()
      reject(err)
    })
  })
}

/**
 * 下载远程 URL 为 Buffer（AI 提供商 CDN 地址）
 */
async function downloadToBuffer(url: string): Promise<Buffer> {
  let lastError: unknown
  const startTime = Date.now()

  for (let attempt = 0; attempt < DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
    const delayMs = DOWNLOAD_RETRY_DELAYS_MS[attempt]
    if (delayMs > 0) await sleep(delayMs)

    const attemptStartTime = Date.now()
    try {
      const buffer = await requestToBuffer(url)
      const duration = Date.now() - attemptStartTime
      logger.info({
        url,
        attempt: attempt + 1,
        duration,
        size: buffer.length,
        downloadProxyProtocol: getProxyProtocol(getDownloadProxyUrl()),
        bypassProxy: shouldBypassProxy(new URL(url).hostname),
      }, '下载远程文件成功')
      return buffer
    } catch (error) {
      lastError = error
      const duration = Date.now() - attemptStartTime
      logger.warn({
        url,
        attempt: attempt + 1,
        maxAttempts: DOWNLOAD_RETRY_DELAYS_MS.length,
        duration,
        nextRetryDelayMs: attempt + 1 < DOWNLOAD_RETRY_DELAYS_MS.length ? DOWNLOAD_RETRY_DELAYS_MS[attempt + 1] : null,
        downloadProxyProtocol: getProxyProtocol(getDownloadProxyUrl()),
        bypassProxy: shouldBypassProxy(new URL(url).hostname),
        err: error instanceof Error ? error.message : String(error),
      }, '下载远程文件失败，准备重试')
    }
  }

  const totalDuration = Date.now() - startTime
  const cause = lastError instanceof Error && (lastError as NodeJS.ErrnoException).cause
    ? ` cause=${String((lastError as NodeJS.ErrnoException).cause)}`
    : ''
  throw new Error(`下载网络错误(总耗时${totalDuration}ms): ${lastError instanceof Error ? lastError.message : String(lastError)}${cause} url=${url}`)
}

/**
 * 将 Buffer 上传到 TOS，返回公网永久 URL
 */
async function uploadToTos(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const tos = getTos()
  const bucket = getBucket()
  await tos.putObject({ bucket, key, body: buffer, contentType })
  return `${getPublicUrl()}/${encodeURI(key)}`
}

/**
 * 从视频 URL 提取首帧缩略图，返回 JPEG Buffer
 */
async function extractVideoThumbnail(videoUrl: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'aigc-thumb-'))
  const outPath = join(tmpDir, 'thumb.jpg')
  const startTime = Date.now()
  try {
    // ffmpeg 提取缩略图：60 秒超时（包含下载视频文件的时间）
    await execFileAsync('ffmpeg', [
      '-i', videoUrl,
      '-ss', '0',
      '-frames:v', '1',
      '-vf', 'scale=512:-1',
      '-q:v', '3',
      '-y',
      outPath,
    ], { timeout: 60_000 })
    const buffer = await readFile(outPath)
    const duration = Date.now() - startTime
    logger.info({ videoUrl, duration, size: buffer.length }, 'ffmpeg 缩略图提取成功')
    return buffer
  } catch (err) {
    const duration = Date.now() - startTime
    logger.warn({
      err: String(err),
      videoUrl,
      duration,
      stderr: err instanceof Error && 'stderr' in err ? String(err.stderr) : null,
    }, 'ffmpeg 缩略图提取失败')
    return null
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export const transferWorker = new Worker<TransferJobData>(
  'transfer-queue',
  async (job) => {
    const { taskId, batchId, assetId, originalUrl } = job.data
    const assetType = job.data.assetType ?? 'image'
    logger.info({ jobId: job.id, taskId, assetId, assetType }, '开始处理 transfer 任务')

    try {
      // 获取待转存的二进制数据与 contentType。两条路径：
      // - data: URL（Gemini 等适配器只能返回 inline base64）：就地解码，不经过 SSRF 校验，
      //   因为它本身不是外部网络地址，无 SSRF 风险；contentType 取 data URL 里的真实 mime。
      // - http/https URL：先做 SSRF 防护（validateExternalUrl 拦截私有地址/非常规协议），
      //   再下载到 buffer；contentType 按 assetType 兜底（视频 mp4 / 图片 jpeg）。
      const isDataUrl = originalUrl.startsWith('data:')
      const ext = assetType === 'video' ? 'mp4' : 'jpg'
      let buffer: Buffer
      let contentType: string
      if (isDataUrl) {
        const decoded = decodeDataUrl(originalUrl)
        buffer = decoded.buffer
        contentType = decoded.contentType
        logger.info({ jobId: job.id, taskId, contentType, size: buffer.length }, 'data: URL 已解码，直接上传 TOS（跳过 SSRF 与下载）')
      } else {
        // SSRF 防护：校验 URL 合法性
        validateExternalUrl(originalUrl)
        // 下载 AI 生成的文件
        buffer = await downloadToBuffer(originalUrl)
        contentType = assetType === 'video' ? 'video/mp4' : 'image/jpeg'
      }

      // 上传到 TOS，key 格式：assets/{type}/{taskId}.{ext}
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

      if (batchId) {
        // 分流：开放接口任务走最终回调（media 用转存后的 TOS 永久 URL），
        // 非开放接口任务保持原 SSE
        const oa = await db.selectFrom('task_batches')
          .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
          .where('id', '=', batchId)
          .executeTakeFirst()

        if (oa?.source === 'open_api') {
          // 开放接口最终回调：media 字段按 assetType 区分
          // - video → video_url（对齐 buildAsyncCallbackPayload 的 video meta 契约）
          // - image → image_url
          // storageUrl 为已转存的 TOS 永久 URL
          const media = assetType === 'video'
            ? { video_url: storageUrl }
            : { image_url: storageUrl }
          await dispatchBatchResult({
            batchId,
            status: 'succeeded',
            serviceType: oa.service_type ?? (assetType === 'video' ? 'video' : 'image'),
            media,
            businessId: oa.business_id ?? '',
            taskId: oa.task_id ?? '',
            callbackUrl: oa.callback_url,
          })
        } else {
          try {
            await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
          } catch (error) {
            logger.warn({ jobId: job.id, taskId, err: error instanceof Error ? error.message : String(error) }, 'Transfer 完成后发布 SSE 失败')
          }
        }
      }

      // 同步更新 canvas_node_outputs 中的 URL
      await db
        .updateTable('canvas_node_outputs')
        .set({ output_urls: sql`array_replace(output_urls, ${originalUrl}::text, ${storageUrl}::text)` })
        .where(sql<boolean>`${originalUrl}::text = ANY(output_urls)`)
        .execute()

      logger.info({ jobId: job.id, taskId, storageUrl, thumbnailUrl }, 'Transfer 完成')
    } catch (err) {
      // Node.js 错误的根因藏在 cause 里，必须一起打印
      const msg = err instanceof Error ? err.message : String(err)
      const cause = err instanceof Error && (err as NodeJS.ErrnoException).cause
        ? String((err as NodeJS.ErrnoException).cause)
        : undefined
      const code = err instanceof Error && 'code' in err ? String(err.code) : undefined
      const parsedUrl = new URL(originalUrl)

      logger.error({
        jobId: job.id,
        taskId,
        assetId,
        assetType,
        originalUrl,
        originalUrlHostname: parsedUrl.hostname,
        err: msg,
        cause,
        code,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
        storage: getStorageRuntimeInfo(),
        proxyUrl: getDownloadProxyUrl(),
        downloadProxyProtocol: getProxyProtocol(getDownloadProxyUrl()),
        bypassProxy: shouldBypassProxy(parsedUrl.hostname),
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        readTimeoutMs: READ_TIMEOUT_MS,
      }, 'Transfer 失败')

      const attempts = job.opts.attempts ?? 1
      const isFinalAttempt = job.attemptsMade + 1 >= attempts
      if (isFinalAttempt) {
        const db = getDb()
        await db
          .updateTable('assets')
          .set({ transfer_status: 'failed' })
          .where('id', '=', assetId)
          .execute()
        if (batchId) {
          // 分流：开放接口任务转存最终失败 → 走失败回调；非开放接口保持原 SSE
          const oa = await db.selectFrom('task_batches')
            .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
            .where('id', '=', batchId)
            .executeTakeFirst()

          if (oa?.source === 'open_api') {
            try {
              await dispatchBatchResult({
                batchId,
                status: 'failed',
                serviceType: oa.service_type ?? 'image',
                media: {},
                businessId: oa.business_id ?? '',
                taskId: oa.task_id ?? '',
                callbackUrl: oa.callback_url,
                failureCode: ErrorCode.STORAGE_FAILED,
              })
            } catch (cbErr) {
              logger.warn({ jobId: job.id, taskId, err: cbErr instanceof Error ? cbErr.message : String(cbErr) }, 'Transfer 失败后开放接口回调入队失败')
            }
          } else {
            try {
              await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
            } catch (publishErr) {
              logger.warn({ jobId: job.id, taskId, err: publishErr instanceof Error ? publishErr.message : String(publishErr) }, 'Transfer 失败后发布 SSE 失败')
            }
          }
        }
        logger.error({
          jobId: job.id,
          taskId,
          assetId,
          attemptsMade: job.attemptsMade + 1,
        }, 'Transfer 最终失败，已标记为 failed')
      }

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
