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

// 保守预估：每次文本生成预冻结 20 积分（分集梗概通常比摘要长）
const ESTIMATED_CREDITS = 20

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

    // 检查是否已有分集梗概
    if (state.script.outlines.length > 0) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集梗概已生成' },
      })
    }

    const episodeCount = state.settings.episodeCount

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

    // 调用 AI 生成分集梗概（要求完整字段）
    const REDACTED = `你是专业短剧编剧。请根据剧本摘要生成 ${episodeCount} 集的分集梗概。只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown。`

    const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n请生成 ${episodeCount} 集的分集梗概，每集包含：\n- episodeNumber: 集数（1-${episodeCount}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 详细剧情梗概（100-200字）\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）`

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

    // 解析 AI 返回的 JSON 数组
    let episodes: unknown
    try {
      // 先尝试提取 JSON 对象或数组
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('未找到有效的 JSON')
      }

      const parsed = JSON.parse(jsonMatch[0])

      // 尝试从对象中提取数组（可能返回 { episodes: [...] }）
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.episodes)) {
          episodes = parsed.episodes
        } else {
          throw new Error('未找到 episodes 数组')
        }
      } else if (Array.isArray(parsed)) {
        episodes = parsed
      } else {
        throw new Error('未找到有效的数组')
      }
    } catch (error) {
      // JSON 解析失败，退还积分
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      app.log.error({ error, projectId }, 'AI 返回格式错误')
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: 'AI 返回格式错误，请重试' },
      })
    }

    // 校验数组长度
    if (!Array.isArray(episodes) || episodes.length !== episodeCount) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      app.log.error({ episodesLength: Array.isArray(episodes) ? episodes.length : 'not-array', expectedCount: episodeCount }, '分集数量不匹配')
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: `AI 返回的分集数量不正确，期望 ${episodeCount} 集` },
      })
    }

    // 校验每集的完整字段（spec 要求）
    const outlines: Array<{ episodeNumber: number; title: string; summary: string }> = []
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i] as Record<string, unknown>

      // 校验必需字段
      if (
        typeof ep.episodeNumber !== 'number' ||
        typeof ep.title !== 'string' ||
        typeof ep.logline !== 'string' ||
        typeof ep.synopsis !== 'string' ||
        !Array.isArray(ep.characters) ||
        !Array.isArray(ep.scenes) ||
        typeof ep.hook !== 'string'
      ) {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
        return reply.status(502).send({
          error: { code: 'VALIDATION_ERROR', message: `第 ${i + 1} 集的字段格式错误或缺少必需字段` },
        })
      }

      // 兼容当前类型：使用 synopsis 作为 summary 存储
      outlines.push({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        summary: ep.synopsis as string,
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
        status: 'outline_ready',
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
      outlines,
      credits: settledCredits,
      state,
    }
  })
}

export default route
