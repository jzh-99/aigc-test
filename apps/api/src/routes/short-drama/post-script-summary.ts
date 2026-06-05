import type { FastifyPluginAsync } from 'fastify'
import { assertShortDramaProjectAccess, validateShortDramaEpisodeCount } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  applyShortDramaScriptSummaryResult,
  saveShortDramaProjectState,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { buildShortDramaScriptSummaryPrompts, getShortDramaSummarySourceText } from './_script-source.js'

// 保守预估：结构化剧集设定内容较长，预冻结 25 积分
const ESTIMATED_CREDITS = 25

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

    let sourceText: ReturnType<typeof getShortDramaSummarySourceText>
    try {
      sourceText = getShortDramaSummarySourceText(state)
    } catch (error) {
      const message = error instanceof Error ? error.message : '缺少剧本来源'
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:script-summary`)
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '剧本摘要正在生成中，请稍后刷新查看进度' },
      })
    }

    // 预冻结积分
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS)
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '积分冻结失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    try {
      state.script.status = 'generating'
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '摘要生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId }, '短剧摘要生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    // 调用 AI 生成结构化剧集设定
    const { systemPrompt, userPrompt } = buildShortDramaScriptSummaryPrompts(state)

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
      sendEvent('progress', { message: sourceText.label === '原始剧本' ? '正在提炼剧本摘要' : '正在生成剧本摘要' })

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, 8000, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.summary',
          endpoint: '/chat/completions',
        },
      })

      const parsed = parseAndValidateJson(aiResponse, ['title', 'summary'])
      if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
        throw new Error('AI 返回的 title 或 summary 格式错误')
      }
      let episodeCount: number | undefined
      if (state.script.source === 'upload') {
        if (typeof parsed.episodeCount !== 'number') {
          throw new Error('AI 返回的 episodeCount 格式错误')
        }
        episodeCount = validateShortDramaEpisodeCount(parsed.episodeCount, 'upload')
      }

      const actualCredits = calculateTextGenerationCredits(aiResponse)
      applyShortDramaScriptSummaryResult(state, {
        title: parsed.title,
        summary: parsed.summary,
        episodeCount,
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
        episodeCount,
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
      state.script.status = 'failed'
      await saveShortDramaProjectState(projectId, state, 0).catch((saveError) => {
        app.log.error({ saveError, projectId }, '短剧摘要失败状态保存失败')
      })
      app.log.error({ error, projectId }, '短剧摘要流式生成失败')
      sendEvent('error', {
        code: 'AI_ERROR',
        message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
      })
    } finally {
      await releaseRedisLock(app.redis, generationLock)
      reply.raw.end()
    }
  })
}

export default route
