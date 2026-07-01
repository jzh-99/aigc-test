import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import {
  normalizeShortDramaMentionAlias,
  stripShortDramaAssetStageSuffix,
  type ShortDramaAsset,
  type ShortDramaEpisodeOutline,
  type ShortDramaState,
} from '@aigc/types'
import { extractShortDramaJsonObject, calculateShortDramaTextCredits } from './_shared.js'
import {
  recordLlmProviderCall,
  summarizeLlmStreamChunk,
  type LlmProviderAuditContext,
  type LlmStreamSummary,
} from '../../lib/provider-api-audit.js'
// Qwen 配置走 getter 门面，支持 Nacos 热更（改 key/model 免重启）。详见 @aigc/nacos-config。
import { qwenConfig, systemConfig } from '@aigc/nacos-config'

// ============================================================================
// AI 调用配置
// ============================================================================

// 文本生成计费：每千字 1 A豆
export const TEXT_CREDITS_PER_THOUSAND_CHARS = 1
const TEXT_TIMEOUT_MS = 360_000 // 增加到 6 分钟，避免生成超时
// SSE 独立心跳间隔：必须远小于生产 nginx 的 proxy_read_timeout（默认 60s），
// 保证 Qwen reasoning 静默期（上游无数据）也能向客户端保活，避免中间代理判定空闲超时掐断连接
const SSE_HEARTBEAT_INTERVAL_MS = 15_000
// 客户端 SSE 断开后，AI 无产出的宽限时间：超过此阈值仍无任何 chunk，视为真卡死，中止上游请求。
// 设计权衡：Qwen reasoning 静默期通常 < 90s，设 120s 给足余量，避免误杀正常思考；
// 只要 AI 仍在产出（含正常 reasoning 间歇），即便客户端已断开也继续跑完并持久化，用户刷新即可见。
const CLIENT_DISCONNECT_STALL_MS = 120_000
const CLIENT_DISCONNECT_STALL_CHECK_INTERVAL_MS = 5_000
export const SHORT_DRAMA_OUTLINE_BATCH_SIZE = 5 // 减少批次大小到 5 集，降低单次生成压力

export interface ShortDramaTextStreamCallbacks {
  onChunk?: (text: string) => void
  onPing?: () => void
  audit?: LlmProviderAuditContext
  /**
   * 外部中止信号（通常是客户端 SSE 连接断开）。
   * 触发后会中止对 Qwen 的上游请求，避免客户端已离开后 AI 仍空跑到超时浪费 token。
   */
  externalSignal?: AbortSignal
}

export interface ShortDramaOutlineBatch {
  from: number
  to: number
}

export interface ShortDramaAssetPromptInput {
  kind: 'character' | 'scene' | 'requisite'
  name: string
  aliases?: string[]
  description: string
}

// ============================================================================
// AI 调用封装
// ============================================================================

/**
 * 调用 Qwen API 生成文本（OpenAI 兼容接口）
 * @param [systemPrompt] - 系统提示词
 * @param userPrompt - 用户提示词
 * @returns AI 返回的文本内容
 * @throws 如果 API 调用失败或返回错误
 */
export async function callQwenForText(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!qwenConfig.apiKey) {
    throw new Error('QWEN_API_KEY 未配置，无法调用 AI 生成')
  }

  const chatEndpoint = `${qwenConfig.apiUrl}/chat/completions`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${qwenConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: qwenConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        max_tokens: systemConfig.shortDramaMaxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`AI 调用失败 (HTTP ${response.status})`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  if (!data.choices?.[0]?.message?.content) {
    throw new Error('AI 返回格式异常')
  }

  return data.choices[0].message.content
}

export function extractQwenStreamDeltaText(line: string): string {
  if (!line.startsWith('data: ')) return ''

  const data = line.slice(6).trim()
  if (!data || data === '[DONE]') return ''

  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    return json.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}

