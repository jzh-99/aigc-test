import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaEpisodeOutline, ShortDramaState } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  estimateTextGenerationCredits,
  applyShortDramaEpisodeOutlinesBatchResult,
  buildShortDramaOutlineBatches,
  markShortDramaProjectFailed,
  type ShortDramaOutlineBatch,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { createShortDramaSSESession } from './_sse.js'
import { buildShortDramaStoryLineage } from './_script-source.js'
import {
  createShortDramaTextTaskBatch,
  heartbeatShortDramaTextTask,
  completeShortDramaTextTask,
  failShortDramaTextTask,
  TEXT_TASK_HEARTBEAT_INTERVAL_MS,
} from './_text-task.js'

// 分集分场剧本预估：输入提示词按实际长度计算，输出按每集约 5000 字估算。
const ESTIMATED_OUTPUT_CHARS_PER_EPISODE = 5000
const OUTLINE_BATCH_MAX_TOKENS = 16000

function formatExpectedEpisodeNumbers(from: number, to: number): string {
  const episodeNumbers: number[] = []
  for (let episodeNumber = from; episodeNumber <= to; episodeNumber += 1) {
    episodeNumbers.push(episodeNumber)
  }
  return episodeNumbers.join('、')
}

function parseEpisodeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return NaN

  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)

  const sceneLikeMatch = trimmed.match(/^(\d+)-\d+$/)
  if (sceneLikeMatch) return Number(sceneLikeMatch[1])

  return NaN
}

function buildEpisodeOutlinePrompts(
  state: ShortDramaState,
  batch: ShortDramaOutlineBatch
): { systemPrompt: string; userPrompt: string } {
  const storyLineage = buildShortDramaStoryLineage(state, batch.to)
  const expectedEpisodeNumbers = formatExpectedEpisodeNumbers(batch.from, batch.to)
  const systemPrompt = [
    '你是专业短剧编剧，擅长把系列设定拆成可拍摄的分场剧本。',
    `请根据剧本摘要生成第 ${batch.from}-${batch.to} 集的分集剧本。`,
    storyLineage ? '必须延续上方故事脉络，不得与已确定的概述产生剧情冲突。' : '',
    '只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown、代码块或额外解释。',
    `episodeNumber 必须是集数整数，只能填写 ${expectedEpisodeNumbers}，禁止写成 "1-1" 这类场号。`,
    'synopsis 不再写普通梗概，必须写成分场剧本正文，使用"### 场X-Y"作为场次标题。',
    '每场必须包含：时段、内/外、地点、出场人物、动作描写、对白，可按需要加入【字幕】、【闪回】、【闪回结束】、角色（vo）、角色（os）。',
    '动作描写使用"△ "开头；对白使用"角色名（语气/状态）：对白"。',
    '每场开头必须补一行【戏剧功能：...】，说明该场承担开场钩子、冲突升级、信息反转、主动选择、情绪余波或结尾钩子中的哪一种功能。',
    '每场必须写出【场记锚点：...】，记录本场开始和结束时人物站位、关键道具位置、门窗/桌椅/文件/手机等物件状态，为后续镜头切换和片段拆分保持连续。',
    '每集剧情长度必须能支撑约 2 分钟成片：整体分成 3-5 个完整场景，每场承担一个明确戏剧功能。',
    '每场必须有足够信息量，包含 3-6 条动作/对白/OS/VO 节点；每集总计至少 12-16 个可拆成视频片段的动作/对白节点。',
    '不要只写梗概式摘要；需要具体到镜头动作、人物反应、对白推进、场景转换、状态变化和结尾钩子。',
    '动作与情绪要使用可见细节，不要用"愤怒、悲伤、震惊"等抽象词直接代替表演；必须拆成眼神、呼吸、停顿、手部动作、身体重心变化。',
    '必须延续项目视觉风格；如果项目视觉风格是 2D/3D 动漫、漫画、插画、卡通、国漫、日漫、赛璐璐、黏土/粘土、盲盒、定格动画或虾仁动画风格，分集剧本中的画面动作、场景气质、灯光色彩和表演描述都必须按动画、插画、CG、黏土或对应风格语言书写，禁止写成真人摄影、写实剧照或影视实拍质感。',
  ].filter(Boolean).join('\n')

  const lineageBlock = storyLineage ? `${storyLineage}\n\n其中第 ${batch.from}-${batch.to} 集为本次需要生成分场剧本的集数，请依据上述脉络展开。\n\n` : ''
  const userPrompt = `${lineageBlock}剧本摘要：${state.script.refinedPrompt}\n\n项目视觉风格：${state.settings.style}\n画面比例：${state.settings.aspectRatio}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数整数，只能填写 ${expectedEpisodeNumbers}，不要填写场号\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 分场剧本正文，必须类似下面格式：\n### 场1-1\n日 内 旧教室\n【戏剧功能：开场钩子，建立拆迁压力和主角困境】\n出场人物：林微\n【场记锚点：场开始时林微站在教室门口，旧课桌堆在画面右侧；场结束时她走到第一排课桌旁，手按在刻字桌面上】\n【字幕：2024年，南方县城老中学，即将拆除】\n△ 阳光透过布满灰尘的窗户，墙上一个刺眼的红色"拆"字随风晃动。\n角色名（语气）：对白内容。\n角色名（os）：内心独白。\n\n### 场1-2\n夜 外 校园走廊\n【戏剧功能：冲突升级】\n出场人物：角色A、角色B\n【场记锚点：角色A靠近走廊左侧窗台，角色B挡在楼梯口，手机始终握在角色A右手】\n△ 动作与画面调度。\n角色A（压低声音）：对白内容。\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）\n\n长度与节奏要求：\n- 每集 synopsis 必须能支撑约 2 分钟成片，不要生成只能拍几十秒的短概要。\n- 每集整体分成 3-5 个场景，避免 8 个以上碎场；每个场景要有清晰戏剧功能，例如"开场钩子、冲突升级、信息反转、主动选择、结尾钩子"。\n- 每集至少写出 12-16 个清晰的动作/对白节点，方便后续按场内节拍拆成 10-12 个视频片段。\n- 每个场景至少包含 3-6 条"△"动作描写或对白/OS/VO，不要只有一两句概述。\n- 场号按"场${batch.from}-1、场${batch.from}-2..."书写；每场第一行写"日/夜 内/外 地点"，第二行写"【戏剧功能：...】"，第三行写"出场人物：..."，第四行写"【场记锚点：...】"。\n- 多用画面动作和人物对白推进剧情，少写概述性总结。\n- 动作描写要能被摄影和演员执行：写清人物从哪里来、看向哪里、哪只手拿着什么、动作结束停在哪里。\n- 视觉风格"${state.settings.style}"必须体现在场景选择、表演克制程度、镜头节奏、色彩和灯光上，不要只写剧情。\n- 每集要形成一个小冲突和结尾钩子。`

  return { systemPrompt, userPrompt }
}

