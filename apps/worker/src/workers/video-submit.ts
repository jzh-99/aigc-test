import { Worker } from 'bullmq'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { sql } from 'kysely'
import type { VideoSubmitJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'
import { buildVolcengineTaskBody } from './video-submit-payload.js'

const logger = buildLogger()

const VOLCENGINE_API_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const VEO_API_URL = process.env.NANO_BANANA_API_URL ?? ''

interface VideoSubmitAuditContext {
  taskId: string
  batchId: string
  userId: string
  teamId: string
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function responseId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const id = (data as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function responseError(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const error = (data as { error?: { message?: unknown }; message?: unknown }).error
  if (typeof error?.message === 'string') return error.message
  const message = (data as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

async function submitVolcengine(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
  audit: VideoSubmitAuditContext,
): Promise<string> {
  const body = buildVolcengineTaskBody(model, prompt, params)
  const endpoint = '/contents/generations/tasks'
  const apiKey = process.env.VOLCENGINE_API_KEY ?? ''
  const startedAt = Date.now()
  let responseStatus: number | null = null
  try {
    const res = await fetch(`${VOLCENGINE_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    responseStatus = res.status
    const data = await readJsonResponse(res)
    const id = responseId(data)
    if (!res.ok || !id) {
      const message = responseError(data) ?? `火山引擎 API 错误 ${res.status}`
      await recordProviderApiLog({
        ...audit,
        module: 'video',
        provider: 'volcengine',
        model,
        operation: 'video.submit',
        method: 'POST',
        endpoint,
        requestPayload: body,
        responseStatus: res.status,
        responsePayload: data,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        errorMessage: message,
      })
      throw new Error(message)
    }
    await recordProviderApiLog({
      ...audit,
      module: 'video',
      provider: 'volcengine',
      model,
      operation: 'video.submit',
      method: 'POST',
      endpoint,
      requestPayload: body,
      responseStatus: res.status,
      responsePayload: data,
      externalTaskId: id,
      durationMs: Date.now() - startedAt,
      status: 'success',
    })
    return id
  } catch (error) {
    if (responseStatus !== null) throw error
    const message = error instanceof Error ? error.message : String(error)
    await recordProviderApiLog({
      ...audit,
      module: 'video',
      provider: 'volcengine',
      model,
      operation: 'video.submit',
      method: 'POST',
      endpoint,
      requestPayload: body,
      responseStatus,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      errorMessage: message,
    })
    throw error
  }
}

async function submitVeo(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
  audit: VideoSubmitAuditContext,
): Promise<string> {
  const body: Record<string, unknown> = { model, prompt }
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio
  if (typeof params.duration === 'number' && params.duration > 0) body.duration = params.duration

  const apiKey = process.env.NANO_BANANA_API_KEY ?? ''
  const endpoint = '/v2/videos/generations'
  const startedAt = Date.now()
  let responseStatus: number | null = null
  try {
    const res = await fetch(`${VEO_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    responseStatus = res.status
    const data = await readJsonResponse(res)
    const id = responseId(data)
    if (!res.ok || !id) {
      const message = responseError(data) ?? `Veo API 错误 ${res.status}`
      await recordProviderApiLog({
        ...audit,
        module: 'video',
        provider: 'nano-banana',
        model,
        operation: 'video.submit',
        method: 'POST',
        endpoint,
        requestPayload: body,
        responseStatus: res.status,
        responsePayload: data,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        errorMessage: message,
      })
      throw new Error(message)
    }
    await recordProviderApiLog({
      ...audit,
      module: 'video',
      provider: 'nano-banana',
      model,
      operation: 'video.submit',
      method: 'POST',
      endpoint,
      requestPayload: body,
      responseStatus: res.status,
      responsePayload: data,
      externalTaskId: id,
      durationMs: Date.now() - startedAt,
      status: 'success',
    })
    return id
  } catch (error) {
    if (responseStatus !== null) throw error
    const message = error instanceof Error ? error.message : String(error)
    await recordProviderApiLog({
      ...audit,
      module: 'video',
      provider: 'nano-banana',
      model,
      operation: 'video.submit',
      method: 'POST',
      endpoint,
      requestPayload: body,
      responseStatus,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      errorMessage: message,
    })
    throw error
  }
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
      const audit = { taskId, batchId, userId, teamId }
      const externalTaskId = provider === 'volcengine'
        ? await submitVolcengine(model, prompt, params, audit)
        : await submitVeo(model, prompt, params, audit)

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
          description: `视频任务提交失败：${msg.slice(0, 200)}`,
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
