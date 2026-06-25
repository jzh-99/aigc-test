import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import {
  calculateShortDramaSegmentDuration,
  extractShortDramaShotDurations,
  findShortDramaMentionedAssets,
  getShortDramaAssetMentionAliases,
  resolveShortDramaAssetByMention,
} from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  markShortDramaProjectFailed,
} from './_text-generation.js'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { createShortDramaSSESession } from './_sse.js'
import {
  createShortDramaTextTaskBatch,
  heartbeatShortDramaTextTask,
  completeShortDramaTextTask,
  failShortDramaTextTask,
  TEXT_TASK_HEARTBEAT_INTERVAL_MS,
} from './_text-task.js'

// 保守预估：片段脚本输入+输出均计费，输入较长，预冻结 40 积分
const ESTIMATED_CREDITS = 40
// 单片段时长档位：13/14/15 秒，由 AI 根据剧本复杂度自判（动作/对白密集→15s，居中→14s，简洁→13s）
const SEGMENT_VIDEO_ALLOWED_DURATIONS = [13, 14, 15]
// 每集总时长：10-12 片段 × 13-15 秒，下限 10×13=130、上限 12×15=180
const EPISODE_TARGET_DURATION_SECONDS = 150
const EPISODE_MIN_DURATION_SECONDS = 130
const EPISODE_MAX_DURATION_SECONDS = 180
const RAW_SHOT_DURATION_PATTERN = /分镜\s*\d+(?:\s*[·.\-:：]\s*|\s+)\d+\s*s\b/gi

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string; episodeNumber: string }
  }>('/short-drama/projects/:id/episodes/:episodeNumber/segments', async (request, reply) => {
    const { id: projectId, episodeNumber: episodeNumberStr } = request.params

    // 解析 episodeNumber
    const episodeNumber = parseInt(episodeNumberStr, 10)
    if (isNaN(episodeNumber) || episodeNumber < 1) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '集数参数无效' },
      })
    }

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

    // 检查剧本摘要、分集梗概、素材是否已生成
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

    if (state.assets.items.length === 0) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成素材提示词' },
      })
    }

    // 查找对应的集
    const episode = state.episodes.items.find((ep) => ep.episodeNumber === episodeNumber)
    if (!episode) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `第 ${episodeNumber} 集不存在` },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-segments:${episodeNumber}`, { ttlSeconds: 480, autoRenew: false })
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: `第 ${episodeNumber} 集片段脚本正在生成中，请稍后刷新查看进度` },
      })
    }

    // 业管 A 豆扣减（生成前实时余额校验 → 扣减）。本地不再冻结积分。
    const creditAccountId = ''
    try {
      await deductBizMgmtPointsForGeneration({
        localUserId: userId,
        teamId,
        workspaceId: project.workspace_id,
        batchId: `shortdrama-segments-${projectId}-${episodeNumber}`,
        pointsNum: ESTIMATED_CREDITS,
        source: 1,
        remark: `短剧片段脚本生成（第${episodeNumber}集）`,
      })
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '业管 A 豆扣减失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    const now = new Date().toISOString()
    episode.segmentsStatus = 'generating'
    episode.updatedAt = now
    try {
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '片段脚本生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId, episodeNumber }, '短剧片段脚本生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    // 创建文本任务记录（僵死自愈的进程外状态来源）+ 心跳定时器
    let textTaskId: string | null = null
    try {
      textTaskId = await createShortDramaTextTaskBatch({
        projectId,
        textType: 'episode-segments',
        episodeNumber,
        userId,
        teamId,
        workspaceId: project.workspace_id,
        creditAccountId,
        estimatedCredits: ESTIMATED_CREDITS,
      })
    } catch (error) {
      app.log.warn({ error, projectId, episodeNumber }, '片段脚本文本任务记录创建失败，继续生成')
    }
    const heartbeatTimer = setInterval(() => {
      if (textTaskId) void heartbeatShortDramaTextTask(textTaskId).catch(() => {})
    }, TEXT_TASK_HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()

    // 获取全局素材和该集的素材
    const globalAssets = state.assets.items.filter((a) => a.scope === 'global')
    const episodeAssets = state.assets.items.filter(
      (a) => a.scope === 'episode' && a.episodeNumber === episodeNumber
    )
    const allAssets = [...globalAssets, ...episodeAssets]

    const assetsText = allAssets
      .map((a) => {
        const aliases = getShortDramaAssetMentionAliases(a)
          .filter(alias => alias !== a.name)
        const aliasText = aliases.length > 0 ? `；可用别名：${aliases.join('、')}` : ''
        return `- ${a.kind}：@${a.name}${aliasText}（${a.description}）`
      })
      .join('\n')

    // 调用 AI 生成片段脚本（分镜写入 prompt 内）
    const REDACTED = [
      '你是专业短剧分镜师、导演和摄影指导。请根据剧本摘要、分集分场剧本和素材，为该集生成可直接提交视频模型的片段脚本。',
      '',
      '【输出格式契约 · 最高优先级 · 违反即任务失败】',
      '1. 只输出一个 JSON 数组，第一个字符必须是 [，最后一个字符必须是 ]。',
      '2. 严禁输出 markdown 代码块标记（``` 或 ```json）、注释、解释、问候、思考过程或任何 JSON 数组以外的文字。',
      '3. 数组每个元素结构固定，含且仅含四个字段：title（字符串）、prompt（字符串）、mentionNames（字符串数组）、durationSeconds（数字）。',
      '4. prompt 字段内若需出现双引号，必须做 JSON 转义（反斜杠加引号）；换行用反斜杠加 n 转义；不得破坏外层 JSON 结构。durationSeconds 必须是数字字面量（如 14），不带引号或单位。',
      '5. 结构示例（仅示范格式，禁止照抄内容）：[{"title":"场1：示例","prompt":"本片段场景设定在：示例文本","mentionNames":["示例素材"],"durationSeconds":14}]',
      '',
      '片段是视频生成的最小单位；必须基于分集剧本中的场次拆分，优先做到一场对应一个片段，长场可以拆成多个连续片段。',
      '每个片段必须推进一个明确的剧情节拍：揭露新信息、升级冲突、促使人物做出选择或改变关系；禁止只切换机位、只补充表情反应或环境空镜而不推动剧情。',
      '片段的价值在于剧情推进密度而非分镜数量；宁可少写一段纯视觉过渡，也要保证每段都有对白交锋、决策或转折。',
      '一集成片时长必须控制在 2.5 分钟左右：总时长目标 150 秒，可接受范围 130-180 秒。',
      '每集必须生成 10-12 个片段；每个片段 13-15 秒。分段必须基于剧情节拍（新对白交锋、新信息揭露、新动作决策、新转折）自然切分，禁止用纯表情反应、纯环境空镜或重复动作来凑时长。',
      '不要脱离分集剧本另写新剧情；片段顺序、场景、人物、动作、对白重点必须来自分集剧本。',
      '必须延续项目选择的视觉风格，并把该风格落实到摄影、灯光、布景、妆造、色彩和表演质感中。',
      '如果项目视觉风格是 2D/3D 动漫、漫画、插画、卡通、国漫、日漫、赛璐璐、黏土/粘土、盲盒、定格动画或虾仁动画风格，片段 prompt 必须使用动画、插画、CG、黏土或对应风格语言描述线条、上色、角色表演、镜头节奏、材质和场景光影，禁止写真人照片、写实摄影、影视剧剧照或真人实拍质感。',
      '每个片段 prompt 必须内含视频提示词六要素：主体与风格锚点、场景与环境、运镜与节奏、动态分镜脚本、台词/声音、负面规避。不要把六要素写成标题堆叠，要自然嵌入片段描述。',
      '每个片段 prompt 必须包含：第一段“本片段场景设定在：...”，后续 2-5 个“分镜N · Xs：...”描述。',
      '每个片段优先写 3 个分镜，按“近景/中景/特写/平视/跟拍/推镜/手持/低角度/过肩镜头”等镜头语言组织，形成连续动作，不要堆砌抽象概括。',
      '每个分镜要把分场剧本里的动作、对白、OS/VO 或字幕转写成可拍摄画面；不要只写概述。',
      '每个分镜必须写清楚景别、主体动作、面部微表情、场景背景和情绪变化；关键对白必须直接保留台词原文并标注说话人语气状态（例如“祁同伟（压抑）：你早就知道了，对吧”），只在必要时用“低声”“声音颤抖”补充状态，不要把所有对白都模糊成“正在说话”。',
      '情绪和人物神态禁止只写成语或抽象词，例如“愤怒、悲伤、震惊、刀光剑影”；必须拆成眼神、呼吸、喉结、手指、嘴角、停顿、身体重心、动作迟疑等镜头可见细节。',
      '每个分镜必须补足专业视听信息：摄影构图或机位、灯光方向与冷暖、布景/道具细节、妆造状态、演员表演节奏，必要时写清声音或字幕。',
      '每个分镜必须加入动作指导视角：写清演员动作起点、动作过程、动作落点和身体重心变化，保证同一片段内人物位置、手部动作、视线方向、道具状态前后连续。',
      '相邻分镜之间必须有动作承接，例如“上一镜她刚抬手握住门把，本镜继续拧动门把并侧身进门”，避免演员突然换位置、突然换姿势或情绪断档。',
      '每个片段必须加入场记连续性视角：镜头切换或切回同一人物/同一空间时，人物站位、朝向、手持物、道具摆放、门窗开合、衣物褶皱、妆发伤痕和环境状态必须保持一致。',
      '关键道具必须做连续性锁定：写清道具由哪只手持握、朝向哪里、贴住/离开哪里、动作结束时停在什么位置；如果上一镜没有明确放下、转向、移开，下一镜必须保持同一手持状态、同一朝向和同一接触点。',
      '涉及枪械、刀具、文件、手机等强叙事道具时，禁止无因果跳变。若上一镜是枪口抵住自己下颌/太阳穴/胸口，下一镜只能延续枪口仍抵住同一部位或明确写出“他先缓慢移开枪口/转腕改变方向”的动作过程，不能突然变成对空、对他人或对无目标开枪。',
      '如同一场景被拆成多个片段，后一个片段开头必须承接前一个片段结尾的人物位置、姿势、道具状态和情绪状态，不要让人或物凭空移动、消失或复原。',
      '妆造和布景必须延续剧本摘要与分集剧本设定，不要凭空改变角色服装、发型、身份质感或场景时代背景。',
      '灯光和摄影要服务剧情情绪，例如压迫感用低角度和强反差，暧昧/回忆用柔光和慢推，反转用特写和突然留白。',
      '每个分镜时长 X 必须为 2-10 秒；durationSeconds 必须等于本片段所有分镜时长之和。',
      '片段总时长必须为 13、14 或 15 秒三者之一，根据本片段剧本内容自行选定档位：动作/对白密集、情绪推进复杂的长场选 15 秒；叙事简洁、节奏明快的短场选 13 秒；介于两者之间选 14 秒。选定后必须能由 prompt 内所有分镜时长累加得到，优先生成完整情绪推进而非缩短时长。',
      '当画面出现某个角色或场景时，必须在 prompt 中直接写对应的 @素材名或可用别名，例如 @祁同伟、@祁同学、@汉东政法大学校园。',
      'mentionNames 必须填写本片段实际引用的素材名称或可用别名，不带 @，且只能使用可用素材列表中的名称或别名。',
      '不要虚构素材名称；没有引用素材时 mentionNames 返回空数组。',
    ].join('\n')

    const userPrompt = [
      `剧本摘要：${state.script.refinedPrompt}`,
      '',
      `第${episodeNumber}集标题：${episode.title}`,
      '',
      `第${episodeNumber}集分场剧本：`,
      episode.summary,
      '',
      '可用素材：',
      assetsText,
      '',
      `画面比例：${state.settings.aspectRatio}`,
      `视觉风格：${state.settings.style}`,
      `默认时长：${state.settings.durationSeconds}秒`,
      '',
      `请严格根据“第${episodeNumber}集分场剧本”生成该集的剧集分段内容。每个片段是一次视频生成单位，尽量按“### 场${episodeNumber}-1、### 场${episodeNumber}-2...”拆分；如果某一场动作/对白很多，可以拆成多个连续片段，但不得跳过原剧本中的关键动作、对白、OS/VO、字幕和情绪转折。`,
      '',
      '总时长要求：',
      `- 本集目标总时长约 ${EPISODE_TARGET_DURATION_SECONDS} 秒，最终所有片段 durationSeconds 累加必须在 ${EPISODE_MIN_DURATION_SECONDS}-${EPISODE_MAX_DURATION_SECONDS} 秒之间。`,
      '- 必须生成 10-12 个片段，每个片段 13、14 或 15 秒。',
      '- 每个片段的时长档位根据其剧本内容自行选定：动作/对白密集、情绪推进复杂的长场选 15 秒；叙事简洁、节奏明快的短场选 13 秒；介于两者之间选 14 秒。',
      '- 如果原分场较少，应从分场剧本中挖掘更多实质性节拍（被省略的对白、潜在冲突点、人物隐藏动机）来补充片段，每个拆出的片段必须推进不同的剧情点，禁止把单个动作拆成多段纯视觉分镜。',
      '',
      '每个片段包含：',
      `- title: 片段标题，建议体现对应场号和关键动作，例如“场${episodeNumber}-1：宿舍惊醒”`,
      '- prompt: 完整片段文本，第一段写“本片段场景设定在：...”，后续优先写 3 个“分镜N · Xs：...”描述；出现素材时必须使用 @素材名。每个分镜都要包含景别、人物动作、面部微表情、场景背景和情绪，不要只写事件概要',
      '- mentionNames: 提及的素材名称或可用别名列表，只能从可用素材中选择，名称不带 @',
      '- durationSeconds: 片段总时长，必须等于 prompt 中所有分镜时长之和，且必须为 13、14 或 15 秒之一',
      '',
      '专业执行要求：',
      `- 所有片段必须统一遵循项目视觉风格“${state.settings.style}”，并把该风格具体写进摄影、灯光、色彩、布景、妆造和表演气质中，不要只在开头提一次。`,
      '- 如果项目视觉风格是 2D/3D 动漫、漫画、插画、卡通、国漫、日漫、赛璐璐、黏土/粘土、盲盒、定格动画或虾仁动画风格，必须写清动画线条、平涂/赛璐璐上色、CG 体积、黏土材质或对应风格特征，以及角色表演、场景光影和镜头节奏；负面规避必须包含避免真人摄影、写实剧照、真实摄影棚质感。',
      '- 按视频提示词六要素组织信息：主体与风格锚点、场景与环境、运镜与节奏、动态分镜脚本、台词/声音、负面规避；其中负面规避可以写成“避免...”短句，例如避免动作断层、避免背景虚假、避免人物气息平稳到不像刚奔跑。',
      '- 每个分镜都要写出导演调度、摄影机位/运动、灯光冷暖与方向、布景或关键道具、服装妆发状态、演员表演节奏中的至少 4 类信息。',
      '- 特殊运镜必须明确标注，例如“急速切回”“主观视角推进”“低角度压迫”“手持跟拍”“慢推到眼神特写”；普通镜头不需要炫技，但必须服务情绪和叙事。',
      '- 每个分镜都要加入动作指导：说明演员从哪里来、正在做什么、动作如何完成、动作结束时停在哪里；同一片段内人物站位、视线、手部动作、道具拿放和情绪强度必须连续。',
      '- 相邻分镜必须写出动作衔接词，例如“延续上一镜”“接着”“顺势”“停顿后”“转身时”，让视频模型能理解演员动作不是独立截图。',
      '- 每个片段都要加入场记连续性检查：镜头切换或切回时，人物站位、身体朝向、手持道具、桌椅/门窗/手机等物件位置、服装妆发、伤痕污渍和环境状态必须和上一镜一致。',
      '- 关键道具要写“状态锁定”：哪只手拿、道具朝向、接触身体或桌面的具体位置、镜头结束时停在哪里；下一分镜必须继承这些状态，除非先写出清晰的移动/转向/放下动作。',
      '- 枪械、刀具等强叙事道具尤其不能跳变：例如上一镜“枪口抵住自己下颌”，下一镜不能突然写成“对空气开枪”；必须写“枪口仍贴着下颌，手指压向扳机”或先写“他缓慢移开枪口并转向某处”的完整动作因果。',
      '- 如果同一场被拆成多个片段，后一片段第一镜必须承接前一片段最后一镜的人物位置、姿势、道具拿放和情绪状态，避免切回时人或物凭空变化。',
      '- 摄影描述要具体到景别、角度、运动或构图重点，例如“低角度近景压迫”“过肩镜头制造偷窥感”“慢推到眼神特写”。',
      '- 灯光、布景、妆造必须与剧情情绪和角色身份一致，不要写成无关的视觉堆砌。',
      '',
      '每个分镜时长必须在 2-10 秒之间。片段总时长必须为 13、14 或 15 秒之一，按本片段剧本复杂度自行选定档位，避免低于 13 秒或高于 15 秒。分镜不是视频生成单位，不要输出分镜 videoUrl、status 或单独任务字段。',
      '',
      '【最后强调】直接以 [ 开头、] 结尾输出 JSON 数组，不要包含任何其他字符，也不要用 markdown 代码块包裹。',
    ].join('\n')

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

    const failStream = async (
      code: string,
      message: string,
      error: unknown,
      refundContext: string,
    ): Promise<void> => {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, refundContext)
      const now = new Date().toISOString()
      const failedEpisode = episode as typeof episode & { errorMessage?: string | null }
      episode.segmentsStatus = 'failed'
      failedEpisode.errorMessage = message
      episode.updatedAt = now
      await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
        app.log.error({ error: saveError, projectId, episodeNumber }, '短剧片段脚本失败状态保存失败')
      })
      if (textTaskId) await failShortDramaTextTask(textTaskId).catch(() => {})
      app.log.error({ error, projectId, episodeNumber }, message)
      sendEvent('error', { code, message })
      await releaseRedisLock(app.redis, generationLock)
      clearInterval(heartbeatTimer)
      session.end()
    }

    sendEvent('progress', {
      message: `开始生成第 ${episodeNumber} 集片段脚本`,
      completedCount: 0,
      totalCount: 1,
    })

    // 调用 AI + 解析 JSON：JSON 解析失败时自动重试 1 次（重试降 temperature 至 0.3，提升格式稳定性）。
    // 前端 step-episodes 不消费 chunk 文本，故重试可静默重放，无需前端清屏。
    const MAX_PARSE_ATTEMPTS = 2
    const auditContext = {
      userId,
      teamId,
      workspaceId: project.workspace_id,
      module: 'short_drama',
      provider: 'qwen',
      operation: 'episodes.segments',
      endpoint: '/chat/completions',
    }

    let aiResponse = ''
    let lastUserPrompt = userPrompt
    let segments: unknown = null
    let parseSucceeded = false
    let lastParseError: unknown

    for (let attempt = 0; attempt < MAX_PARSE_ATTEMPTS && !parseSucceeded; attempt++) {
      // 首次失败后的重试：提示用户 + 降 temperature + 末尾追加纠错强约束
      if (attempt > 0) {
        sendEvent('progress', {
          message: `AI 返回格式异常，正在自动重试（第 ${attempt + 1} 次）...`,
          completedCount: 0,
          totalCount: 1,
        })
      }
      const temperature = attempt === 0 ? 0.7 : 0.3
      const effectiveUserPrompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\n【重要】上一次输出无法解析为合法 JSON。请务必只输出一个 JSON 数组：首字符为 [、尾字符为 ]，不要包含 markdown 代码块、注释或任何 JSON 以外的文字。`

      // 调用 AI（网络/超时类失败直接终止，不重试）
      try {
        aiResponse = await callQwenForTextStream(REDACTED, effectiveUserPrompt, 16000, {
          onChunk: (text) => sendEvent('chunk', { text, episodeNumber }),
          onPing: sendPing,
          externalSignal: clientSignal,
          audit: auditContext,
        }, temperature)
        lastUserPrompt = effectiveUserPrompt
      } catch (error) {
        await failStream('AI_ERROR', 'AI 生成失败，请稍后重试', error, '片段脚本生成失败')
        return
      }

      // 解析 JSON（失败则进入下一轮重试）
      try {
        // 先尝试提取 JSON 对象或数组
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
        if (!jsonMatch) {
          throw new Error('未找到有效的 JSON')
        }

        const parsed = JSON.parse(jsonMatch[0])

        // 尝试从对象中提取数组（可能返回 { segments: [...] }）
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          if (Array.isArray((parsed as Record<string, unknown>).segments)) {
            segments = (parsed as Record<string, unknown>).segments
          } else {
            throw new Error('未找到 segments 数组')
          }
        } else if (Array.isArray(parsed)) {
          segments = parsed
        } else {
          throw new Error('未找到有效的数组')
        }
        parseSucceeded = true
      } catch (error) {
        lastParseError = error
        app.log.warn({ error, projectId, episodeNumber, attempt }, '片段脚本 JSON 解析失败，准备重试')
      }
    }

    if (!parseSucceeded) {
      // 全部重试均失败，退还积分
      await failStream('VALIDATION_ERROR', 'AI 返回格式错误，请重试', lastParseError, 'AI 返回格式错误')
      return
    }

    // 校验数组
    if (!Array.isArray(segments) || segments.length === 0) {
      await failStream('VALIDATION_ERROR', 'AI 返回的片段数量为空', new Error('empty segments'), 'AI 返回片段为空')
      return
    }

    // 校验每个片段的核心字段
    const parsedSegments = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as Record<string, unknown>

      // 校验必需字段
      if (
        typeof seg.title !== 'string' ||
        typeof seg.prompt !== 'string' ||
        !Array.isArray(seg.mentionNames) ||
        typeof seg.durationSeconds !== 'number'
      ) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段的字段格式错误或缺少必需字段`,
          new Error(`segment ${i + 1} invalid`),
          'AI 返回片段字段错误',
        )
        return
      }

      const title = seg.title.trim()
      const prompt = seg.prompt.trim()
      const shotDurations = extractShortDramaShotDurations(prompt)
      const rawShotDurationCount = Array.from(prompt.matchAll(RAW_SHOT_DURATION_PATTERN)).length
      const durationSeconds = calculateShortDramaSegmentDuration(prompt, 0)

      if (!title || !prompt) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段的标题或提示词不能为空`,
          new Error(`segment ${i + 1} empty title or prompt`),
          'AI 返回片段内容为空',
        )
        return
      }

      if (!prompt.includes('本片段场景设定在')) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段缺少场景设定`,
          new Error(`segment ${i + 1} missing scene setting`),
          'AI 返回片段缺少场景设定',
        )
        return
      }

      if (rawShotDurationCount !== shotDurations.length) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段的分镜时长必须在 2-10 秒之间`,
          new Error(`segment ${i + 1} invalid shot duration`),
          'AI 返回片段分镜时长错误',
        )
        return
      }

      if (shotDurations.length < 2 || shotDurations.length > 5) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段必须包含 2-5 个有效时长描述`,
          new Error(`segment ${i + 1} invalid shot count`),
          'AI 返回片段结构数量错误',
        )
        return
      }

      if (!SEGMENT_VIDEO_ALLOWED_DURATIONS.includes(durationSeconds)) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个片段的总时长必须为 13-15 秒`,
          new Error(`segment ${i + 1} invalid duration`),
          'AI 返回片段总时长错误',
        )
        return
      }

      // 解析 mentionNames 为 mentionRefs
      const mentionRefs = []
      const mentionNames = Array.from(new Set([
        ...seg.mentionNames,
      ]))

      const mentionedAssetIds = new Set<string>()
      for (const name of mentionNames) {
        if (typeof name === 'string') {
          const normalizedName = name.replace(/^@/, '')
          const matchedAsset = resolveShortDramaAssetByMention(normalizedName, allAssets)
          if (matchedAsset && !mentionedAssetIds.has(matchedAsset.id)) {
            mentionRefs.push({ assetId: matchedAsset.id, assetName: matchedAsset.name })
            mentionedAssetIds.add(matchedAsset.id)
          }
        }
      }

      for (const asset of findShortDramaMentionedAssets(prompt, allAssets)) {
        if (!mentionedAssetIds.has(asset.id)) {
          mentionRefs.push({ assetId: asset.id, assetName: asset.name })
          mentionedAssetIds.add(asset.id)
        }
      }

      parsedSegments.push({
        id: randomUUID(),
        order: i + 1,
        title,
        prompt,
        mentionRefs,
        durationSeconds,
        videoUrl: null,
        status: 'idle' as const,
      })
    }

    const episodeDurationSeconds = parsedSegments.reduce(
      (total, segment) => total + segment.durationSeconds,
      0,
    )
    if (
      parsedSegments.length < 10 ||
      parsedSegments.length > 12 ||
      episodeDurationSeconds < EPISODE_MIN_DURATION_SECONDS ||
      episodeDurationSeconds > EPISODE_MAX_DURATION_SECONDS
    ) {
      await failStream(
        'VALIDATION_ERROR',
        `本集需要生成 10-12 个片段（每片段 13-15 秒），总时长控制在 ${EPISODE_MIN_DURATION_SECONDS}-${EPISODE_MAX_DURATION_SECONDS} 秒`,
        new Error(`invalid episode duration: ${parsedSegments.length} segments, ${episodeDurationSeconds}s`),
        'AI 返回本集时长不符合要求',
      )
      return
    }

    // 更新 episode 的 segments
    const completedEpisode = episode as typeof episode & { errorMessage?: string | null }
    episode.segments = parsedSegments
    episode.segmentsStatus = 'completed'
    episode.status = 'idle'
    completedEpisode.errorMessage = null
    episode.updatedAt = now

    // 计算实际积分消耗（输入 + 输出字符均计费）
    const actualCredits = calculateTextGenerationCredits(REDACTED + lastUserPrompt, aiResponse)

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
      })).settledCredits
    } catch (error) {
      // 状态保存/结算失败，安全退还全额积分
      await failStream('DATABASE_ERROR', '保存失败，积分已退还', error, '状态保存/结算失败')
      return
    }

    // 文本任务记录标记完成
    if (textTaskId) await completeShortDramaTextTask(textTaskId, actualCredits).catch(() => {})

    sendEvent('progress', {
      message: `第 ${episodeNumber} 集片段脚本生成完成`,
      completedCount: 1,
      totalCount: 1,
    })

    sendEvent('done', {
      success: true,
      episodeNumber,
      segments: parsedSegments,
      credits: settledCredits,
      state,
    })
    await releaseRedisLock(app.redis, generationLock)
    clearInterval(heartbeatTimer)
    session.end()
  })
}

export default route