export async function callQwenForTextStream(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  callbacks: ShortDramaTextStreamCallbacks = {},
  // 采样温度：默认 0.7；JSON 格式重试时可降到 0.3 以提升结构稳定性
  temperature: number = 0.7,
): Promise<string> {
  if (!qwenConfig.apiKey) {
    throw new Error('QWEN_API_KEY 未配置，无法调用 AI 生成')
  }

  const chatEndpoint = `${qwenConfig.apiUrl}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS)

  // 最近一次 AI 有效产出（chunk）的时间戳。
  // 用于「客户端断开后」判断 AI 是否仍在正常推进，避免代理误掐断就杀掉正在进行的生成。
  let lastProgressAt = Date.now()

  // 客户端 SSE 连接断开（externalSignal abort）后，不立即中止 AI 上游请求——
  // 因为 SSE 断开极可能是中间代理（nginx/SLB）空闲超时误判，用户仍在等待。
  // 改为「无进展宽限检测」：客户端断开后，仅当 AI 持续无任何 chunk 产出超过
  // CLIENT_DISCONNECT_STALL_MS（真卡死）才中止，避免空跑到 TEXT_TIMEOUT_MS 浪费 token；
  // AI 仍正常产出则继续跑完并持久化，用户刷新即可见结果。
  let stallChecker: ReturnType<typeof setInterval> | null = null
  const externalSignal = callbacks.externalSignal
  if (externalSignal) {
    const handleClientAbort = () => {
      stallChecker = setInterval(() => {
        if (Date.now() - lastProgressAt > CLIENT_DISCONNECT_STALL_MS) {
          controller.abort()
        }
      }, CLIENT_DISCONNECT_STALL_CHECK_INTERVAL_MS)
    }
    if (externalSignal.aborted) handleClientAbort()
    else externalSignal.addEventListener('abort', handleClientAbort, { once: true })
  }

  // 独立心跳：固定间隔触发，不依赖 AI 上游数据流。
  // 这样 reasoning 静默期也能向客户端保活，避免 nginx/SLB 空闲超时掐断连接。
  const heartbeat = callbacks.onPing
    ? setInterval(() => callbacks.onPing?.(), SSE_HEARTBEAT_INTERVAL_MS)
    : null

  const startedAt = Date.now()
  const requestPayload = {
    model: qwenConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: true,
    max_tokens: maxTokens,
    temperature,
  }
  const streamSummary: LlmStreamSummary = {
    stream: true,
    chunk_count: 0,
    response_bytes: 0,
    text_preview: '',
    finished: false,
  }
  let responseStatus: number | null = null
  let auditRecorded = false

  const recordAudit = async (input: {
    status: 'success' | 'failed'
    responsePayload?: unknown
    errorMessage?: string | null
  }): Promise<void> => {
    if (!callbacks.audit || auditRecorded) return
    auditRecorded = true
    await recordLlmProviderCall({
      ...callbacks.audit,
      model: callbacks.audit.model ?? qwenConfig.model,
      requestPayload,
      responseStatus,
      responsePayload: input.responsePayload,
      durationMs: Date.now() - startedAt,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
    })
  }

  try {
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${qwenConfig.apiKey}`,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    })
    responseStatus = response.status

    if (!response.ok) {
      const errorPayload = await response.text().catch(() => '')
      await recordAudit({
        status: 'failed',
        responsePayload: errorPayload ? { body: errorPayload } : null,
        errorMessage: `AI 调用失败 (HTTP ${response.status})`,
      })
      throw new Error(`AI 调用失败 (HTTP ${response.status})`)
    }

    if (!response.body) {
      throw new Error('AI 返回流为空')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const text = extractQwenStreamDeltaText(line.trim())
        if (!text) continue
        lastProgressAt = Date.now()
        fullText += text
        summarizeLlmStreamChunk(streamSummary, text)
        callbacks.onChunk?.(text)
      }
    }

    if (buffer.trim()) {
      const text = extractQwenStreamDeltaText(buffer.trim())
      if (text) {
        lastProgressAt = Date.now()
        fullText += text
        summarizeLlmStreamChunk(streamSummary, text)
        callbacks.onChunk?.(text)
      }
    }

    if (!fullText.trim()) {
      throw new Error('AI 返回内容为空')
    }

    streamSummary.finished = true
    await recordAudit({
      status: 'success',
      responsePayload: streamSummary,
      errorMessage: null,
    })
    return fullText
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordAudit({
      status: 'failed',
      responsePayload: streamSummary.chunk_count > 0 ? streamSummary : null,
      errorMessage: message,
    })
    throw error
  } finally {
    clearTimeout(timer)
    if (heartbeat) clearInterval(heartbeat)
    if (stallChecker) clearInterval(stallChecker)
  }
}

