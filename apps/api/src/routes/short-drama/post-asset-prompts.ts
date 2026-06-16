import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaAssetKind } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  buildShortDramaOutlineBatches,
  applyShortDramaAssetPromptsBatchResult,
  markShortDramaProjectFailed,
  type ShortDramaAssetPromptInput,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { createShortDramaSSESession } from './_sse.js'
import {
  createShortDramaTextTaskBatch,
  heartbeatShortDramaTextTask,
  completeShortDramaTextTask,
  failShortDramaTextTask,
  TEXT_TASK_HEARTBEAT_INTERVAL_MS,
} from './_text-task.js'

// 保守预估：每个素材描述批次输入+输出均计费，预冻结 25 积分
const ESTIMATED_CREDITS = 25
const ASSET_PROMPT_BATCH_MAX_TOKENS = 5000

function parseAssetPromptBatch(aiResponse: string): ShortDramaAssetPromptInput[] {
  const parsed = parseAndValidateJson(aiResponse, ['characters', 'scenes', 'requisites'])

  if (!Array.isArray(parsed.characters) || !Array.isArray(parsed.scenes) || !Array.isArray(parsed.requisites)) {
    throw new Error('AI 返回的角色、场景或道具格式错误')
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

  for (const requisite of parsed.requisites as Array<Record<string, unknown>>) {
    if (typeof requisite.name === 'string' && typeof requisite.description === 'string') {
      assets.push({
        kind: 'requisite',
        name: requisite.name,
        description: requisite.description,
      })
    }
  }

  return assets
}

function formatExistingAssets(
  assets: Array<{ kind: ShortDramaAssetKind; name: string; aliases?: string[] }>,
  kind: 'character' | 'scene' | 'requisite'
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

    // 立即把素材描述状态置为 generating 并落库：
    // 让前端在第一批 AI 返回前就能拿到「生成中」态并持续轮询，
    // 也避免切步骤等保存动作用过期快照把状态覆盖回 idle。
    state.assets.status = 'generating'
    await saveShortDramaProjectState(projectId, state, 0)

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:asset-prompts`, { ttlSeconds: 480, autoRenew: false })
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '素材描述正在生成中，请稍后刷新查看进度' },
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

    // 封装 SSE 写入：连接断开时静默失败，并暴露 clientSignal 用于及时中止 AI 上游请求
    const session = createShortDramaSSESession(reply)
    const { sendEvent, sendPing, clientSignal } = session

    // 文本任务记录（僵死自愈的状态来源）：该路由积分按批冻结，循环外无 creditAccountId，
    // 故任务记录在第一批 freezeCredits 后创建（见循环内）。心跳定时器先启动，textTaskId 赋值后自动写心跳。
    let textTaskId: string | null = null
    const heartbeatTimer = setInterval(() => {
      if (textTaskId) void heartbeatShortDramaTextTask(textTaskId).catch(() => {})
    }, TEXT_TASK_HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()

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
          const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS, '短剧素材描述冻结')
          creditAccountId = freezeResult.creditAccountId
          // 第一批冻结后创建文本任务记录（creditAccountId 已可用，整个生成仅创建一次）
          if (!textTaskId) {
            try {
              textTaskId = await createShortDramaTextTaskBatch({
                projectId,
                textType: 'asset-prompts',
                userId,
                teamId,
                workspaceId: project.workspace_id,
                creditAccountId,
                estimatedCredits: ESTIMATED_CREDITS,
              })
            } catch (err) {
              app.log.warn({ err, projectId }, '素材描述文本任务记录创建失败，继续生成')
            }
          }
        } catch (error) {
          stoppedByBalance = true
          warningMessage = 'A豆余额不足，已停止生成后续素材描述。已保存已完成的角色、场景和道具描述，请充值后点击「继续生成描述」生成剩余素材。'
          sendEvent('warning', {
            message: warningMessage,
            completedCount,
            totalCount: totalOutlines,
            remainingCount: totalOutlines - completedCount,
          })
          break
        }

        sendEvent('progress', {
          message: `开始提取第 ${batch.from}-${batch.to} 集角色、场景和道具描述`,
          from: batch.from,
          to: batch.to,
          completedCount,
          totalCount: totalOutlines,
        })

        const batchOutlinesList = state.script.outlines
          .filter((outline) => outline.episodeNumber >= batch.from && outline.episodeNumber <= batch.to)

        // 优先走 mention 索引：分集生成时已经吐出了角色/场景命名，素材步骤只需要补 description；
        // 旧项目的分集没有这两个字段，回退到完整 summary，保证向后兼容。
        const allHaveMentions = batchOutlinesList.length > 0 && batchOutlinesList.every(
          (outline) => Array.isArray(outline.mentionedCharacters) && Array.isArray(outline.mentionedScenes),
        )

        const batchOutlines = allHaveMentions
          ? batchOutlinesList
              .map((outline) => {
                const characters = (outline.mentionedCharacters ?? []).join('、') || '无'
                const scenes = (outline.mentionedScenes ?? []).join('、') || '无'
                return `第${outline.episodeNumber}集：${outline.title}\n  - 出场角色：${characters}\n  - 涉及场景：${scenes}`
              })
              .join('\n\n')
          : batchOutlinesList
              .map((outline) => `第${outline.episodeNumber}集：${outline.title}\n${outline.summary}`)
              .join('\n\n')

        const existingCharacters = formatExistingAssets(state.assets.items, 'character')
        const existingScenes = formatExistingAssets(state.assets.items, 'scene')
        const existingRequisites = formatExistingAssets(state.assets.items, 'requisite')
        const systemPrompt = [
          '你是短剧视觉制作专家，整合选角导演、造型师、摄影指导、美术指导、道具师的专业视角，为图片生成模型提取角色定妆照、场景概念图和道具设定图提示词。',
          '只输出 JSON 对象，包含 characters、scenes、requisites 三个数组；characters 元素包含 name、aliases、description 字段，scenes 和 requisites 元素包含 name、description 字段，不要输出 markdown。',
          '',
          '## 角色定妆照提取规范（选角导演 + 造型师 + 摄影指导视角）',
          '角色形象必须优先基于剧本摘要中”人物小传”的视觉形象、核心标签、身份背景生成；如果人物小传中已有同名角色，不要只根据当前分集剧情临时改写外貌。',
          '分集内容只用于补充该阶段的年龄、服装时代感和出场状态，不得覆盖人物小传中稳定的人物气质和核心视觉特征。',
          '角色定妆照遵循”基础信息 + 面部细节 + 发型 + 穿搭 + 光影角度 + 风格画质 + 约束条件”的结构，必须写成稳定可复用素材，不写某一场戏的瞬间动作。',
          '角色 description 必须把项目视觉风格落实到画风、线条、上色、光影、材质和人物五官表现中；如果项目视觉风格是 2D/3D 动漫、漫画、插画、卡通、国漫、日漫、赛璐璐、黏土/粘土、盲盒、定格动画或虾仁动画风格，禁止写真人照片、写实摄影、影视剧剧照或真实摄影棚质感。',
          '',
          '### 选角导演视角（casting director）：',
          '- 明确年龄段（如：约25岁、30岁出头、40-45岁、花甲之年）',
          '- 性别、族裔特征（默认东亚汉族：黑发、黄皮肤、东亚脸型，除非剧本明确其他族裔）',
          '- 体型身材（如：纤瘦、结实匀称、魁梧壮硕、丰腴）',
          '- 面部特征（如：方正脸型、瓜子脸、棱角分明、五官柔和）',
          '- 气质标签（如：书卷气、凌厉干练、温婉内敛、草根质朴）',
          '- 稳定识别点（如：眼型、鼻梁、嘴唇、眉形、肤色、脸部轮廓），后续任何年龄阶段都不能漂移',
          '',
          '### 造型师视角（stylist）：',
          '- 发型（如：齐肩直发、短寸头、中分长发、微卷短发）',
          '- 服装款式（如：白衬衫西裤、碎花连衣裙、工装制服、休闲卫衣）',
          '- 服装色系（如：黑白灰、暖色调、冷色调、素色系）',
          '- 年代特征（如：90年代校园风、2000年代职场装、民国长衫、当代简约风）',
          '- 妆容状态（如：淡妆、素颜、精致妆容）',
          '- 阶段差异只允许体现在服装、发型成熟度和妆面状态，不得改变同一角色的骨相和核心识别点',
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
          '禁止写”正在哭、正在打斗、正在奔跑、拿着枪”等剧情动作；禁止夸张妆容、杂乱背景、比例失调、脸型漂移。',
          '',
          '## 场景概念图提取规范（美术指导 + 摄影指导视角）',
          '场景概念图遵循”场景类型 + 环境元素 + 光影色调 + 画风 + 用途 + 无人物干扰”的结构，贴合题材，避免冗余元素影响主体。',
          '',
          '### 美术指导视角（production designer）：',
          '- 场景类型（如：教学楼外景、咖啡厅内景、街道夜景、办公室）',
          '- 空间结构（如：开阔广场、狭窄走廊、高挑大堂、紧凑格子间）',
          '- 陈设布置（如：实木家具、现代简约、陈旧桌椅、绿植装饰）',
          '- 年代还原（如：90年代国营单位、2010年代科技公司、民国茶馆）',
          '- 色彩基调（如：暖黄色调、冷灰蓝调、复古棕褐、明亮白色）',
          '- 关键道具位置（如：办公桌、黑板、宣传栏、门窗、楼梯、车辆），为后续场记连续性提供空间锚点',
          '',
          '### 摄影指导视角（cinematographer）：',
          '- 光线氛围（如：日间自然光、暖黄灯光、冷白荧光、傍晚逆光）',
          '- 空镜构图（如：横向全景、纵深透视、对称构图）',
          '- 天气时段（如：晴天正午、阴天、清晨薄雾、夜晚灯火）',
          '- 画面比例：默认按项目画面比例构图，优先使用可供视频裁切的横向全景或纵深构图',
          '',
          '### 严格禁止项：',
          '场景 description 必须是无人空镜，禁止出现人物、人脸、背影、人群、剧情动作、关系图、文字标注、道具特写。',
          '',
          '## 道具设定图提取规范（道具师 + 摄影指导视角）',
          '道具设定图遵循”道具类型 + 外观材质 + 尺寸比例 + 年代质感 + 画风 + 无人物干扰”的结构，只提取对剧情有强叙事作用的关键道具。',
          '',
          '### 道具师视角（props master）：',
          '- 道具类型（如：武器、信件、手机、钥匙、证件、车辆、标志性饰品）',
          '- 外观细节（如：颜色、形状、纹理、磨损程度、新旧状态）',
          '- 材质质感（如：金属光泽、木质纹理、皮革质感、玻璃透明）',
          '- 尺寸比例（如：手掌大小、A4尺寸、一人高、桌面摆放）',
          '- 年代特征（如：90年代老式电话、2010年代翻盖手机、当代智能手机）',
          '- 特殊标识（如：刻字、徽章、品牌标志、血迹、指纹）',
          '',
          '### 摄影指导视角（cinematographer）：',
          '- 构图：16:9 横版道具设定图，道具居中或三分构图',
          '- 背景：简洁纯色背景或与道具氛围匹配的环境虚化',
          '- 光线：突出材质质感的光线，如侧光强调纹理、柔光展现细节',
          '- 拍摄角度：45度俯拍或平视，展示道具全貌和关键细节',
          '',
          '### 提取原则：',
          '- 只提取对剧情推进有强叙事作用的关键道具，例如凶器、信件、遗物、标志性车辆、核心证据',
          '- 不提取日常背景物品（桌椅、门窗、普通家具），这些属于场景范畴',
          '- 如果剧本中没有明确的关键道具，requisites 返回空数组即可',
          '',
          '### 严格禁止项：',
          '道具 description 禁止出现人物、手部、脸部、背影或人群；禁止剧情动作描述；禁止文字标注。',
        ].join('\n')
        const batchHeading = allHaveMentions
          ? '当前批次分集涉及的角色与场景索引（已由分集步骤命名，本步只需基于剧本摘要补全 description；不要凭空新增）'
          : '当前批次分集剧本'
        const batchModeNote = allHaveMentions
          ? '\n\n【说明】characters/scenes 数组里只包含上述索引中真正需要新增制作参考图、且未在“已有角色/已有场景”里出现的条目。已有名称不要重复返回；索引外不要新增角色或场景。requisites 仍按剧情判断从分集线索中提取关键道具。'
          : ''
        const userPrompt = `剧本摘要（包含人物小传时必须优先参考）：\n${state.script.refinedPrompt}\n\n已有角色：\n${existingCharacters}\n\n已有场景：\n${existingScenes}\n\n已有道具：\n${existingRequisites}\n\n${batchHeading}：\n${batchOutlines}${batchModeNote}\n\n项目视觉风格：${state.settings.style}\n项目画面比例：${state.settings.aspectRatio}\n\n请只提取第 ${batch.from}-${batch.to} 集中新增且需要制作参考图的角色、场景和道具。已存在的角色、场景或道具不要重复返回。\n\n## 角色生成原则：\n- 如果角色在”人物小传”中出现，characters[].description 必须基于该角色小传的”视觉形象、核心标签、身份背景、性格特点”提炼。\n- 分集剧本只补充当前年龄阶段、服装年代、校园/职场状态，不要把剧情动作、情绪事件、人物关系写进生图提示词。\n- 角色描述要形成稳定可复用的角色定妆照，而不是某一场戏的截图。\n- 每个角色都要包含可被后续视频识别的固定视觉锚点：脸型五官、肤色、发型轮廓、体型气质、主服装色系。\n- 同一人物不同阶段可以拆成不同素材，但 aliases 要能深度匹配短名和身份称呼，description 要说明阶段差异，不得改掉同一人的核心识别点。\n\n## 场景生成原则：\n- 场景描述要服务后续分镜和视频，写清空间结构、陈设、关键道具位置、年代质感、光线来源和色彩基调。\n- 场景素材必须是无人空镜，不要把剧情事件、人物关系或动作写进去。\n- 必须把项目视觉风格”${state.settings.style}”落实到画风、光影、色彩和空间质感中，不要只写风格名。\n\n## 道具生成原则：\n- 只提取对剧情有强叙事作用的关键道具（如凶器、信件、遗物、标志性车辆、核心证据），不提取日常背景物品。\n- 道具描述要写清外观材质、尺寸比例、年代质感和特殊标识，适合直接作为图片生成提示词。\n- 道具设定图必须是无人空镜，禁止出现人物、手部或人群。\n- 必须把项目视觉风格”${state.settings.style}”落实到材质、光泽和质感描述中。\n- 如果当前分集没有需要单独制作参考图的关键道具，requisites 返回空数组即可。\n\n## 输出要求：\n- characters[].aliases 必须列出 2-5 个常用称呼、简称、阶段省略名或身份称呼，不要包含 @，不要和 name 完全重复；例如 name 为”祁同伟（大学阶段）”时 aliases 可包含”祁同伟””祁同伟大学时期””祁同学”。\n- characters[].description 必须按【选角导演→造型师→摄影指导→负面约束】顺序组织：先写人物基础特征（年龄/性别/族裔/体型/脸部识别点/气质），再写造型（发型/服装/色系/年代感/妆容），最后写拍摄要求（全身正面定妆照/白色背景/无道具）和禁止项。\n- scenes[].description 必须按【美术指导→摄影指导→灯光→负面约束】顺序组织：先写场景类型和陈设（空间/结构/布置/年代/色调/关键道具位置），再写光线氛围（光线/天气/构图/画面比例），明确标注”无人空镜”。\n- requisites[].description 必须按【道具师→摄影指导→负面约束】顺序组织：先写道具体类型和外观（材质/颜色/形状/尺寸/年代/特殊标识），再写拍摄要求（16:9横版/居中构图/纯色背景），明确标注”无人空镜”。\n- 每条 description 控制在 80-140 个汉字，信息密度高，适合直接作为图片生成提示词。\n\n## 返回 JSON 示例：\n{\n  “characters”: [\n    {\n      “name”: “林北辰（大学时期）”,\n      “aliases”: [“林北辰”, “北辰”, “林同学”],\n      “description”: “约23岁东亚汉族男性，纤瘦挺拔身形，棱角分明脸型，高鼻梁薄唇，短黑寸头，眼神清醒克制，书卷气中带寒门锋利感。90年代简洁校服白衬衫配深色长裤，素色系。全身正面定妆照，平视镜头，从头到脚完整入镜，白色摄影棚背景，均匀柔光，无道具无配饰，禁止剧情动作。”\n    }\n  ],\n  “scenes”: [\n    {\n      “name”: “政法大学教学楼”,\n      “description”: “90年代政法大学教学楼外景，灰白四层砖混建筑，方正对称结构，楼前林荫道路和宣传栏固定在画面左侧，复古棕褐色调。日间自然光，晴天正午，16:9 横向全景构图，写实正剧质感，无人空镜，禁止人物和文字标注。”\n    }\n  ],\n  “requisites”: [\n    {\n      “name”: “录取通知书”,\n      “description”: “90年代大学录取通知书，牛皮纸信封，红色校徽印章，毛笔字体校名，纸张微黄带年代感褶皱。16:9 横版道具设定图，道具居中，纯色暖白背景，侧光突出纸张纹理，写实正剧质感，无人空镜，禁止人物和手部。”\n    }\n  ]\n}`

        try {
          const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, ASSET_PROMPT_BATCH_MAX_TOKENS, {
            onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
            onPing: sendPing,
            externalSignal: clientSignal,
            audit: {
              userId,
              teamId,
              workspaceId: project.workspace_id,
              module: 'short_drama',
              provider: 'qwen',
              operation: 'assets.prompts',
              endpoint: '/chat/completions',
            },
          })

          const previousState = JSON.parse(JSON.stringify(state)) as typeof state
          const assets = parseAssetPromptBatch(aiResponse)
          const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
          applyShortDramaAssetPromptsBatchResult(state, assets, batch.to)
          const isAssetsCompleted = state.assets.processedOutlineCount >= totalOutlines

          try {
            const settledCredits = (await saveShortDramaStateAndSettleCredits({
              projectId,
              state,
              actualCredits,
              estimatedCredits: ESTIMATED_CREDITS,
              creditAccountId,
              userId,
              teamId,
              status: isAssetsCompleted ? 'assets_ready' : undefined,
            })).settledCredits

            totalCredits += settledCredits
          } catch (error) {
            Object.assign(state, previousState)
            throw error
          }

          completedCount = state.assets.processedOutlineCount
          sendEvent('progress', {
            message: `第 ${batch.from}-${batch.to} 集角色、场景和道具描述提取完成`,
            from: batch.from,
            to: batch.to,
            completedCount,
            totalCount: totalOutlines,
          })
        } catch (error) {
          await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集素材描述生成失败`)
          app.log.error({ error, projectId, batch }, '短剧素材描述批次生成失败')
          state.assets.status = 'failed'
          await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
            app.log.error({ error: saveError, projectId }, '短剧素材描述失败状态保存失败')
          })
          // 文本任务记录标记失败
          if (textTaskId) await failShortDramaTextTask(textTaskId).catch(() => {})

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
      // 文本任务记录标记完成（循环正常结束，全部成功或部分成功已落库）
      if (textTaskId) await completeShortDramaTextTask(textTaskId, totalCredits).catch(() => {})
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
      clearInterval(heartbeatTimer)
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
  })
}

export default route
