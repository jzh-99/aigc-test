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
        const systemPrompt = [
          '你是专业短剧美术设定师，负责为图片生成模型提取角色定妆照和场景概念图提示词。',
          '只输出 JSON 对象，包含 characters、scenes 两个数组，每个元素包含 name 和 description 字段，不要输出 markdown。',
          '角色形象必须优先基于剧本摘要中“人物小传”的视觉形象、核心标签、身份背景生成；如果人物小传中已有同名角色，不要只根据当前分集剧情临时改写外貌。',
          '分集内容只用于补充该阶段的年龄、服装时代感和出场状态，不得覆盖人物小传中稳定的人物气质和核心视觉特征。',
          '角色 description 必须是可直接生成全身正面人物定妆照的外观描述：年龄段、性别、脸型五官、发型、气质、完整服装、身体比例、时代感。禁止写履历、剧情、关系、命运、职业经历、前世今生、组织调查、情节动作。',
          '角色 description 必须默认单人、全身、正面、从头到脚完整入镜、白色纯净背景、不带装饰物和道具。',
          '场景 description 必须是可直接生成空镜场景图的空间描述：地点类型、建筑/室内结构、陈设、光线、年代氛围、色彩。禁止出现人物、人脸、背影、人群、剧情动作、关系图、文字标注。',
          '不要输出道具清单、材质清单或音乐。',
        ].join('\n')
        const userPrompt = `剧本摘要（包含人物小传时必须优先参考）：\n${state.script.refinedPrompt}\n\n已有角色：\n${existingCharacters}\n\n已有场景：\n${existingScenes}\n\n当前批次分集剧本：\n${batchOutlines}\n\n请只提取第 ${batch.from}-${batch.to} 集中新增且需要制作参考图的角色和场景。已存在的角色或场景不要重复返回。\n\n角色生成原则：\n- 如果角色在“人物小传”中出现，characters[].description 必须基于该角色小传的“视觉形象、核心标签、身份背景、性格特点”提炼。\n- 分集剧本只补充当前年龄阶段、服装年代、校园/职场状态，不要把剧情动作、情绪事件、人物关系写进生图提示词。\n- 角色描述要形成稳定可复用的角色定妆照，而不是某一场戏的截图。\n\n输出要求：\n- characters[].description 只写视觉外观，必须包含“全身正面定妆照”或等价表述，不写人物经历、剧情关系或命运设定。\n- scenes[].description 只写无人空镜场景，不出现任何人物。\n- 每条 description 控制在 45-90 个汉字，适合直接作为图片生成提示词。\n\n返回 JSON：\n{\n  "characters": [{ "name": "角色名", "description": "约20岁男性，身形挺拔锋利，端正脸型，短黑发，眼神清醒克制，简洁校服或白衬衫，带寒门精英气质，全身正面定妆照，从头到脚完整入镜，白色纯净背景，无道具" }],\n  "scenes": [{ "name": "场景名", "description": "90年代政法大学教学楼外景，灰白教学楼与林荫道路，日间自然光，安静校园氛围，无人物" }]\n}`

        try {
          const aiResponse = await callDoubaoForTextStream(systemPrompt, userPrompt, ASSET_PROMPT_BATCH_MAX_TOKENS, {
            onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
            onPing: sendPing,
            audit: {
              userId,
              teamId,
              workspaceId: project.workspace_id,
              module: 'short_drama',
              provider: 'doubao',
              operation: 'assets.prompts',
              endpoint: '/chat/completions',
            },
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
