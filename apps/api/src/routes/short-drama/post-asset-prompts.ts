import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaAssetKind } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  buildShortDramaOutlineBatches,
  applyShortDramaAssetPromptsBatchResult,
  type ShortDramaAssetPromptInput,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每个素材描述批次预冻结 15 积分
const ESTIMATED_CREDITS = 15
const ASSET_PROMPT_BATCH_MAX_TOKENS = 5000

function parseAssetPromptBatch(aiResponse: string): ShortDramaAssetPromptInput[] {
  const parsed = parseAndValidateJson(aiResponse, ['characters', 'scenes'])

  if (!Array.isArray(parsed.characters) || !Array.isArray(parsed.scenes)) {
    throw new Error('AI 返回的角色或场景格式错误')
  }

  const assets: ShortDramaAssetPromptInput[] = []

  for (const character of parsed.characters as Array<Record<string, unknown>>) {
    if (typeof character.name === 'string' && typeof character.description === 'string') {
      assets.push({
        kind: 'character',
        name: character.name,
        description: character.description,
      })
    }
  }

  for (const scene of parsed.scenes as Array<Record<string, unknown>>) {
    if (typeof scene.name === 'string' && typeof scene.description === 'string') {
      assets.push({
        kind: 'scene',
        name: scene.name,
        description: scene.description,
      })
    }
  }

  return assets
}

function formatExistingAssets(
  assets: Array<{ kind: ShortDramaAssetKind; name: string }>,
  kind: 'character' | 'scene'
): string {
  const names = assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => asset.name)

  return names.length > 0 ? names.map((name) => `- ${name}`).join('\n') : '无'
}

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

    if (state.assets.processedOutlineCount >= state.script.outlines.length) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '素材描述已生成' },
      })
    }

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

    const totalOutlines = state.script.outlines.length
    const startEpisode = state.assets.processedOutlineCount + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, totalOutlines)
    let completedCount = state.assets.processedOutlineCount
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
          warningMessage = 'A豆余额不足，已停止生成后续素材描述。已保存已完成的角色和场景描述，请充值后点击「继续生成描述」生成剩余素材。'
          sendEvent('warning', {
            message: warningMessage,
            completedCount,
            totalCount: totalOutlines,
            remainingCount: totalOutlines - completedCount,
          })
          break
        }

        sendEvent('progress', {
          message: `开始提取第 ${batch.from}-${batch.to} 集角色和场景描述`,
          from: batch.from,
          to: batch.to,
          completedCount,
          totalCount: totalOutlines,
        })

        const batchOutlines = state.script.outlines
          .filter((outline) => outline.episodeNumber >= batch.from && outline.episodeNumber <= batch.to)
          .map((outline) => `第${outline.episodeNumber}集：${outline.title}\n${outline.summary}`)
          .join('\n\n')

        const existingCharacters = formatExistingAssets(state.assets.items, 'character')
        const existingScenes = formatExistingAssets(state.assets.items, 'scene')
        const systemPrompt = '你是专业短剧制作助手。请根据剧本摘要和当前批次分集梗概，提取需要制作参考图的新增全局角色和场景。只输出 JSON 对象，包含 characters、scenes 两个数组，每个元素包含 name 和 description 字段，不要输出 markdown。不要输出道具、材质或音乐。'
        const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n已有角色：\n${existingCharacters}\n\n已有场景：\n${existingScenes}\n\n当前批次分集梗概：\n${batchOutlines}\n\n请只提取第 ${batch.from}-${batch.to} 集中新增且需要制作参考图的角色和场景。已存在的角色或场景不要重复返回。返回 JSON：\n{\n  "characters": [{ "name": "角色名", "description": "角色外观、年龄、气质、服装等视觉描述" }],\n  "scenes": [{ "name": "场景名", "description": "场景空间、时代、光线、陈设等视觉描述" }]\n}`

        try {
          const aiResponse = await callDoubaoForTextStream(systemPrompt, userPrompt, ASSET_PROMPT_BATCH_MAX_TOKENS, {
            onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
            onPing: sendPing,
          })

          const previousState = JSON.parse(JSON.stringify(state)) as typeof state
          const assets = parseAssetPromptBatch(aiResponse)
          const actualCredits = calculateTextGenerationCredits(aiResponse)
          applyShortDramaAssetPromptsBatchResult(state, assets, batch.to)

          try {
            const settledCredits = (await saveShortDramaStateAndSettleCredits({
              projectId,
              state,
              actualCredits,
              estimatedCredits: ESTIMATED_CREDITS,
              creditAccountId,
              userId,
              teamId,
              status: state.assets.status === 'completed' ? 'assets_ready' : 'generating',
            })).settledCredits

            totalCredits += settledCredits
          } catch (error) {
            Object.assign(state, previousState)
            throw error
          }

          completedCount = state.assets.processedOutlineCount
          sendEvent('progress', {
            message: `第 ${batch.from}-${batch.to} 集角色和场景描述提取完成`,
            from: batch.from,
            to: batch.to,
            completedCount,
            totalCount: totalOutlines,
          })
        } catch (error) {
          await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集素材描述生成失败`)
          app.log.error({ error, projectId, batch }, '短剧素材描述批次生成失败')

          sendEvent('error', {
            code: 'AI_ERROR',
            message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
            completedCount,
            totalCount: totalOutlines,
          })
          return
        }
      }

      const partial = stoppedByBalance || state.assets.processedOutlineCount < totalOutlines
      sendEvent('done', {
        success: true,
        partial,
        warning: partial ? warningMessage ?? '素材描述已部分生成，请稍后继续生成' : undefined,
        assets: state.assets.items,
        credits: totalCredits,
        completedCount,
        totalCount: totalOutlines,
        remainingCount: totalOutlines - completedCount,
        state,
      })
    } finally {
      reply.raw.end()
    }
  })
}

export default route
