import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { SHORT_DRAMA_DEFAULT_DURATION_SECONDS } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：每次文本生成预冻结 25 积分（分镜脚本通常较长）
const ESTIMATED_CREDITS = 25

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

    // 检查是否已有分镜
    if (episode.segments.length > 0) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '该集的分镜已生成' },
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

    // 调用 AI 生成分镜（要求完整字段）
    const REDACTED = [
      '你是专业短剧分镜师。请根据剧本摘要、分集梗概和素材，为该集生成详细的分镜脚本。',
      '只输出 JSON 数组，每个元素包含 title、prompt、mentionNames、durationSeconds、cameraNote、actionNote、dialogueOrSubtitle 字段，不要输出 markdown。',
      'prompt 必须是可用于视频生成的画面描述；当镜头出现某个角色或场景时，必须在 prompt 中直接写对应的 @素材名，例如 @祁同伟、@汉东政法大学校园。',
      'mentionNames 必须填写本镜头实际引用的素材名称，不带 @，且只能使用可用素材列表中的名称。',
      '不要虚构素材名称；没有引用素材时 mentionNames 返回空数组。',
    ].join('\n')

    const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n第${episodeNumber}集梗概：${episode.title}\n${episode.summary}\n\n可用素材：\n${assetsText}\n\n画面比例：${state.settings.aspectRatio}\n默认时长：${state.settings.durationSeconds}秒\n\n请生成该集的分镜脚本。剧情较复杂时可生成 12-18 个镜头，普通剧情生成 8-12 个镜头。每个镜头包含：\n- title: 镜头标题\n- prompt: 视频生成提示词，必须在出现素材时使用 @素材名，并详细描述画面内容、动作、氛围\n- mentionNames: 提及的素材名称列表，只能从可用素材中选择，名称不带 @\n- durationSeconds: 镜头时长（默认 ${state.settings.durationSeconds} 秒）\n- cameraNote: 镜头运镜说明（如推拉摇移、特写、全景等）\n- actionNote: 动作说明（角色动作、场景变化等）\n- dialogueOrSubtitle: 对白或字幕内容`

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
      message: `开始生成第 ${episodeNumber} 集分镜脚本`,
      completedCount: 0,
      totalCount: 1,
    })

    let aiResponse: string
    try {
      aiResponse = await callDoubaoForTextStream(REDACTED, userPrompt, 8000, {
        onChunk: (text) => sendEvent('chunk', { text, episodeNumber }),
        onPing: sendPing,
      })
    } catch (error) {
      await failStream('AI_ERROR', 'AI 生成失败，请稍后重试', error, '分镜脚本生成失败')
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
      await failStream('VALIDATION_ERROR', 'AI 返回的分镜数量为空', new Error('empty segments'), 'AI 返回分镜为空')
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

    // 校验每个分镜的完整字段（spec 要求）
    const now = new Date().toISOString()
    const parsedSegments = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as Record<string, unknown>

      // 校验必需字段
      if (
        typeof seg.title !== 'string' ||
        typeof seg.prompt !== 'string' ||
        !Array.isArray(seg.mentionNames) ||
        typeof seg.durationSeconds !== 'number' ||
        typeof seg.cameraNote !== 'string' ||
        typeof seg.actionNote !== 'string' ||
        typeof seg.dialogueOrSubtitle !== 'string'
      ) {
        await failStream(
          'VALIDATION_ERROR',
          `第 ${i + 1} 个镜头的字段格式错误或缺少必需字段`,
          new Error(`segment ${i + 1} invalid`),
          'AI 返回分镜字段错误',
        )
        return
      }

      // 解析 mentionNames 为 mentionRefs
      const mentionRefs = []
      const mentionNames = Array.from(new Set([
        ...seg.mentionNames,
        ...extractMentionNamesFromPrompt(seg.prompt),
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

      // 当前类型不支持存储 cameraNote、actionNote、dialogueOrSubtitle
      // 将它们合并到 prompt 中以保留信息
      const enrichedPrompt = [
        seg.prompt,
        seg.cameraNote ? `[运镜] ${seg.cameraNote}` : '',
        seg.actionNote ? `[动作] ${seg.actionNote}` : '',
        seg.dialogueOrSubtitle ? `[字幕] ${seg.dialogueOrSubtitle}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      parsedSegments.push({
        id: randomUUID(),
        order: i + 1,
        title: seg.title,
        prompt: enrichedPrompt,
        mentionRefs,
        durationSeconds:
          typeof seg.durationSeconds === 'number' && seg.durationSeconds > 0
            ? seg.durationSeconds
            : SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
        videoUrl: null,
        status: 'idle' as const,
      })
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
      message: `第 ${episodeNumber} 集分镜脚本生成完成`,
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
