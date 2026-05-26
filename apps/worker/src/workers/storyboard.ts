import { Worker } from 'bullmq'
import { sql } from 'kysely'
import type { StoryboardJobData } from '@aigc/types'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

const API_URL = process.env.QWEN_API_URL ?? ''
const API_KEY = process.env.QWEN_API_KEY ?? ''
const MODEL = process.env.QWEN_MODEL ?? 'qwen3.6-plus'
const SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_STORYBOARD_SPLIT ?? ''
const QWEN_STORYBOARD_TIMEOUT_MS = 300_000

interface ShotItem {
  shotNumber: number
  duration: number
  sceneDescription: string
  character1: string
  characterDesc1: string
  character2: string
  characterDesc2: string
  reference: string
  shotType: string
  characterAction: string
  emotion: string
  sceneTags: string[]
  lightAtmosphere: string
  soundEffect: string
  dialogue: string
  compositionPrompt: string
  cameraMotionPrompt: string
}

async function callQwen(
  data: StoryboardJobData,
  logCtx: Record<string, unknown>,
): Promise<ShotItem[]> {
  const { script, shotCount } = data
  const countInstruction = shotCount > 0
    ? `分割成 ${shotCount} 个分镜`
    : '根据剧本内容自动决定分镜数量（每个分镜约10秒）'
  const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`
  const startedAt = Date.now()
  const endpoint = '/chat/completions'
  const requestPayload = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
    max_tokens: 16000,
    enable_thinking: false,
  }
  let auditWritten = false

  async function writeAudit(input: {
    responseStatus?: number | null
    responsePayload?: unknown
    status: 'success' | 'failed'
    errorMessage?: string | null
  }): Promise<void> {
    auditWritten = true
    await recordProviderApiLog({
      batchId: data.batchId,
      taskId: data.taskId,
      userId: data.userId,
      teamId: data.teamId,
      module: 'storyboard',
      provider: 'qwen',
      model: MODEL,
      operation: 'storyboard.split',
      method: 'POST',
      endpoint,
      requestPayload,
      responseStatus: input.responseStatus ?? null,
      responsePayload: input.responsePayload,
      durationMs: Date.now() - startedAt,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
    })
  }

  logger.info(
    {
      ...logCtx,
      apiUrlConfigured: Boolean(API_URL),
      apiUrlHost: API_URL ? new URL(API_URL).host : null,
      apiKeyConfigured: Boolean(API_KEY),
      model: MODEL,
      timeoutMs: QWEN_STORYBOARD_TIMEOUT_MS,
      scriptLength: script.length,
      shotCount,
      systemPromptLength: SYSTEM_PROMPT.length,
      userPromptLength: userPrompt.length,
    },
    '[storyboard-job] Qwen 请求开始',
  )

  const controller = new AbortController()
  let didLocalTimeout = false
  const timer = setTimeout(() => {
    didLocalTimeout = true
    logger.warn({ ...logCtx, elapsedMs: Date.now() - startedAt, timeoutMs: QWEN_STORYBOARD_TIMEOUT_MS }, '[storyboard-job] Qwen 请求触发本地超时')
    controller.abort()
  }, QWEN_STORYBOARD_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeAudit({ status: 'failed', errorMessage: message })
    logger.error(
      {
        ...logCtx,
        errName: err instanceof Error ? err.name : null,
        errMessage: err instanceof Error ? err.message : String(err),
        errStack: err instanceof Error ? err.stack : null,
        didLocalTimeout,
        signalAborted: controller.signal.aborted,
        elapsedMs: Date.now() - startedAt,
      },
      '[storyboard-job] Qwen fetch 异常',
    )
    throw err
  } finally {
    clearTimeout(timer)
  }

  logger.info(
    {
      ...logCtx,
      status: res.status,
      ok: res.ok,
      elapsedMs: Date.now() - startedAt,
      contentType: res.headers.get('content-type'),
      requestId: res.headers.get('x-request-id') ?? res.headers.get('request-id'),
    },
    '[storyboard-job] Qwen 响应状态',
  )

  if (!res.ok) {
    const errText = await res.text()
    await writeAudit({
      responseStatus: res.status,
      responsePayload: { body: errText },
      status: 'failed',
      errorMessage: `Qwen API error ${res.status}: ${errText.slice(0, 500)}`,
    })
    logger.error({ ...logCtx, status: res.status, bodyPreview: errText.slice(0, 500) }, '[storyboard-job] Qwen HTTP 错误')
    throw new Error(`Qwen API error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const responseData = await res.json() as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
  await writeAudit({
    responseStatus: res.status,
    responsePayload: responseData,
    status: 'success',
  })
  const raw = responseData.choices?.[0]?.message?.content ?? ''

  logger.info(
    {
      ...logCtx,
      elapsedMs: Date.now() - startedAt,
      choiceCount: responseData.choices?.length ?? 0,
      rawLength: raw.length,
      rawPreview: raw.slice(0, 200),
    },
    '[storyboard-job] Qwen 响应解析完成',
  )

  // 剥离 <think>...</think> 思考标签，提取 JSON 数组
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    if (!auditWritten) await writeAudit({ responseStatus: res.status, responsePayload: responseData, status: 'failed', errorMessage: 'AI返回格式错误：未找到 JSON 数组' })
    logger.error({ ...logCtx, cleanedLength: cleaned.length, cleanedPreview: cleaned.slice(0, 500) }, '[storyboard-job] Qwen JSON 数组提取失败')
    throw new Error('AI返回格式错误：未找到 JSON 数组')
  }

  const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
  logger.info({ ...logCtx, shotCount: parsed.length, elapsedMs: Date.now() - startedAt }, '[storyboard-job] Qwen 分镜 JSON 解析成功')

  return parsed.map((s, i): ShotItem => ({
    shotNumber: (s.shotNumber as number) ?? i + 1,
    duration: (s.duration as number) ?? 4,
    sceneDescription: (s.sceneDescription as string) ?? '',
    character1: (s.character1 as string) ?? '',
    characterDesc1: (s.characterDesc1 as string) ?? '',
    character2: (s.character2 as string) ?? '',
    characterDesc2: (s.characterDesc2 as string) ?? '',
    reference: (s.reference as string) ?? '',
    shotType: (s.shotType as string) ?? '',
    characterAction: (s.characterAction as string) ?? '',
    emotion: (s.emotion as string) ?? '',
    sceneTags: Array.isArray(s.sceneTags) ? (s.sceneTags as string[]) : [],
    lightAtmosphere: (s.lightAtmosphere as string) ?? '',
    soundEffect: (s.soundEffect as string) ?? '',
    dialogue: (s.dialogue as string) ?? '无',
    compositionPrompt: (s.compositionPrompt as string) ?? '',
    cameraMotionPrompt: (s.cameraMotionPrompt as string) ?? '',
  }))
}

