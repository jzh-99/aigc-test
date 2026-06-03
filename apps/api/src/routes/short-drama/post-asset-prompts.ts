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
      const aliases = Array.isArray(character.aliases)
        ? character.aliases
          .filter((alias): alias is string => typeof alias === 'string')
          .map(alias => alias.trim())
          .filter(Boolean)
        : []
      assets.push({
        kind: 'character',
        name: character.name,
        aliases,
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
  assets: Array<{ kind: ShortDramaAssetKind; name: string; aliases?: string[] }>,
  kind: 'character' | 'scene'
): string {
  const names = assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => {
      const aliases = (asset.aliases ?? []).filter(Boolean)
      return aliases.length > 0 ? `${asset.name}（别名：${aliases.join('、')}）` : asset.name
    })

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
          '你是短剧视觉制作专家，整合选角导演、造型师、摄影指导、美术指导的专业视角，为图片生成模型提取角色定妆照和场景概念图提示词。',
          '只输出 JSON 对象，包含 characters、scenes 两个数组；characters 元素包含 name、aliases、description 字段，scenes 元素包含 name、description 字段，不要输出 markdown。',
          '',
          '## 角色定妆照提取规范（选角导演 + 造型师 + 摄影指导视角）',
          '角色形象必须优先基于剧本摘要中”人物小传”的视觉形象、核心标签、身份背景生成；如果人物小传中已有同名角色，不要只根据当前分集剧情临时改写外貌。',
          '分集内容只用于补充该阶段的年龄、服装时代感和出场状态，不得覆盖人物小传中稳定的人物气质和核心视觉特征。',
          '',
          '### 选角导演视角（casting director）：',
          '- 明确年龄段（如：约25岁、30岁出头、40-45岁、花甲之年）',
          '- 性别、族裔特征（默认东亚汉族：黑发、黄皮肤、东亚脸型，除非剧本明确其他族裔）',
          '- 体型身材（如：纤瘦、结实匀称、魁梧壮硕、丰腴）',
          '- 面部特征（如：方正脸型、瓜子脸、棱角分明、五官柔和）',
          '- 气质标签（如：书卷气、凌厉干练、温婉内敛、草根质朴）',
          '',
          '### 造型师视角（stylist）：',
          '- 发型（如：齐肩直发、短寸头、中分长发、微卷短发）',
          '- 服装款式（如：白衬衫西裤、碎花连衣裙、工装制服、休闲卫衣）',
          '- 服装色系（如：黑白灰、暖色调、冷色调、素色系）',
          '- 年代特征（如：90年代校园风、2000年代职场装、民国长衫、当代简约风）',
          '- 妆容状态（如：淡妆、素颜、精致妆容）',
          '',
          '### 摄影指导视角（cinematographer）：',
          '- 构图：全身正面定妆照，从头到脚完整入镜',
          '- 背景：白色纯净背景或浅灰摄影棚背景',
          '- 光线：均匀柔和的摄影棚布光，无强烈阴影',
          '- 拍摄角度：平视，角色正对镜头',
          '- 景深：清晰对焦全身，背景虚化或纯色',
          '',
          '### 严格禁止项（道具师不参与角色定妆照）：',
          '禁止写履历、剧情、关系、命运、职业经历、前世今生、组织调查、情节动作。',
          '禁止出现手持道具（手机、包、书本、武器等），禁止佩戴装饰物（眼镜、帽子、首饰等，除非是角色核心标识）。',
          '',
          '## 场景概念图提取规范（美术指导 + 摄影指导视角）',
          '',
          '### 美术指导视角（production designer）：',
          '- 场景类型（如：教学楼外景、咖啡厅内景、街道夜景、办公室）',
          '- 空间结构（如：开阔广场、狭窄走廊、高挑大堂、紧凑格子间）',
          '- 陈设布置（如：实木家具、现代简约、陈旧桌椅、绿植装饰）',
          '- 年代还原（如：90年代国营单位、2010年代科技公司、民国茶馆）',
          '- 色彩基调（如：暖黄色调、冷灰蓝调、复古棕褐、明亮白色）',
          '',
          '### 摄影指导视角（cinematographer）：',
          '- 光线氛围（如：日间自然光、暖黄灯光、冷白荧光、傍晚逆光）',
          '- 空镜构图（如：横向全景、纵深透视、对称构图）',
          '- 天气时段（如：晴天正午、阴天、清晨薄雾、夜晚灯火）',
          '',
          '### 严格禁止项：',
          '场景 description 必须是无人空镜，禁止出现人物、人脸、背影、人群、剧情动作、关系图、文字标注、道具特写。',
        ].join('\n')
        const userPrompt = `剧本摘要（包含人物小传时必须优先参考）：\n${state.script.refinedPrompt}\n\n已有角色：\n${existingCharacters}\n\n已有场景：\n${existingScenes}\n\n当前批次分集剧本：\n${batchOutlines}\n\n请只提取第 ${batch.from}-${batch.to} 集中新增且需要制作参考图的角色和场景。已存在的角色或场景不要重复返回。\n\n## 角色生成原则：\n- 如果角色在”人物小传”中出现，characters[].description 必须基于该角色小传的”视觉形象、核心标签、身份背景、性格特点”提炼。\n- 分集剧本只补充当前年龄阶段、服装年代、校园/职场状态，不要把剧情动作、情绪事件、人物关系写进生图提示词。\n- 角色描述要形成稳定可复用的角色定妆照，而不是某一场戏的截图。\n\n## 输出要求：\n- characters[].aliases 必须列出 2-5 个常用称呼、简称、阶段省略名或身份称呼，不要包含 @，不要和 name 完全重复；例如 name 为“祁同伟（大学阶段）”时 aliases 可包含“祁同伟”“祁同伟大学时期”“祁同学”。\n- characters[].description 必须按【选角导演→造型师→摄影指导】顺序组织：先写人物基础特征（年龄/性别/族裔/体型/气质），再写造型（发型/服装/色系/年代感），最后写拍摄要求（全身正面定妆照/白色背景/无道具）。\n- scenes[].description 必须按【美术指导→摄影指导】顺序组织：先写场景类型和陈设（空间/结构/布置/年代/色调），再写光线氛围（光线/天气/构图），明确标注”无人空镜”。\n- 每条 description 控制在 60-100 个汉字，信息密度高，适合直接作为图片生成提示词。\n\n## 返回 JSON 示例：\n{\n  “characters”: [\n    {\n      “name”: “林北辰（大学时期）”,\n      “aliases”: [“林北辰”, “北辰”, “林同学”],\n      “description”: “约23岁东亚汉族男性，纤瘦挺拔身形，棱角分明脸型，短黑寸头，眼神清醒克制，书卷气中带寒门锋利感。90年代简洁校服白衬衫配深色长裤，素色系。全身正面定妆照，平视镜头，从头到脚完整入镜，白色摄影棚背景，均匀柔光，无道具无配饰。”\n    }\n  ],\n  “scenes”: [\n    {\n      “name”: “政法大学教学楼”,\n      “description”: “90年代政法大学教学楼外景，灰白四层砖混建筑，方正对称结构，楼前林荫道路，复古棕褐色调。日间自然光，晴天正午，横向全景构图，无人空镜。”\n    }\n  ]\n}`

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
              status: state.assets.status === 'completed' ? 'assets_ready' : undefined,
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