// ============================================================================
// 状态保存封装
// ============================================================================

/**
 * 保存项目状态到数据库
 * @param projectId - 项目 ID
 * @param state - 新的状态对象
 * @param actualCredits - 实际消耗的积分（累加）
 */
export async function saveShortDramaProjectState(
  projectId: string,
  state: ShortDramaState,
  actualCredits: number
): Promise<void> {
  const db = getDb()

  await db
    .updateTable('short_drama_projects')
    .set({
      state: JSON.stringify(state),
      actual_credits: sql`actual_credits + ${actualCredits}`,
      updated_at: sql`now()`,
    })
    .where('id', '=', projectId)
    .execute()
}

/**
 * 标记短剧项目为失败：同时更新项目表 `status=failed` 与 state JSON。
 *
 * 修复历史缺陷：原失败路径只调用 `saveShortDramaProjectState`（仅写 state JSON），
 * 不更新项目表 `status`；导致前端回查项目状态时永远拿不到 failed，
 * 兜底逻辑误判为成功、静默无提示。此函数确保项目表 status 与业务失败一致。
 *
 * @param projectId - 项目 ID
 * @param state - 已置为失败态的短剧状态（调用前自行设置 state.xxx.status = 'failed'）
 */
export async function markShortDramaProjectFailed(
  projectId: string,
  state: ShortDramaState
): Promise<void> {
  const db = getDb()
  await db
    .updateTable('short_drama_projects')
    .set({
      state: JSON.stringify(state),
      status: 'failed',
      updated_at: sql`now()`,
    })
    .where('id', '=', projectId)
    .execute()
}

// ============================================================================
// 文本计费封装
// ============================================================================

/**
 * 计算文本生成消耗的积分（输入 + 输出字符数）
 * @param inputText - 发送给 AI 的输入文本（system prompt + user prompt）
 * @param outputText - AI 输出的文本
 * @returns 消耗的积分数
 */
export function calculateTextGenerationCredits(inputText: string, outputText: string): number {
  const totalChars = inputText.length + outputText.length
  return calculateShortDramaTextCredits(totalChars, TEXT_CREDITS_PER_THOUSAND_CHARS)
}

export function estimateTextGenerationCredits(inputText: string, estimatedOutputChars: number): number {
  const totalChars = inputText.length + Math.max(0, estimatedOutputChars)
  return calculateShortDramaTextCredits(totalChars, TEXT_CREDITS_PER_THOUSAND_CHARS)
}

export function buildShortDramaOutlineBatches(
  startEpisode: number,
  totalEpisodeCount: number,
  batchSize = SHORT_DRAMA_OUTLINE_BATCH_SIZE
): ShortDramaOutlineBatch[] {
  const batches: ShortDramaOutlineBatch[] = []
  for (let from = startEpisode; from <= totalEpisodeCount; from += batchSize) {
    batches.push({
      from,
      to: Math.min(from + batchSize - 1, totalEpisodeCount),
    })
  }
  return batches
}

/**
 * 将摘要生成结果写回短剧状态，确保前端刷新后可直接展示 AI 摘要。
 * @param state - 当前短剧状态，会被原地更新后保存
 * @param result - AI 解析出的剧名和摘要
 */
export function applyShortDramaScriptSummaryResult(
  state: ShortDramaState,
  result: { title: string; summary: string; episodeCount?: number }
): void {
  if (result.episodeCount !== undefined) {
    state.settings.episodeCount = result.episodeCount
  }
  state.script.refinedPrompt = result.summary
  state.script.status = 'completed'
  // 成功后清空历史失败原因
  state.script.summaryErrorMessage = null
}

/**
 * 将分集概述生成结果写回短剧状态。
 * 概述是一次性全量生成，写回后直接标记 episodeSummaryStatus = 'completed'。
 * 注意：此函数不修改 script.status，后者属于摘要/剧本流程，避免互相覆盖。
 */
export function applyShortDramaEpisodeSummariesResult(
  state: ShortDramaState,
  summaries: Array<{ episodeNumber: number; summary: string }>
): void {
  state.script.episodeSummaries = summaries
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
  state.script.episodeSummaryStatus = 'completed'
  // 成功后清空历史失败原因
  state.script.episodeSummaryErrorMessage = null
}