export const storyboardWorker = new Worker<StoryboardJobData>(
  'storyboard-queue',
  async (job) => {
    const data = job.data
    const logCtx = { jobId: job.id, taskId: data.taskId, batchId: data.batchId }
    const db = getDb()

    logger.info(logCtx, '[storyboard-job] 开始处理')

    // 更新 task 为 processing
    await db
      .updateTable('tasks')
      .set({ status: 'processing', processing_started_at: new Date().toISOString(), queue_job_id: job.id ?? null })
      .where('id', '=', data.taskId)
      .execute()

    // 标记 batch 进入 processing，避免前端一直停在 pending
    await db
      .updateTable('task_batches')
      .set({ status: 'processing' })
      .where('id', '=', data.batchId)
      .where('status', '=', 'pending')
      .execute()

    try {
      const shots = await callQwen(data, logCtx)
      logger.info({ ...logCtx, shotCount: shots.length }, '[storyboard-job] AI 返回成功')

      const paramsSnapshot = JSON.stringify({ shots })

      await db.transaction().execute(async (trx: any) => {
        // 更新 task 为 completed
        await trx
          .updateTable('tasks')
          .set({ status: 'completed', completed_at: new Date().toISOString() })
          .where('id', '=', data.taskId)
          .where('status', '!=', 'completed')
          .execute()

        // 更新 task_batches 为 completed
        await trx
          .updateTable('task_batches')
          .set({ status: 'completed', completed_count: 1 })
          .where('id', '=', data.batchId)
          .execute()

        // 写 canvas_node_outputs（deselect 旧的，insert 新的）
        await trx
          .updateTable('canvas_node_outputs')
          .set({ is_selected: false })
          .where('canvas_id', '=', data.canvasId)
          .where('node_id', '=', data.canvasNodeId)
          .execute()

        await trx
          .insertInto('canvas_node_outputs')
          .values({
            canvas_id: data.canvasId,
            node_id: data.canvasNodeId,
            batch_id: data.batchId,
            output_urls: sql`ARRAY[]::text[]`,
            params_snapshot: sql`${paramsSnapshot}::jsonb`,
            is_selected: true,
          })
          .execute()
      })

      // 递增 Redis dirty 版本号，触发前端轮询感知变化
      const redis = getPubRedis()
      const dirtyKey = `canvas:dirty:${data.canvasId}`
      await redis.incr(dirtyKey)
      await redis.expire(dirtyKey, 60 * 60 * 24)

      // 发布 SSE 事件
      await redis.publish(`sse:batch:${data.batchId}`, JSON.stringify({ event: 'batch_update' }))

      logger.info(logCtx, '[storyboard-job] 完成，dirty key 已递增')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ ...logCtx, err: msg }, '[storyboard-job] 失败')

      await db.transaction().execute(async (trx: any) => {
        await trx
          .updateTable('tasks')
          .set({ status: 'failed', error_message: msg.slice(0, 500) })
          .where('id', '=', data.taskId)
          .execute()

        await trx
          .updateTable('task_batches')
          .set({ status: 'failed', failed_count: 1 })
          .where('id', '=', data.batchId)
          .execute()
      })

      // 失败也递增 dirty key，让前端轮询感知到状态变化
      const redis = getPubRedis()
      const dirtyKey = `canvas:dirty:${data.canvasId}`
      await redis.incr(dirtyKey)
      await redis.expire(dirtyKey, 60 * 60 * 24)

      throw err
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 3,
    lockDuration: 300_000, // 5 分钟，覆盖 Qwen thinking 模式的最长响应时间
  },
)

storyboardWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Storyboard worker error')
})
