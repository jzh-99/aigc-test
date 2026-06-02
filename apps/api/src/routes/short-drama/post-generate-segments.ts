import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import {
  calculateShortDramaSegmentDuration,
  extractShortDramaShotDurations,
} from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每次文本生成预冻结 25 积分（片段脚本通常较长）
const ESTIMATED_CREDITS = 25
const EPISODE_TARGET_DURATION_SECONDS = 120
const EPISODE_MIN_DURATION_SECONDS = 110
const EPISODE_MAX_DURATION_SECONDS = 130
const SEGMENT_VIDEO_ALLOWED_DURATIONS = [10, 11, 12]
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

    // 检查是否已有片段脚本
    if (episode.segments.length > 0) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '该集的片段脚本已生成' },
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

    // 获取全局素材和该集的素材
    const globalAssets = state.assets.items.filter((a) => a.scope === 'global')
    const episodeAssets = state.assets.items.filter(
      (a) => a.scope === 'episode' && a.episodeNumber === episodeNumber
    )
    const allAssets = [...globalAssets, ...episodeAssets]

    const assetsText = allAssets
      .map((a) => `- ${a.kind}：@${a.name}（${a.description}）`)
      .join('\n')

    // 调用 AI 生成片段脚本（分镜写入 prompt 内）
    const REDACTED = [
      '你是专业短剧分镜师。请根据剧本摘要、分集分场剧本和素材，为该集生成可直接提交视频模型的片段脚本。',
      '只输出 JSON 数组，每个元素包含 title、prompt、mentionNames、durationSeconds 字段，不要输出 markdown。',
      '片段是视频生成的最小单位；必须基于分集剧本中的场次拆分，优先做到一场对应一个片段，长场可以拆成多个连续片段。',
      '一集成片时长必须控制在 2 分钟左右：总时长目标 120 秒，可接受范围 110-130 秒。',
      '每集必须生成 10-12 个片段；每个片段 10-12 秒，通过增加动作承接、表情反应、环境压迫、对白停顿和钩子镜头来扩充分段。',
      '不要脱离分集剧本另写新剧情；片段顺序、场景、人物、动作、对白重点必须来自分集剧本。',
      '每个片段 prompt 必须包含：第一段“本片段场景设定在：...”，后续 2-5 个“分镜N · Xs：...”描述。',
      '每个片段优先写 3 个分镜，按“近景/中景/特写/平视/跟拍/推镜”等镜头语言组织，形成连续动作，不要堆砌抽象概括。',
      '每个分镜要把分场剧本里的动作、对白、OS/VO 或字幕转写成可拍摄画面；不要只写概述。',
      '每个分镜必须写清楚景别、主体动作、面部微表情、场景背景和情绪变化；如有对白，改写成“人物正在说话/低声说话/声音压抑”等画面描述。',
      '每个分镜时长 X 必须为 2-10 秒；durationSeconds 必须等于本片段所有分镜时长之和。',
      '片段总时长必须为 10-12 秒，优先生成 10 秒以上的完整情绪推进，且必须能由 prompt 内所有分镜时长累加得到。',
      '当画面出现某个角色或场景时，必须在 prompt 中直接写对应的 @素材名，例如 @祁同伟、@汉东政法大学校园。',
      'mentionNames 必须填写本片段实际引用的素材名称，不带 @，且只能使用可用素材列表中的名称。',
      '不要虚构素材名称；没有引用素材时 mentionNames 返回空数组。',
    ].join('\n')

    const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n第${episodeNumber}集标题：${episode.title}\n\n第${episodeNumber}集分场剧本：\n${episode.summary}\n\n可用素材：\n${assetsText}\n\n画面比例：${state.settings.aspectRatio}\n默认时长：${state.settings.durationSeconds}秒\n\n请严格根据“第${episodeNumber}集分场剧本”生成该集的剧集分段内容。每个片段是一次视频生成单位，尽量按“### 场${episodeNumber}-1、### 场${episodeNumber}-2...”拆分；如果某一场动作/对白很多，可以拆成多个连续片段，但不得跳过原剧本中的关键动作、对白、OS/VO、字幕和情绪转折。\n\n总时长要求：\n- 本集目标总时长约 ${EPISODE_TARGET_DURATION_SECONDS} 秒，最终所有片段 durationSeconds 累加必须在 ${EPISODE_MIN_DURATION_SECONDS}-${EPISODE_MAX_DURATION_SECONDS} 秒之间。\n- 必须生成 10-12 个片段，每个片段 10-12 秒。\n- 如果原分场较少，要把同一场拆成“进入/发现/对峙/反应/推进/钩子”等连续片段，不要减少片段数量。\n\n每个片段包含：\n- title: 片段标题，建议体现对应场号和关键动作，例如“场${episodeNumber}-1：宿舍惊醒”\n- prompt: 完整片段文本，第一段写“本片段场景设定在：...”，后续优先写 3 个“分镜N · Xs：...”描述；出现素材时必须使用 @素材名。每个分镜都要包含景别、人物动作、面部微表情、场景背景和情绪，不要只写事件概要\n- mentionNames: 提及的素材名称列表，只能从可用素材中选择，名称不带 @\n- durationSeconds: 片段总时长，必须等于 prompt 中所有分镜时长之和，且必须为 10-12 秒\n\n每个分镜时长必须在 2-10 秒之间。片段总时长必须为 10-12 秒，生成内容需要在 10 秒钟往上，避免 4-9 秒的短片段。分镜不是视频生成单位，不要输出分镜 videoUrl、status 或单独任务字段。`

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

    const failStream = async (
      code: string,
      message: string,
      error: unknown,
      refundContext: string,
    ): Promise<void> => {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, refundContext)
      app.log.error({ error, projectId, episodeNumber }, message)
      sendEvent('error', { code, message })
      reply.raw.end()
    }

    sendEvent('progress', {
      message: `开始生成第 ${episodeNumber} 集片段脚本`,
      completedCount: 0,
      totalCount: 1,
    })

    let aiResponse: string
    try {
      aiResponse = await callDoubaoForTextStream(REDACTED, userPrompt, 12000, {
        onChunk: (text) => sendEvent('chunk', { text, episodeNumber }),
        onPing: sendPing,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'doubao',
          operation: 'episodes.segments',
          endpoint: '/chat/completions',
        },
      })
    } catch (error) {
      await failStream('AI_ERROR', 'AI 生成失败，请稍后重试', error, '片段脚本生成失败')
      return
    }

    // 解析 AI 返回的 JSON 数组
    let segments: unknown
    try {
      // 先尝试提取 JSON 对象或数组
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('未找到有效的 JSON')
      }

      const parsed = JSON.parse(jsonMatch[0])

      // 尝试从对象中提取数组（可能返回 { segments: [...] }）
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.segments)) {
          segments = parsed.segments
        } else {
          throw new Error('未找到 segments 数组')
        }
      } else if (Array.isArray(parsed)) {
        segments = parsed
      } else {
        throw new Error('未找到有效的数组')
      }
    } catch (error) {
      // JSON 解析失败，退还积分
      await failStream('VALIDATION_ERROR', 'AI 返回格式错误，请重试', error, 'AI 返回格式错误')
      return
    }

    // 校验数组
    if (!Array.isArray(segments) || segments.length === 0) {
      await failStream('VALIDATION_ERROR', 'AI 返回的片段数量为空', new Error('empty segments'), 'AI 返回片段为空')
      return
    }

    // 构建素材名称到 ID 的映射
    const assetNameToId = new Map<string, string>()
    for (const asset of allAssets) {
      assetNameToId.set(asset.name.toLowerCase(), asset.id)
    }

    const extractMentionNamesFromPrompt = (prompt: string): string[] => {
      return allAssets
        .filter(asset => prompt.includes(`@${asset.name}`))
        .map(asset => asset.name)
    }

    // 校验每个片段的核心字段
    const now = new Date().toISOString()
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
          `第 ${i + 1} 个片段的总时长必须为 10-12 秒`,
          new Error(`segment ${i + 1} invalid duration`),
          'AI 返回片段总时长错误',
        )
        return
      }

      // 解析 mentionNames 为 mentionRefs
      const mentionRefs = []
      const mentionNames = Array.from(new Set([
        ...seg.mentionNames,
        ...extractMentionNamesFromPrompt(prompt),
      ]))

      const mentionedAssetIds = new Set<string>()
      for (const name of mentionNames) {
        if (typeof name === 'string') {
          const normalizedName = name.replace(/^@/, '')
          const assetId = assetNameToId.get(normalizedName.toLowerCase())
          if (assetId && !mentionedAssetIds.has(assetId)) {
            mentionRefs.push({ assetId, assetName: normalizedName })
            mentionedAssetIds.add(assetId)
          }
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
        `本集需要生成 10-12 个片段，总时长控制在 ${EPISODE_MIN_DURATION_SECONDS}-${EPISODE_MAX_DURATION_SECONDS} 秒`,
        new Error(`invalid episode duration: ${parsedSegments.length} segments, ${episodeDurationSeconds}s`),
        'AI 返回本集时长不符合要求',
      )
      return
    }

    // 更新 episode 的 segments
    episode.segments = parsedSegments
    episode.status = 'idle'
    episode.updatedAt = now
    state.episodes.status = state.episodes.items.some(ep => ep.segments.length === 0) ? 'generating' : 'completed'

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
      })).settledCredits
    } catch (error) {
      // 状态保存/结算失败，安全退还全额积分
      await failStream('DATABASE_ERROR', '保存失败，积分已退还', error, '状态保存/结算失败')
      return
    }

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
    reply.raw.end()
  })
}

export default route
