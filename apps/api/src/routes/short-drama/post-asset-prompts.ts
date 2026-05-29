import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { ShortDramaAssetKind } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForText,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每次文本生成预冻结 15 积分
const ESTIMATED_CREDITS = 15

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/assets/prompts', async (request, reply) => {
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

    // 检查剧本摘要和分集梗概是否已生成
    if (!state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成剧本摘要' },
      })
    }

    if (state.script.outlines.length === 0) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成分集梗概' },
      })
    }

    // 检查是否已有素材
    if (state.assets.items.length > 0) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '素材提示词已生成' },
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

    // 调用 AI 生成素材提示词（包含 materials）
    const REDACTED = `你是专业短剧制作助手。请根据剧本摘要和分集梗概，提取所需的全局素材（角色、场景、道具、材质）。只输出 JSON 对象，包含 characters、scenes、props、materials 四个数组，每个元素包含 name 和 description 字段，不要输出 markdown。`

    const outlinesText = state.script.outlines
      .map((o) => `第${o.episodeNumber}集：${o.title}\n${o.summary}`)
      .join('\n\n')

    const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n分集梗概：\n${outlinesText}\n\n请提取全局素材，包含：\n- characters: 主要角色列表（name, description）\n- scenes: 主要场景列表（name, description）\n- props: 重要道具列表（name, description）\n- materials: 材质/纹理列表（name, description，如木质、金属、布料等）`

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

    // 解析 AI 返回的 JSON（要求包含 materials）
    let parsed: Record<string, unknown>
    try {
      parsed = parseAndValidateJson(aiResponse, ['characters', 'scenes', 'props', 'materials'])
    } catch (error) {
      // JSON 解析失败，退还积分
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      app.log.error({ error, projectId }, 'AI 返回格式错误')
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: 'AI 返回格式错误，请重试' },
      })
    }

    // 校验字段类型
    if (
      !Array.isArray(parsed.characters) ||
      !Array.isArray(parsed.scenes) ||
      !Array.isArray(parsed.props) ||
      !Array.isArray(parsed.materials)
    ) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, "失败")
      return reply.status(502).send({
        error: { code: 'VALIDATION_ERROR', message: 'AI 返回的素材格式错误' },
      })
    }

    // 处理素材并去重
    const now = new Date().toISOString()
    const assetMap = new Map<string, { kind: ShortDramaAssetKind; name: string; description: string }>()

    // 处理角色
    for (const char of parsed.characters as Array<Record<string, unknown>>) {
      if (typeof char.name === 'string' && typeof char.description === 'string') {
        const normalizedName = char.name.trim().toLowerCase()
        if (!assetMap.has(normalizedName)) {
          assetMap.set(normalizedName, {
            kind: 'character',
            name: char.name.trim(),
            description: char.description.trim(),
          })
        }
      }
    }

    // 处理场景
    for (const scene of parsed.scenes as Array<Record<string, unknown>>) {
      if (typeof scene.name === 'string' && typeof scene.description === 'string') {
        const normalizedName = scene.name.trim().toLowerCase()
        if (!assetMap.has(normalizedName)) {
          assetMap.set(normalizedName, {
            kind: 'scene',
            name: scene.name.trim(),
            description: scene.description.trim(),
          })
        }
      }
    }

    // 处理道具
    for (const prop of parsed.props as Array<Record<string, unknown>>) {
      if (typeof prop.name === 'string' && typeof prop.description === 'string') {
        const normalizedName = prop.name.trim().toLowerCase()
        if (!assetMap.has(normalizedName)) {
          assetMap.set(normalizedName, {
            kind: 'prop',
            name: prop.name.trim(),
            description: prop.description.trim(),
          })
        }
      }
    }

    // 处理材质（映射为 prop，因为当前类型没有 material kind）
    for (const material of parsed.materials as Array<Record<string, unknown>>) {
      if (typeof material.name === 'string' && typeof material.description === 'string') {
        const normalizedName = material.name.trim().toLowerCase()
        if (!assetMap.has(normalizedName)) {
          assetMap.set(normalizedName, {
            kind: 'prop', // 映射为 prop
            name: material.name.trim(),
            description: material.description.trim(),
          })
        }
      }
    }

    // 生成素材列表
    state.assets.items = Array.from(assetMap.values()).map((asset) => ({
      id: randomUUID(),
      kind: asset.kind,
      scope: 'global' as const,
      name: asset.name,
      description: asset.description,
      imageUrl: null,
      referenceImageUrl: null,
      episodeNumber: null,
      status: 'idle' as const,
      createdAt: now,
      updatedAt: now,
    }))

    state.assets.status = 'completed'
    state.steps.completed = ['script', 'assets']
    state.steps.active = 'episodes'

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
      assets: state.assets.items,
      credits: settledCredits,
      state,
    }
  })
}

export default route
