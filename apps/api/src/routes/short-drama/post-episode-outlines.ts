import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaEpisodeOutline } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  applyShortDramaEpisodeOutlinesBatchResult,
  buildShortDramaOutlineBatches,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每次文本生成预冻结 20 积分（分集梗概通常比摘要长）
const ESTIMATED_CREDITS = 20
const OUTLINE_BATCH_MAX_TOKENS = 8000

function parseEpisodeOutlineBatch(
  aiResponse: string,
  from: number,
  to: number
): ShortDramaEpisodeOutline[] {
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('未找到有效的 JSON')
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown
  let episodes: unknown

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const maybeEpisodes = (parsed as { episodes?: unknown }).episodes
    if (Array.isArray(maybeEpisodes)) {
      episodes = maybeEpisodes
    } else {
      throw new Error('未找到 episodes 数组')
    }
  } else if (Array.isArray(parsed)) {
    episodes = parsed
  } else {
    throw new Error('未找到有效的数组')
  }

  const expectedCount = to - from + 1
  if (!Array.isArray(episodes) || episodes.length !== expectedCount) {
    throw new Error(`AI 返回的分集数量不正确，期望第 ${from}-${to} 集共 ${expectedCount} 集`)
  }

  return episodes.map((item, index) => {
    const ep = item as Record<string, unknown>
    if (
      typeof ep.episodeNumber !== 'number' ||
      typeof ep.title !== 'string' ||
      typeof ep.logline !== 'string' ||
      typeof ep.synopsis !== 'string' ||
      !Array.isArray(ep.characters) ||
      !Array.isArray(ep.scenes) ||
      typeof ep.hook !== 'string'
    ) {
      throw new Error(`第 ${from + index} 集的字段格式错误或缺少必需字段`)
    }

    return {
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      summary: ep.synopsis,
    }
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/episode-outlines', async (request, reply) => {
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

    // 检查剧本摘要是否已生成
    if (!state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成剧本摘要' },
      })
    }

    if (state.script.outlines.length >= state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集梗概已生成' },
      })
    }

    const episodeCount = state.settings.episodeCount

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

    const startEpisode = state.script.outlines.length + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
    let completedCount = state.script.outlines.length
    let totalCredits = 0
    let stoppedByBalance = false
    let warningMessage: string | null = null

    try {
      for (const batch of batches) {
        let creditAccountId: string

        try {
          const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS)
          creditAccountId = freezeResult.creditAccountId
        } catch (error) {
          stoppedByBalance = true
          warningMessage = 'A豆余额不足，已停止生成后续大纲。已保存已完成的分集大纲，请充值后点击「继续生成大纲」生成剩余集数。'
          sendEvent('warning', {
            message: warningMessage,
            completedCount,
            totalCount: episodeCount,
            remainingCount: episodeCount - completedCount,
          })
          break
        }

        sendEvent('progress', {
          message: `开始生成第 ${batch.from}-${batch.to} 集大纲`,
          from: batch.from,
          to: batch.to,
          completedCount,
          totalCount: episodeCount,
        })

        const systemPrompt = `你是专业短剧编剧。请根据剧本摘要生成第 ${batch.from}-${batch.to} 集的分集梗概。只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown。`
        const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数（${batch.from}-${batch.to}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 详细剧情梗概（100-200字）\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）`

        try {
          const aiResponse = await callDoubaoForTextStream(systemPrompt, userPrompt, OUTLINE_BATCH_MAX_TOKENS, {
            onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
            onPing: sendPing,
          })

          const previousState = JSON.parse(JSON.stringify(state)) as typeof state
          const outlines = parseEpisodeOutlineBatch(aiResponse, batch.from, batch.to)
          const actualCredits = calculateTextGenerationCredits(aiResponse)
          applyShortDramaEpisodeOutlinesBatchResult(state, outlines)

          try {
            const settledCredits = (await saveShortDramaStateAndSettleCredits({
              projectId,
              state,
              actualCredits,
              estimatedCredits: ESTIMATED_CREDITS,
              creditAccountId,
              userId,
              teamId,
              status: state.script.status === 'completed' ? 'outline_ready' : 'generating',
            })).settledCredits

            totalCredits += settledCredits
          } catch (error) {
            Object.assign(state, previousState)
            throw error
          }
          completedCount = state.script.outlines.length

          sendEvent('progress', {
            message: `第 ${batch.from}-${batch.to} 集大纲生成完成`,
            from: batch.from,
            to: batch.to,
            completedCount,
            totalCount: episodeCount,
          })
        } catch (error) {
          await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集大纲生成失败`)
          app.log.error({ error, projectId, batch }, '短剧分集大纲批次生成失败')

          sendEvent('error', {
            code: 'AI_ERROR',
            message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
            completedCount,
            totalCount: episodeCount,
          })
          return
        }
      }

      const partial = stoppedByBalance || state.script.outlines.length < episodeCount
      if (partial && warningMessage) {
        sendEvent('done', {
          success: true,
          partial: true,
          warning: warningMessage,
          completedCount,
          totalCount: episodeCount,
          remainingCount: episodeCount - completedCount,
          credits: totalCredits,
          state,
        })
      } else {
        sendEvent('done', {
          success: true,
          partial: false,
          outlines: state.script.outlines,
          credits: totalCredits,
          state,
        })
      }
    } finally {
      reply.raw.end()
    }
  })
}

export default route
