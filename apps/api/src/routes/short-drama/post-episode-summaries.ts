import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaEpisodeSummary } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  applyShortDramaEpisodeSummariesResult,
  saveShortDramaProjectState,
  markShortDramaProjectFailed,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { buildShortDramaEpisodeSummariesPrompts } from './_script-source.js'
import { createShortDramaSSESession } from './_sse.js'
import {
  createShortDramaTextTaskBatch,
  heartbeatShortDramaTextTask,
  completeShortDramaTextTask,
  failShortDramaTextTask,
  TEXT_TASK_HEARTBEAT_INTERVAL_MS,
} from './_text-task.js'

// 概述生成预冻结积分：按全量 N 集估算，每集约 0.5 A豆（100 字概述），保守取 40
const ESTIMATED_CREDITS = 40
// 概述输出 maxTokens：按最大 100 集 × 100 字 + JSON 结构估算
const EPISODE_SUMMARIES_MAX_TOKENS = 8000

function parseEpisodeSummaries(
  aiResponse: string,
  episodeCount: number
): ShortDramaEpisodeSummary[] {
  // 概述 prompt 约定返回 JSON 数组；parseAndValidateJson 仅支持对象（对数组输入会抛错），
  // 这里对齐 parseEpisodeOutlineBatch 的解析方式，同时兼容纯数组与 {episodes|summaries:[...]} 包裹
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('AI 返回的概述不是有效的 JSON，请重试')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('AI 返回的概述不是有效的 JSON，请重试')
  }

  let summaries: unknown
  if (Array.isArray(parsed)) {
    summaries = parsed
  } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).episodes)) {
    summaries = (parsed as Record<string, unknown>).episodes
  } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).summaries)) {
    summaries = (parsed as Record<string, unknown>).summaries
  } else {
    throw new Error('AI 返回的 JSON 中未找到有效的概述数组')
  }

  if (!Array.isArray(summaries) || summaries.length !== episodeCount) {
    throw new Error(`AI 返回的概述数量不正确，期望 ${episodeCount} 集，实际 ${Array.isArray(summaries) ? summaries.length : 0} 集`)
  }

  const result = summaries.map((item, index) => {
    const ep = item as Record<string, unknown>
    if (
      typeof ep.episodeNumber !== 'number' ||
      typeof ep.summary !== 'string'
    ) {
      throw new Error(`第 ${index + 1} 集概述的字段格式错误或缺少必需字段`)
    }
    return {
      episodeNumber: ep.episodeNumber,
      summary: ep.summary.trim(),
    }
  })

  const episodeNumbers = new Set(result.map(summary => summary.episodeNumber))
  if (episodeNumbers.size !== episodeCount) {
    throw new Error('AI 返回的概述集号重复或缺失')
  }
  for (let episodeNumber = 1; episodeNumber <= episodeCount; episodeNumber += 1) {
    if (!episodeNumbers.has(episodeNumber)) {
      throw new Error(`AI 返回的概述缺少第 ${episodeNumber} 集`)
    }
  }

  return result
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/episode-summaries', async (request, reply) => {
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

    // 前置校验：剧本摘要必须已生成
    if (!state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成剧本摘要' },
      })
    }

    // 前置校验：避免与分集剧本生成并发覆盖同一份 state
    if (state.script.status === 'generating') {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '分集剧本正在生成中，请稍后再生成概述' },
      })
    }

    // 前置校验：已有剧本后概述隐式锁定，不允许重生成故事蓝图
    if (state.script.outlines.length > 0) {
      return reply.status(400).send({
        error: { code: 'ALREADY_LOCKED', message: '分集剧本已生成，分集概述已锁定' },
      })
    }

    // 前置校验：概述未重复生成
    if (state.script.episodeSummaries.length >= state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集概述已生成' },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-summaries`, { ttlSeconds: 480, autoRenew: false })
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '分集概述正在生成中，请稍后刷新查看进度' },
      })
    }

    // 预冻结积分
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS, '短剧分集概述冻结')
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '积分冻结失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    // 设置概述生成状态（不修改 script.status，避免与摘要/剧本流程互相覆盖）
    try {
      state.script.episodeSummaryStatus = 'generating'
      // 重新生成时清空历史失败原因
      state.script.episodeSummaryErrorMessage = null
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId }, '短剧概述生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    // 创建文本任务记录（僵死自愈的进程外状态来源）+ 心跳定时器
    let textTaskId: string | null = null
    try {
      textTaskId = await createShortDramaTextTaskBatch({
        projectId,
        textType: 'episode-summaries',
        userId,
        teamId,
        workspaceId: project.workspace_id,
        creditAccountId,
        estimatedCredits: ESTIMATED_CREDITS,
      })
    } catch (error) {
      app.log.warn({ error, projectId }, '分集概述文本任务记录创建失败，继续生成')
    }
    const heartbeatTimer = setInterval(() => {
      if (textTaskId) void heartbeatShortDramaTextTask(textTaskId).catch(() => {})
    }, TEXT_TASK_HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()

    const { systemPrompt, userPrompt } = buildShortDramaEpisodeSummariesPrompts(state)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.hijack()
    reply.raw.write(': connected\n\n')

    const session = createShortDramaSSESession(reply)
    const { sendEvent, sendPing, clientSignal } = session

    let persisted = false

    try {
      sendEvent('progress', { message: '正在生成分集概述' })

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, EPISODE_SUMMARIES_MAX_TOKENS, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
        externalSignal: clientSignal,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.episode_summaries',
          endpoint: '/chat/completions',
        },
      })

      const episodeCount = state.settings.episodeCount
      const summaries = parseEpisodeSummaries(aiResponse, episodeCount)
      const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
      applyShortDramaEpisodeSummariesResult(state, summaries)

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
      })).settledCredits

      persisted = true

      // 文本任务记录标记完成
      if (textTaskId) await completeShortDramaTextTask(textTaskId, actualCredits).catch(() => {})

      sendEvent('done', {
        success: true,
        episodeSummaries: summaries,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      if (persisted) {
        app.log.warn({ error, projectId }, '短剧概述已生成成功，但向客户端推送结果失败')
      } else {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成失败')
        state.script.episodeSummaryStatus = 'failed'
        // 持久化失败原因，前端重进页面仍可见
        state.script.episodeSummaryErrorMessage = error instanceof Error ? error.message : '概述生成失败'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ saveError, projectId }, '短剧概述失败状态保存失败')
        })
        if (textTaskId) await failShortDramaTextTask(textTaskId).catch(() => {})
        app.log.error({ error, projectId }, '短剧概述流式生成失败')
        sendEvent('error', {
          code: 'AI_ERROR',
          message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
        })
      }
    } finally {
      clearInterval(heartbeatTimer)
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
  })
}

export default route
