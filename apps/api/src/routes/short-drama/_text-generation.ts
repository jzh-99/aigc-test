import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import type { ShortDramaState } from '@aigc/types'
import { extractShortDramaJsonObject, calculateShortDramaTextCredits } from './_shared.js'

// ============================================================================
// AI 调用配置
// ============================================================================

const DOUBAO_API_URL = process.env.DOUBAO_API_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY ?? ''
const DOUBAO_MODEL = process.env.DOUBAO_MODEL ?? 'doubao-seed-2.0-lite'

// 文本生成计费：每千字 1 积分
const TEXT_CREDITS_PER_THOUSAND_CHARS = 1

// ============================================================================
// AI 调用封装
// ============================================================================

/**
 * 调用豆包 API 生成文本（OpenAI 兼容接口）
 * @param [systemPrompt] - [systemPrompt]
 * @param userPrompt - 用户提示词
 * @returns AI 返回的文本内容
 * @throws 如果 API 调用失败或返回错误
 */
export async function callDoubaoForText(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!DOUBAO_API_KEY) {
    throw new Error('DOUBAO_API_KEY 未配置，无法调用 AI 生成')
  }

  const chatEndpoint = `${DOUBAO_API_URL}/chat/completions`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000) // 2 分钟超时

  let response: Response
  try {
    response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        max_tokens: 4000,
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

// ============================================================================
// 文本计费封装
// ============================================================================

/**
 * 计算文本生成消耗的积分
 * @param outputText - AI 输出的文本
 * @returns 消耗的积分数
 */
export function calculateTextGenerationCredits(outputText: string): number {
  const charCount = outputText.length
  return calculateShortDramaTextCredits(charCount, TEXT_CREDITS_PER_THOUSAND_CHARS)
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
 * 原子化保存项目状态并结算积分（状态保存 + 积分确认 + ledger 在同一事务中）
 *
 * 对齐 worker complete pipeline 的积分结算逻辑：
 * - 安全处理：actualCredits < 0 时设为 0，> estimatedCredits * 3 时设为 estimatedCredits
 * - 在同一事务中：保存状态、解冻并扣除积分、调整成员额度、插入 ledger
 *
 * @param input - 结算参数
 * @param input.projectId - 项目 ID
 * @param input.state - 新的状态对象
 * @param input.actualCredits - 实际消耗的积分
 * @param input.estimatedCredits - 预估冻结的积分
 * @param input.creditAccountId - 积分账户 ID
 * @param input.userId - 用户 ID
 * @param input.teamId - 团队 ID
 * @param input.status - 可选：项目状态
 * @param input.title - 可选：项目标题
 * @returns 实际结算的积分数
 * @throws 如果事务执行失败
 */
export async function saveShortDramaStateAndSettleCredits(input: {
  projectId: string
  state: ShortDramaState
  actualCredits: number
  estimatedCredits: number
  creditAccountId: string
  userId: string
  teamId: string
  status?: string
  title?: string
}): Promise<{ settledCredits: number }> {
  const {
    projectId,
    state,
    actualCredits: rawActualCredits,
    estimatedCredits,
    creditAccountId,
    userId,
    teamId,
    status,
    title,
  } = input

  // 安全处理：对齐 worker complete pipeline 逻辑
  let safeActualCredits = rawActualCredits
  if (safeActualCredits < 0) {
    safeActualCredits = 0
  }
  if (safeActualCredits > estimatedCredits * 3) {
    safeActualCredits = estimatedCredits
  }

  const db = getDb()

  await db.transaction().execute(async (trx) => {
    // 1. 更新项目状态和累计积分
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

    await trx
      .updateTable('short_drama_projects')
      .set(projectUpdate)
      .where('id', '=', projectId)
      .execute()

    // 2. 更新积分账户：解冻预估额度，扣除实际消耗
    await trx
      .updateTable('credit_accounts')
      .set({
        frozen_credits: sql`GREATEST(frozen_credits - ${estimatedCredits}, 0)`,
        balance: sql`balance - ${safeActualCredits}`,
        total_spent: sql`total_spent + ${safeActualCredits}`,
      })
      .where('id', '=', creditAccountId)
      .execute()

    // 3. 如果实际消耗与预估不同，调整成员已用额度
    if (safeActualCredits !== estimatedCredits) {
      const delta = safeActualCredits - estimatedCredits
      await trx
        .updateTable('team_members')
        .set({
          credit_used: sql`GREATEST(credit_used + ${delta}, 0)`,
        })
        .where('team_id', '=', teamId)
        .where('user_id', '=', userId)
        .execute()
    }

    // 4. 插入积分确认 ledger 记录
    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: -safeActualCredits,
        type: 'confirm',
        description: 'AI 短剧文本生成实际扣费',
      })
      .execute()

    // 5. 如果实际消耗小于预估，插入退还 ledger 记录（审计清晰）
    if (safeActualCredits < estimatedCredits) {
      const refundAmount = estimatedCredits - safeActualCredits
      await trx
        .insertInto('credits_ledger')
        .values({
          credit_account_id: creditAccountId,
          user_id: userId,
          amount: refundAmount,
          type: 'refund',
          description: 'AI 短剧文本生成预估差额退还',
        })
        .execute()
    }
  })

  return { settledCredits: safeActualCredits }
}

/**
 * 安全退还积分（包装 refundCredits，捕获异常并记录日志）
 *
 * @param app - Fastify 实例（用于日志记录）
 * @param teamId - 团队 ID
 * @param creditAccountId - 积分账户 ID
 * @param userId - 用户 ID
 * @param amount - 退还金额
 * @param projectId - 项目 ID（用于日志）
 * @param context - 上下文描述（用于日志）
 */
export async function safeRefundCredits(
  app: { log: { error: (obj: unknown, msg: string) => void } },
  teamId: string,
  creditAccountId: string,
  userId: string,
  amount: number,
  projectId: string,
  context: string
): Promise<void> {
  try {
    const { refundCredits } = await import('../../services/credit.js')
    await refundCredits(teamId, creditAccountId, userId, amount)
  } catch (refundError) {
    app.log.error(
      { refundError, projectId, creditAccountId, teamId, userId, amount, context },
      `短剧文本生成积分退还失败（${context}），需要人工处理`
    )
  }
}
