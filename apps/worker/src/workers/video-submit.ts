import { Worker } from 'bullmq'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { ctyunEdgeConfig, nanoBananaConfig, volcengineConfig } from '@aigc/nacos-config'
import { sql } from 'kysely'
import type { VideoSubmitJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'
import { buildCtyunEdgeTaskBody, buildVolcengineTaskBody } from './video-submit-payload.js'
import { buildCreationResultOutboxPayload, enqueueCreationResultOutbox } from '../lib/biz-mgmt-result-outbox.js'

const logger = buildLogger()

// 注意：AI API 配置不在此处顶层读取，而是在提交函数体内通过 Nacos getter 实时读取，
// 支持配置热更（改 key/endpoint 免重启）。

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
  const apiUrl = volcengineConfig.apiUrl.replace(/\/$/, '')
  const apiKey = volcengineConfig.apiKey
  const startedAt = Date.now()
  let responseStatus: number | null = null
  try {
    const res = await fetch(`${apiUrl}${endpoint}`, {
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

async function submitCtyunEdge(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
  audit: VideoSubmitAuditContext,
): Promise<string> {
  // 每次提交实时读取 Nacos getter，支持热更（改 endpoint 免重启）。
  const CTYUN_EDGE_API_URL = ctyunEdgeConfig.apiBaseUrl.replace(/\/$/, '')
  const body = buildCtyunEdgeTaskBody(model, prompt, params)
  const endpoint = '/contents/generations/tasks'
  const apiKey = ctyunEdgeConfig.apiKey
  const startedAt = Date.now()
  let responseStatus: number | null = null
  try {
    const res = await fetch(`${CTYUN_EDGE_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    responseStatus = res.status
    const data = await readJsonResponse(res)
    const id = responseId(data)
    if (!res.ok || !id) {
      const message = responseError(data) ?? `天翼云边缘AI网关 API 错误 ${res.status}`
      await recordProviderApiLog({
        ...audit,
        module: 'video',
        provider: 'ctyun-edge',
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
      provider: 'ctyun-edge',
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
      provider: 'ctyun-edge',
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
  // 每次提交实时读取 Nacos getter，支持热更（改 endpoint 免重启）。
  const VEO_API_URL = nanoBananaConfig.apiUrl.replace(/\/$/, '')
  const body: Record<string, unknown> = { model, prompt }
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio
  if (typeof params.duration === 'number' && params.duration > 0) body.duration = params.duration

  const apiKey = nanoBananaConfig.apiKey
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
    const { taskId, batchId, userId, teamId, provider, model, prompt, params, estimatedCredits, bizMgmtUserId, bizMgmtDeductRequestNo, bizMgmtWorkNo } = job.data
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
        : provider === 'ctyun-edge'
          ? await submitCtyunEdge(model, prompt, params, audit)
          : await submitVeo(model, prompt, params, audit)

      // 写入 external_task_id，poller 开始轮询
      await db.updateTable('tasks')
        .set({ external_task_id: externalTaskId })
        .where('id', '=', taskId)
        .execute()

      logger.info({ ...logCtx, externalTaskId }, '[video-submit] 提交成功，等待 poller 轮询')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ...logCtx, err: msg }, '[video-submit] 提交失败')

      // 提交失败：task/batch 标记失败。业管化后本地不退积分。
      await db.transaction().execute(async (trx: any) => {
        await trx.updateTable('tasks')
          .set({ status: 'failed', error_message: msg.slice(0, 1000), completed_at: new Date().toISOString() })
          .where('id', '=', taskId)
          .execute()

        await trx.updateTable('task_batches')
          .set({ status: 'failed', failed_count: sql`failed_count + 1` })
          .where('id', '=', batchId)
          .execute()
      })

      // 业管身份任务：写创作结果 outbox(success=false) 通知业管退款
      if (bizMgmtUserId && bizMgmtDeductRequestNo) {
        try {
          await enqueueCreationResultOutbox(buildCreationResultOutboxPayload({
            localUserId: userId,
            bizMgmtUserId,
            teamId,
            workspaceId: job.data.workspaceId ?? null,
            batchId,
            taskId,
            taskStatus: 'failed',
            pointsNum: estimatedCredits,
            requestNo: bizMgmtDeductRequestNo,
            workNo: bizMgmtWorkNo ?? taskId,
            module: 'video',
            message: msg,
          }))
        } catch (outboxErr) {
          logger.error({ err: outboxErr instanceof Error ? outboxErr.message : String(outboxErr), taskId }, 'Failed to enqueue video-submit creation result outbox')
        }
      }

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
