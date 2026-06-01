import type { FastifyPluginAsync } from 'fastify'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  applyShortDramaScriptSummaryResult,
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

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.hijack()
    reply.raw.write(': connected\n\n')

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const sendPing = (): void => {
      reply.raw.write(': ping\n\n')
    }

    try {
      sendEvent('progress', { message: '正在生成剧本摘要' })

      const aiResponse = await callDoubaoForTextStream(REDACTED, userPrompt, 4000, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
      })

      const parsed = parseAndValidateJson(aiResponse, ['title', 'summary'])
      if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
        throw new Error('AI 返回的 title 或 summary 格式错误')
      }

      const actualCredits = calculateTextGenerationCredits(aiResponse)
      applyShortDramaScriptSummaryResult(state, {
        title: parsed.title,
        summary: parsed.summary,
      })

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: 'summary_ready',
        title: parsed.title,
      })).settledCredits

      sendEvent('done', {
        success: true,
        title: parsed.title,
        summary: parsed.summary,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '摘要生成失败')
      app.log.error({ error, projectId }, '短剧摘要流式生成失败')
      sendEvent('error', {
        code: 'AI_ERROR',
        message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
      })
    } finally {
      reply.raw.end()
    }
  })
}

export default route
