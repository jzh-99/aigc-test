import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import crypto from 'node:crypto'
import type { VideoSubmitJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

const VOLCENGINE_API_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const VEO_API_URL = process.env.NANO_BANANA_API_URL ?? ''

const VOLCENGINE_MODEL_ID: Record<string, string> = {
  'seedance-1.5-pro':  'doubao-seedance-1-5-pro-251215',
  'seedance-2.0':      'doubao-seedance-2-0-260128',
  'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
}

const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

// 与 api/lib/storage.ts 保持一致：用 JWT_SECRET 派生代理加密 key
function encryptProxyUrl(url: string): string {
  const secret = process.env.JWT_SECRET ?? ''
  const key = crypto.createHash('sha256').update(secret + '-proxy').digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

/**
 * 将内部 URL 转换为 AI API 可访问的公网 URL：
 * - http:// 开头（内网地址）→ 加密代理 URL，防止内网地址暴露
 * - / 开头（相对路径）→ 拼接 BASE_URL
 * - https:// 开头 → 原样返回
 */
function toPublicUrl(url: string): string {
  if (url.startsWith('http://')) {
    return `${BASE_URL}/api/v1/assets/proxy?token=${encryptProxyUrl(url)}`
  }
  if (url.startsWith('/')) return `${BASE_URL}${url}`
  return url
}

function toPublicUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls?.length) return urls
  return urls.map(toPublicUrl)
}

/** 从 URL 扩展名推断媒体类型，用于防御性校验 */
function inferMediaType(url: string): 'image' | 'video' | 'audio' | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(mp4|mov|webm|avi|mkv)$/.test(pathname)) return 'video'
    if (/\.(mp3|wav|ogg|aac|flac|m4a)$/.test(pathname)) return 'audio'
    if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(pathname)) return 'image'
  } catch { /* ignore */ }
  return undefined
}

/** 按 URL 扩展名重新校验并纠正素材分类 */
function reclassifyReferences(
  images: string[] | undefined,
  videos: string[] | undefined,
  audios: string[] | undefined,
): { images: string[]; videos: string[]; audios: string[] } {
  const result = { images: [] as string[], videos: [] as string[], audios: [] as string[] }
  const all = [
    ...(images ?? []).map((u) => ({ url: u, declared: 'image' as const })),
    ...(videos ?? []).map((u) => ({ url: u, declared: 'video' as const })),
    ...(audios ?? []).map((u) => ({ url: u, declared: 'audio' as const })),
  ]
  for (const { url, declared } of all) {
    const inferred = inferMediaType(url)
    const actual = inferred ?? declared
    if (actual === 'video') result.videos.push(url)
    else if (actual === 'audio') result.audios.push(url)
    else result.images.push(url)
  }
  return result
}

