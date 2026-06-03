import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaEpisodeOutline } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  applyShortDramaEpisodeOutlinesBatchResult,
  buildShortDramaOutlineBatches,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：分集分场剧本需要支撑约 2 分钟成片
const ESTIMATED_CREDITS = 50
const OUTLINE_BATCH_MAX_TOKENS = 16000

function parseEpisodeOutlineBatch(
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
    if (
      typeof ep.episodeNumber !== 'number' ||
      typeof ep.title !== 'string' ||
      typeof ep.logline !== 'string' ||
      typeof ep.synopsis !== 'string' ||
      !Array.isArray(ep.characters) ||
      !Array.isArray(ep.scenes) ||
      typeof ep.hook !== 'string'
    ) {
      throw new Error(`第 ${from + index} 集的字段格式错误或缺少必需字段`)
    }

    return {
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      summary: ep.synopsis,
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

    const episodeCount = state.settings.episodeCount
    const startEpisode = state.script.outlines.length + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)

    state.script.status = 'generating'
    await saveShortDramaProjectState(projectId, state, 0)

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

    let completedCount = state.script.outlines.length
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
          warningMessage = 'A豆余额不足，已停止生成后续大纲。已保存已完成的分集大纲，请充值后点击「继续生成大纲」生成剩余集数。'
          sendEvent('warning', {
            message: warningMessage,
            completedCount,
            totalCount: episodeCount,
            remainingCount: episodeCount - completedCount,
          })
          break
        }

        sendEvent('progress', {
          message: `开始生成第 ${batch.from}-${batch.to} 集大纲`,
          from: batch.from,
          to: batch.to,
          completedCount,
          totalCount: episodeCount,
        })

        const systemPrompt = [
          '你是专业短剧编剧，擅长把系列设定拆成可拍摄的分场剧本。',
          `请根据剧本摘要生成第 ${batch.from}-${batch.to} 集的分集剧本。`,
          '只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown、代码块或额外解释。',
          'synopsis 不再写普通梗概，必须写成分场剧本正文，使用”### 场X-Y”作为场次标题。',
          '每场必须包含：时段、内/外、地点、出场人物、动作描写、对白，可按需要加入【字幕】、【闪回】、【闪回结束】、角色（vo）、角色（os）。',
          '动作描写使用”△ “开头；对白使用”角色名（语气/状态）：对白”。',
          '每集剧情长度必须能支撑约 2 分钟成片：整体分成 3-5 个完整场景，每场承担一个明确戏剧功能。',
          '每场必须有足够信息量，包含 3-6 条动作/对白/OS/VO 节点；每集总计至少 12-16 个可拆成视频片段的动作/对白节点。',
          '不要只写梗概式摘要；需要具体到镜头动作、人物反应、对白推进、场景转换和结尾钩子。',
        ].join('\n')
        const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数（${batch.from}-${batch.to}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 分场剧本正文，必须类似下面格式：\n### 场1-1\n日 内 旧教室\n出场人物：林微\n【字幕：2024年，南方县城老中学，即将拆除】\n△ 阳光透过布满灰尘的窗户，墙上一个刺眼的红色”拆”字随风晃动。\n角色名（语气）：对白内容。\n角色名（os）：内心独白。\n\n### 场1-2\n夜 外 校园走廊\n出场人物：角色A、角色B\n△ 动作与画面调度。\n角色A（压低声音）：对白内容。\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）\n\n长度与节奏要求：\n- 每集 synopsis 必须能支撑约 2 分钟成片，不要生成只能拍几十秒的短概要。\n- 每集整体分成 3-5 个场景，避免 8 个以上碎场；每个场景要有清晰戏剧功能，例如”开场钩子、冲突升级、信息反转、主动选择、结尾钩子”。\n- 每集至少写出 12-16 个清晰的动作/对白节点，方便后续按场内节拍拆成 10-12 个视频片段。\n- 每个场景至少包含 3-6 条”△”动作描写或对白/OS/VO，不要只有一两句概述。\n- 场号按”场${batch.from}-1、场${batch.from}-2...”书写；每场第一行写”日/夜 内/外 地点”，第二行写”出场人物：...”。\n- 多用画面动作和人物对白推进剧情，少写概述性总结。\n- 每集要形成一个小冲突和结尾钩子。`

        try {
          const aiResponse = await callDoubaoForTextStream(systemPrompt, userPrompt, OUTLINE_BATCH_MAX_TOKENS, {
            onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
            onPing: sendPing,
            audit: {
              userId,
              teamId,
              workspaceId: project.workspace_id,
              module: 'short_drama',
              provider: 'doubao',
              operation: 'script.episode_outlines',
              endpoint: '/chat/completions',
            },
          })

          const previousState = JSON.parse(JSON.stringify(state)) as typeof state
          const outlines = parseEpisodeOutlineBatch(aiResponse, batch.from, batch.to)
          const actualCredits = calculateTextGenerationCredits(aiResponse)
          applyShortDramaEpisodeOutlinesBatchResult(state, outlines)

          try {
            const settledCredits = (await saveShortDramaStateAndSettleCredits({
              projectId,
              state,
              actualCredits,
              estimatedCredits: ESTIMATED_CREDITS,
              creditAccountId,
              userId,
              teamId,
              status: state.script.outlines.length >= episodeCount ? 'outline_ready' : undefined,
            })).settledCredits

            totalCredits += settledCredits
          } catch (error) {
            Object.assign(state, previousState)
            throw error
          }
          completedCount = state.script.outlines.length

          sendEvent('progress', {
            message: `第 ${batch.from}-${batch.to} 集大纲生成完成`,
            from: batch.from,
            to: batch.to,
            completedCount,
            totalCount: episodeCount,
          })
        } catch (error) {
          await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集大纲生成失败`)
          app.log.error({ error, projectId, batch }, '短剧分集大纲批次生成失败')
          state.script.status = 'failed'
          await saveShortDramaProjectState(projectId, state, 0).catch((saveError) => {
            app.log.error({ error: saveError, projectId }, '短剧分集大纲失败状态保存失败')
          })

          sendEvent('error', {
            code: 'AI_ERROR',
            message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
            completedCount,
            totalCount: episodeCount,
          })
          return
        }
      }

      const partial = stoppedByBalance || state.script.outlines.length < episodeCount
      if (partial && warningMessage) {
        state.script.status = 'failed'
        await saveShortDramaProjectState(projectId, state, 0).catch((saveError) => {
          app.log.error({ error: saveError, projectId }, '短剧分集大纲暂停状态保存失败')
        })

        sendEvent('done', {
          success: true,
          partial: true,
          warning: warningMessage,
          completedCount,
          totalCount: episodeCount,
          remainingCount: episodeCount - completedCount,
          credits: totalCredits,
          state,
        })
      } else {
        sendEvent('done', {
          success: true,
          partial: false,
          outlines: state.script.outlines,
          credits: totalCredits,
          state,
        })
      }
    } finally {
      reply.raw.end()
    }
  })
}

export default route
