import type { FastifyPluginAsync } from 'fastify'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForText,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每次文本生成预冻结 10 积分
const ESTIMATED_CREDITS = 10

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/summary', async (request, reply) => {
    const { id: projectId } = request.params

    // 校验项目访问权限
    let projectData
    try {
      projectData = await assertShortDramaProjectAccess(projectId, request.user.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权访问该项目'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message },
      })
    }

    const { project } = projectData
    const state = project.state
    const teamId = project.team_id
    const userId = request.user.id

    // 检查是否已有 refinedPrompt（兼容当前类型结构）
    if (state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '剧本摘要已生成' },
      })
    }

    // 检查是否有原始创意
    if (!state.script.originalPrompt?.trim()) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '缺少原始创意' },
      })
    }

    // 预冻结积分
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS)
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      const message = error instanceof Error ? error.message : '积分冻结失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    // 调用 AI 生成剧本摘要
    const REDACTED =
      '你是专业短剧编剧。请根据用户创意生成适合连续短剧制作的中文剧本摘要。只输出 JSON 对象，字段为 title 和 summary，不要输出 markdown。'

    const userPrompt = `用户创意：${state.script.originalPrompt}\n\n请生成剧本摘要，包含 title（剧名）和 summary（剧情概要，200-500字）。`

    let aiResponse: string
    try {
      aiResponse = await callDoubaoForText(REDACTED, userPrompt)
    } catch (error) {
      // AI 调用失败，退还积分
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      app.log.error({ error, projectId }, 'AI 调用失败')
      return reply.status(502).send({
        error: { code: 'AI_ERROR', message: 'AI 生成失败，请稍后重试' },
      })
    }

    // 解析 AI 返回的 JSON
    let parsed: Record<string, unknown>
    try {
      parsed = parseAndValidateJson(aiResponse, ['title', 'summary'])
    } catch (error) {
      // JSON 解析失败，退还积分
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      app.log.error({ error, projectId }, 'AI 返回格式错误')
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: 'AI 返回格式错误，请重试' },
      })
    }

    // 校验字段类型
    if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: 'AI 返回的 title 或 summary 格式错误' },
      })
    }

    // 计算实际积分消耗
    const actualCredits = calculateTextGenerationCredits(aiResponse)

    // 原子化保存状态并结算积分
    let settledCredits: number
    try {
      settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: 'summary_ready',
        title: parsed.title as string,
      })).settledCredits
    } catch (error) {
      // 状态保存/结算失败，安全退还全额积分
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '状态保存/结算失败')
      app.log.error({ error, projectId }, '短剧文本生成状态保存/结算失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存失败，积分已退还' },
      })
    }

    return {
      title: parsed.title,
      summary: parsed.summary,
      credits: settledCredits,
      state,
    }
  })
}

export default route
