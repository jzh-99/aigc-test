import type { FastifyPluginAsync } from 'fastify'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  applyShortDramaScriptSummaryResult,
  saveShortDramaProjectState,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'

// 保守预估：结构化剧集设定内容较长，预冻结 25 积分
const ESTIMATED_CREDITS = 25

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/summary', async (request, reply) => {
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

    // 检查是否已有 refinedPrompt（兼容当前类型结构）
    if (state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '剧本摘要已生成' },
      })
    }

    // 检查是否有原始创意
    if (!state.script.originalPrompt?.trim()) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '缺少原始创意' },
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

    state.script.status = 'generating'
    await saveShortDramaProjectState(projectId, state, 0)

    // 调用 AI 生成结构化剧集设定
    const REDACTED = [
      '你是专业短剧编剧、导演和系列剧开发策划，熟悉短剧平台叙事节奏、制作可行性和视听表达。',
      '请根据用户创意生成适合连续短剧制作的中文结构化剧集设定，既要有强情节爽点，也要能指导导演、摄影、妆造、布景、灯光等岗位进入后续创作。',
      '只输出 JSON 对象，字段为 title 和 summary，不要输出 markdown、代码块或额外解释。',
      'summary 必须是可直接展示给用户的纯文本，使用清晰的中文小标题和换行分段。',
      'summary 必须包含：集数、故事类型、目标受众、核心梗、一句话故事、人物小传、故事梗概、导演阐述、影像风格、妆造方向、核心场景与布景、灯光气质。',
      '人物小传需要覆盖主要角色，每个角色包含：角色类型、视觉形象、核心标签、身份背景、成长经历、性格特点、角色关系、成长弧线。',
      '人物小传中的“视觉形象”必须能直接指导角色定妆照：年龄段、性别、体型、脸型五官、肤色、发型、服装年代感、妆容状态和不可漂移的识别点都要写清楚。',
      '导演阐述需要说明表演风格、情绪节奏和每阶段观众期待；影像风格需要说明镜头倾向、色彩、构图和运动方式。',
      '妆造方向需要说明主要角色的服装、发型、妆面和身份变化；核心场景与布景需要说明地点质感、关键道具和可重复使用的主场景。',
      '核心场景与布景必须能指导场景概念图：场景类型、空间结构、陈设布置、年代还原、色彩基调、关键道具位置和可复用机位都要明确。',
      '灯光气质需要说明日夜、冷暖、明暗反差、光线来源、人物面部受光方向和情绪用途，避免只写“高级感、电影感”等空泛词。',
      `项目选择的视觉风格是“${state.settings.style}”，必须把它转译成具体的摄影、灯光、布景、妆造、表演和剪辑节奏要求，供后续素材图、片段脚本、视频生成继续引用。`,
      '内容要具体、可执行，避免空泛评价；角色关系可以使用“起点 -> [事件] -> 变化”的链路表达。',
    ].join('\n')

    const userPrompt = `用户创意：${state.script.originalPrompt}\n\n项目设置：\n- 集数：${state.settings.episodeCount}\n- 视觉风格：${state.settings.style}\n- 画面比例：${state.settings.aspectRatio}\n\n请生成剧本摘要，返回 JSON：\n{\n  "title": "短剧名",\n  "summary": "集数\\n${state.settings.episodeCount}\\n故事类型\\n现实权谋+重生改命+校园青春\\n目标受众\\n男频 / 大众\\n核心梗\\n...\\n一句话故事\\n...\\n人物小传\\n角色名\\n角色类型：...\\n视觉形象：...\\n核心标签：...\\n身份背景：...\\n成长经历：...\\n性格特点：...\\n角色关系：...\\n成长弧线：...\\n故事梗概\\n...\\n导演阐述\\n...\\n影像风格\\n...\\n妆造方向\\n...\\n核心场景与布景\\n...\\n灯光气质\\n..."\n}\n\n要求：\n- summary 按上述结构输出，不要只写 200-500 字短概要。\n- 人物小传至少包含主角和 3-5 个关键配角。\n- 故事梗概要说明世界背景、主线冲突、关系变化、阶段性胜利和后续钩子。\n- 导演阐述要能指导表演和节奏，影像风格要能指导摄影，妆造/布景/灯光要能指导后续素材与片段脚本生成。\n- 请按专业制作圣经写法输出：编剧视角负责冲突和爽点，导演视角负责表演和节奏，摄影视角负责景别/机位/运动，美术视角负责空间和道具，妆造视角负责角色阶段识别，灯光视角负责光源/色温/明暗反差。\n- 所有专业描述必须落到可见画面，不要使用“氛围高级、质感拉满、情绪到位”这类不可执行短语。\n- 不要照抄示例中的具体人物，除非用户创意本身已经明确提到。`

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

    try {
      sendEvent('progress', { message: '正在生成剧本摘要' })

      const aiResponse = await callQwenForTextStream(REDACTED, userPrompt, 8000, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.summary',
          endpoint: '/chat/completions',
        },
      })

      const parsed = parseAndValidateJson(aiResponse, ['title', 'summary'])
      if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
        throw new Error('AI 返回的 title 或 summary 格式错误')
      }

      const actualCredits = calculateTextGenerationCredits(aiResponse)
      applyShortDramaScriptSummaryResult(state, {
        title: parsed.title,
        summary: parsed.summary,
      })

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: 'summary_ready',
        title: parsed.title,
      })).settledCredits

      sendEvent('done', {
        success: true,
        title: parsed.title,
        summary: parsed.summary,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '摘要生成失败')
      state.script.status = 'failed'
      await saveShortDramaProjectState(projectId, state, 0).catch((saveError) => {
        app.log.error({ saveError, projectId }, '短剧摘要失败状态保存失败')
      })
      app.log.error({ error, projectId }, '短剧摘要流式生成失败')
      sendEvent('error', {
        code: 'AI_ERROR',
        message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
      })
    } finally {
      reply.raw.end()
    }
  })
}

export default route