function estimateEpisodeOutlineCredits(
  systemPrompt: string,
  userPrompt: string,
  batch: ShortDramaOutlineBatch
): number {
  const episodeCount = batch.to - batch.from + 1
  return estimateTextGenerationCredits(
    systemPrompt + userPrompt,
    episodeCount * ESTIMATED_OUTPUT_CHARS_PER_EPISODE
  )
}

export function parseEpisodeOutlineBatch(
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
    const episodeNumber = parseEpisodeNumber(ep.episodeNumber)
    if (
      !Number.isInteger(episodeNumber) ||
      episodeNumber < from ||
      episodeNumber > to ||
      typeof ep.title !== 'string' ||
      typeof ep.synopsis !== 'string' ||
      !Array.isArray(ep.characters) ||
      !Array.isArray(ep.scenes)
    ) {
      throw new Error(`第 ${from + index} 集的字段格式错误或缺少必需字段，请检查 episodeNumber、title、synopsis、characters、scenes`)
    }

    const dedupeStrings = (raw: unknown[]): string[] => {
      const seen = new Set<string>()
      const result: string[] = []
      for (const item of raw) {
        if (typeof item !== 'string') continue
        const trimmed = item.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        result.push(trimmed)
      }
      return result
    }

    return {
      episodeNumber,
      title: ep.title,
      summary: ep.synopsis,
      mentionedCharacters: dedupeStrings(ep.characters),
      mentionedScenes: dedupeStrings(ep.scenes),
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

    // 前置校验：分集概述必须已就绪（隐式锁定）
    if (state.script.episodeSummaries.length < state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成并锁定全部分集概述' },
      })
    }

    const episodeCount = state.settings.episodeCount
    const startEpisode = state.script.outlines.length + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
    // 只取下一批（单批次模式）
    const batch = batches[0]
    if (!batch) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集剧本已生成' },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-outlines`, { ttlSeconds: 480, autoRenew: false })
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '分集剧本正在生成中，请稍后刷新查看进度' },
      })
    }

    const { systemPrompt, userPrompt } = buildEpisodeOutlinePrompts(state, batch)
    const estimatedCredits = estimateEpisodeOutlineCredits(systemPrompt, userPrompt, batch)

    // 预冻结积分
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, estimatedCredits, '短剧分集剧本冻结')
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '积分冻结失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    try {
      state.script.status = 'generating'
      // 分集剧本批次请求独立状态：刷新后前端据此恢复加载态；重新生成时清空历史失败原因
      state.script.outlinesStatus = 'generating'
      state.script.outlinesErrorMessage = null
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, estimatedCredits, projectId, '剧本生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId }, '短剧分集大纲生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    // 创建文本任务记录（僵死自愈的进程外状态来源）+ 心跳定时器
    let textTaskId: string | null = null
    try {
      textTaskId = await createShortDramaTextTaskBatch({
        projectId,
        textType: 'episode-outlines',
        userId,
        teamId,
        workspaceId: project.workspace_id,
        creditAccountId,
        estimatedCredits,
      })
    } catch (error) {
      app.log.warn({ error, projectId }, '分集剧本文本任务记录创建失败，继续生成')
    }
    const heartbeatTimer = setInterval(() => {
      if (textTaskId) void heartbeatShortDramaTextTask(textTaskId).catch(() => {})
    }, TEXT_TASK_HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()

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

    // 标记业务是否已成功落库
    let persisted = false

    try {
      sendEvent('progress', {
        message: `开始生成第 ${batch.from}-${batch.to} 集剧本`,
        from: batch.from,
        to: batch.to,
        completedCount: state.script.outlines.length,
        totalCount: episodeCount,
      })

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, OUTLINE_BATCH_MAX_TOKENS, {
        onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
        onPing: sendPing,
        externalSignal: clientSignal,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.episode_outlines',
          endpoint: '/chat/completions',
        },
      })

      const previousState = JSON.parse(JSON.stringify(state)) as typeof state
      const outlines = parseEpisodeOutlineBatch(aiResponse, batch.from, batch.to)
      const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
      applyShortDramaEpisodeOutlinesBatchResult(state, outlines)

      try {
        const settledCredits = (await saveShortDramaStateAndSettleCredits({
          projectId,
          state,
          actualCredits,
          estimatedCredits,
          creditAccountId,
          userId,
          teamId,
          status: state.script.outlines.length >= episodeCount ? 'outline_ready' : undefined,
        })).settledCredits

        persisted = true

        // 文本任务记录标记完成
        if (textTaskId) await completeShortDramaTextTask(textTaskId, actualCredits).catch(() => {})

        sendEvent('progress', {
          message: `第 ${batch.from}-${batch.to} 集剧本生成完成`,
          from: batch.from,
          to: batch.to,
          completedCount: state.script.outlines.length,
          totalCount: episodeCount,
        })

        sendEvent('done', {
          success: true,
          outlines: state.script.outlines,
          credits: settledCredits,
          state,
        })
      } catch (error) {
        Object.assign(state, previousState)
        throw error
      }
    } catch (error) {
      if (persisted) {
        app.log.warn({ error, projectId }, '短剧分集剧本已生成成功，但向客户端推送结果失败')
      } else {
        await safeRefundCredits(app, teamId, creditAccountId, userId, estimatedCredits, projectId, `第 ${batch.from}-${batch.to} 集剧本生成失败`)
        state.script.status = 'failed'
        // 持久化分集剧本失败状态与原因，前端重进页面仍可见并可重试
        state.script.outlinesStatus = 'failed'
        state.script.outlinesErrorMessage = error instanceof Error ? error.message : '分集剧本生成失败'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ error: saveError, projectId }, '短剧分集剧本失败状态保存失败')
        })
        if (textTaskId) await failShortDramaTextTask(textTaskId).catch(() => {})
        app.log.error({ error, projectId, batch }, '短剧分集剧本批次生成失败')
        sendEvent('error', {
          code: 'AI_ERROR',
          message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
          completedCount: state.script.outlines.length,
          totalCount: episodeCount,
        })
      }
    } finally {
      clearInterval(heartbeatTimer)
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
  })
}

export default route