export function applyShortDramaEpisodeOutlinesBatchResult(
  state: ShortDramaState,
  outlines: ShortDramaEpisodeOutline[]
): void {
  const now = new Date().toISOString()
  const outlineMap = new Map<number, ShortDramaEpisodeOutline>()

  for (const outline of state.script.outlines) {
    outlineMap.set(outline.episodeNumber, outline)
  }
  for (const outline of outlines) {
    outlineMap.set(outline.episodeNumber, outline)
  }

  const mergedOutlines = Array.from(outlineMap.values()).sort(
    (a, b) => a.episodeNumber - b.episodeNumber
  )

  state.script.outlines = mergedOutlines
  // 分集剧本批次请求独立状态：本批成功即 completed（区别于 script.status 的整体流程进度语义）
  state.script.outlinesStatus = 'completed'
  state.script.outlinesErrorMessage = null
  // 仅全量完成时同步 script.status（顶层整体进度语义，触发「下一步」可点）
  if (mergedOutlines.length >= state.settings.episodeCount) {
    state.script.status = 'completed'
  }
  state.episodes.items = mergedOutlines.map((outline) => {
    const existing = state.episodes.items.find(
      (episode) => episode.episodeNumber === outline.episodeNumber
    )

    return {
      episodeNumber: outline.episodeNumber,
      title: outline.title,
      summary: outline.summary,
      segments: existing?.segments ?? [],
      status: existing?.status ?? 'idle',
      segmentsStatus: existing?.segmentsStatus ?? 'idle',
      videoUrl: existing?.videoUrl ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  })
  state.episodes.status = 'idle'
}

/**
 * 将分集大纲写回短剧状态，并初始化分集编辑数据。
 * @param state - 当前短剧状态，会被原地更新后保存
 * @param outlines - AI 解析出的分集大纲
 */
export function applyShortDramaEpisodeOutlinesResult(
  state: ShortDramaState,
  outlines: ShortDramaEpisodeOutline[]
): void {
  applyShortDramaEpisodeOutlinesBatchResult(state, outlines)
}

function normalizeShortDramaAssetName(name: string): string {
  return name.trim().toLowerCase()
}

function getShortDramaAssetKey(asset: Pick<ShortDramaAsset, 'kind' | 'name'>): string {
  return `${asset.kind}:${normalizeShortDramaAssetName(asset.name)}`
}

function normalizeShortDramaAssetAliases(name: string, aliases: string[] | undefined): string[] {
  const rawAliases = [
    stripShortDramaAssetStageSuffix(name),
    ...(aliases ?? []),
    ...(aliases ?? []).map(alias => stripShortDramaAssetStageSuffix(alias)),
  ]

  const seen = new Set<string>([normalizeShortDramaMentionAlias(name)])
  const normalizedAliases: string[] = []
  for (const alias of rawAliases) {
    const trimmed = alias.trim()
    const key = normalizeShortDramaMentionAlias(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    normalizedAliases.push(trimmed)
  }

  return normalizedAliases
}

export function applyShortDramaAssetPromptsBatchResult(
  state: ShortDramaState,
  assets: ShortDramaAssetPromptInput[],
  processedOutlineCount: number
): void {
  const now = new Date().toISOString()
  const assetMap = new Map<string, ShortDramaAsset>()

  for (const asset of state.assets.items) {
    assetMap.set(getShortDramaAssetKey(asset), asset)
  }

  for (const asset of assets) {
    const name = asset.name.trim()
    const description = asset.description.trim()
    if (!name || !description) continue

    const key = `${asset.kind}:${normalizeShortDramaAssetName(name)}`
    const aliases = asset.kind === 'character'
      ? normalizeShortDramaAssetAliases(name, asset.aliases)
      : []
    const existingAsset = assetMap.get(key)
    if (existingAsset) {
      if (asset.kind === 'character') {
        existingAsset.aliases = normalizeShortDramaAssetAliases(existingAsset.name, [
          ...(existingAsset.aliases ?? []),
          ...aliases,
        ])
        existingAsset.updatedAt = now
      }
      continue
    }

    assetMap.set(key, {
      id: randomUUID(),
      kind: asset.kind,
      scope: 'global',
      name,
      aliases,
      description,
      imageUrl: null,
      referenceImageUrl: null,
      episodeNumber: null,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
  }

  state.assets.items = Array.from(assetMap.values())
  state.assets.processedOutlineCount = Math.max(
    state.assets.processedOutlineCount,
    processedOutlineCount
  )
  state.assets.status = state.assets.processedOutlineCount >= state.script.outlines.length
    ? 'completed'
    : 'generating'
}

// ============================================================================
// JSON 解析与校验
// ============================================================================

/**
 * 从 AI 返回的文本中提取并校验 JSON 对象
 * @param rawText - AI 返回的原始文本
 * @param requiredFields - 必需字段列表
 * @returns 解析后的 JSON 对象
 * @throws 如果 JSON 解析失败或缺少必需字段
 */
export function parseAndValidateJson(
  rawText: string,
  requiredFields: string[]
): Record<string, unknown> {
  const parsed = extractShortDramaJsonObject(rawText)

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new Error(`AI 返回的 JSON 缺少必需字段: ${field}`)
    }
  }

  return parsed
}


/**
 * 原子化保存项目状态（业管 A 豆已改为生成前扣减，本函数不再结算本地积分）。
 *
 * 迁移说明：原实现对齐 worker complete pipeline 的本地积分结算（解冻+扣余额+ledger）。
 * 业管化后 A 豆在生成前由 deductBizMgmtPointsForGeneration 实时扣减（扣减即终态），
 * 本函数只负责 short_drama_projects 状态/累计积分写入；estimatedCredits 参数仅用于
 * 项目累计展示的安全钳制，不再读写本地积分表。
 *
 * @returns 实际结算的积分数（安全钳制后，仍用于项目 actual_credits 累计展示）
 */
export async function saveShortDramaStateAndSettleCredits(input: {
  projectId: string
  state: ShortDramaState
  actualCredits: number
  estimatedCredits: number
  userId: string
  teamId: string
  status?: string
  title?: string
  episodeCount?: number
}): Promise<{ settledCredits: number }> {
  const {
    projectId,
    state,
    actualCredits: rawActualCredits,
    estimatedCredits,
    userId: _userId,
    teamId: _teamId,
    status,
    title,
    episodeCount,
  } = input

  // 安全处理：对齐原 worker complete pipeline 逻辑（仅用于项目累计展示，不写本地积分）
  let safeActualCredits = rawActualCredits
  if (safeActualCredits < 0) {
    safeActualCredits = 0
  }
  if (safeActualCredits > estimatedCredits * 3) {
    safeActualCredits = estimatedCredits
  }

  const db = getDb()

  await db.transaction().execute(async (trx) => {
    // 仅更新项目状态和累计积分（actual_credits 仅作展示，业管扣减权威在 biz_mgmt_a_bean_transactions）
    const projectUpdate: Record<string, unknown> = {
      state: JSON.stringify(state),
      actual_credits: sql`actual_credits + ${safeActualCredits}`,
      updated_at: sql`now()`,
    }

    if (status !== undefined) {
      projectUpdate.status = status
    }

    if (title !== undefined) {
      projectUpdate.title = title
    }

    if (episodeCount !== undefined) {
      projectUpdate.episode_count = episodeCount
    }

    await trx
      .updateTable('short_drama_projects')
      .set(projectUpdate)
      .where('id', '=', projectId)
      .execute()
  })

  return { settledCredits: safeActualCredits }
}

/**
 * 短剧文本生成失败时的退款回退（业管化后改为 no-op + 日志）。
 *
 * 迁移说明：业管 A 豆在生成前已扣减；本地不再退积分。失败退款应由调用方写
 * 创作结果 outbox(success=false) 由 biz-mgmt-notify-queue 通知业管处理。
 * 本函数保留签名兼容现有调用点，但不再触碰本地积分。
 */
export async function safeRefundCredits(
  app: { log: { warn: (obj: unknown, msg: string) => void } },
  teamId: string,
  userId: string,
  amount: number,
  projectId: string,
  context: string
): Promise<void> {
  app.log.warn(
    { projectId, teamId, userId, amount, context },
    `短剧文本生成失败（${context}）：业管 A 豆已预扣，退款由业管侧 outbox 流程处理，本地不退`,
  )
}