async function submitVolcengine(model: string, prompt: string, params: Record<string, unknown>): Promise<string> {
  const volcModel = VOLCENGINE_MODEL_ID[model]
  if (!volcModel) throw new Error(`未知的火山引擎视频模型: ${model}`)

  const body: Record<string, unknown> = {
    model: volcModel,
    content: [{ type: 'text', text: prompt }],
  }

  const reqParams: Record<string, unknown> = {}
  if (params.aspect_ratio) reqParams.aspect_ratio = params.aspect_ratio
  if (typeof params.duration === 'number' && params.duration > 0) reqParams.time_length = params.duration
  if (typeof params.generate_audio === 'boolean') reqParams.generate_audio = params.generate_audio
  if (typeof params.camera_fixed === 'boolean') reqParams.camera_fixed = params.camera_fixed
  if (typeof params.enable_upsample === 'boolean') reqParams.enable_upsample = params.enable_upsample
  if (typeof params.watermark === 'boolean') reqParams.watermark = params.watermark
  if (params.resolution) reqParams.resolution = params.resolution
  if (Object.keys(reqParams).length > 0) body.parameters = reqParams

  const content = body.content as unknown[]

  // 首尾帧
  const images = params.images as string[] | undefined
  if (images?.length) {
    content.push(...images.map(url => ({ type: 'image_url', image_url: { url: toPublicUrl(url) } })))
  }

  // 多模态参考素材：先转公网 URL，再按扩展名防御性校验分类
  const rawImages = toPublicUrls(params.reference_images as string[] | undefined)
  const rawVideos = toPublicUrls(params.reference_videos as string[] | undefined)
  const rawAudios = toPublicUrls(params.reference_audios as string[] | undefined)
  const classified = reclassifyReferences(rawImages, rawVideos, rawAudios)
  if (classified.images.length) {
    content.push(...classified.images.map(url => ({ type: 'image_url', image_url: { url } })))
  }
  if (classified.videos.length) {
    content.push(...classified.videos.map(url => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })))
  }
  if (classified.audios.length) {
    content.push(...classified.audios.map(url => ({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })))
  }

  const apiKey = process.env.VOLCENGINE_API_KEY ?? ''
  const res = await fetch(`${VOLCENGINE_API_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json()) as { id?: string; error?: { message?: string } }
  if (!res.ok || !data.id) throw new Error(data.error?.message ?? `火山引擎 API 错误 ${res.status}`)
  return data.id
}

async function submitVeo(model: string, prompt: string, params: Record<string, unknown>): Promise<string> {
  const body: Record<string, unknown> = { model, prompt }
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio
  if (typeof params.duration === 'number' && params.duration > 0) body.duration = params.duration

  const apiKey = process.env.NANO_BANANA_API_KEY ?? ''
  const res = await fetch(`${VEO_API_URL}/v2/videos/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json()) as { id?: string; error?: { message?: string } }
  if (!res.ok || !data.id) throw new Error(data.error?.message ?? `Veo API 错误 ${res.status}`)
  return data.id
}

export const videoSubmitWorker = new Worker<VideoSubmitJobData>(
  'video-queue',
  async (job) => {
    const { taskId, batchId, userId, teamId, creditAccountId, provider, model, prompt, params, estimatedCredits } = job.data
    const logCtx = { jobId: job.id, taskId, provider, model }
    logger.info(logCtx, '[video-submit] 开始提交视频任务')

    const db = getDb()

    // 更新 task 为 processing
    await db.updateTable('tasks')
      .set({ status: 'processing', processing_started_at: new Date().toISOString(), queue_job_id: job.id ?? null })
      .where('id', '=', taskId)
      .execute()

    await db.updateTable('task_batches')
      .set({ status: 'processing' })
      .where('id', '=', batchId)
      .where('status', '=', 'pending')
      .execute()

    try {
      // 提交到 AI 提供商，拿到 external_task_id
      const externalTaskId = provider === 'volcengine'
        ? await submitVolcengine(model, prompt, params)
        : await submitVeo(model, prompt, params)

      // 写入 external_task_id，poller 开始轮询
      await db.updateTable('tasks')
        .set({ external_task_id: externalTaskId })
        .where('id', '=', taskId)
        .execute()

      logger.info({ ...logCtx, externalTaskId }, '[video-submit] 提交成功，等待 poller 轮询')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ...logCtx, err: msg }, '[video-submit] 提交失败，退还积分')

      // 提交失败：task/batch 标记失败，退还积分
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks')
          .set({ status: 'failed', error_message: msg.slice(0, 1000), completed_at: new Date().toISOString() })
          .where('id', '=', taskId)
          .execute()

        await trx.updateTable('credit_accounts')
          .set({ frozen_credits: sql`GREATEST(frozen_credits - ${estimatedCredits}, 0)` })
          .where('id', '=', creditAccountId)
          .execute()

        await trx.updateTable('team_members')
          .set({ credit_used: sql`GREATEST(credit_used - ${estimatedCredits}, 0)` })
          .where('team_id', '=', teamId)
          .where('user_id', '=', userId)
          .execute()

        await trx.insertInto('credits_ledger').values({
          credit_account_id: creditAccountId,
          user_id: userId,
          amount: estimatedCredits,
          type: 'refund',
          task_id: taskId,
          batch_id: batchId,
          description: `Video submit failed: ${msg.slice(0, 200)}`,
        }).execute()

        await trx.updateTable('task_batches')
          .set({ status: 'failed', failed_count: sql`failed_count + 1` })
          .where('id', '=', batchId)
          .execute()
      })

      await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 10,
    lockDuration: 60_000, // 提交阶段只需 1 分钟
  },
)

videoSubmitWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Video submit worker 错误')
})
