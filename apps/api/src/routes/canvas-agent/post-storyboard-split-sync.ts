import type { FastifyPluginAsync } from 'fastify'
import { qwenConfig, systemConfig } from '@aigc/nacos-config'
import { recordLlmProviderCall } from '../../lib/provider-api-audit.js'

// POST /canvas-agent/storyboard-split-sync — 同步分镜拆分（供 wizard 流程使用，不走队列）
const route: FastifyPluginAsync = async (app) => {
  const SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_STORYBOARD_SPLIT ?? ''
  const STORYBOARD_SEGMENT_DURATION_INSTRUCTION = '每个分镜约3-5秒，该时段内展示的分镜不宜过长'
  const CHINESE_STORYBOARD_OUTPUT_INSTRUCTION = [
    '语言要求：所有输出内容必须使用简体中文。',
    '尤其是 compositionPrompt（构图提示词）和 cameraMotionPrompt（运镜提示词）必须是中文完整句子，不要输出英文短语、英文镜头术语或中英混写。',
    '如需表达 shot type、camera movement、lighting、composition 等概念，请翻译为自然中文，例如“中景”“缓慢推进”“柔和侧光”“三分法构图”。',
  ].join('\n')
  const STORYBOARD_SYSTEM_PROMPT = [
    SYSTEM_PROMPT,
    CHINESE_STORYBOARD_OUTPUT_INSTRUCTION,
    `分镜时长要求：${STORYBOARD_SEGMENT_DURATION_INSTRUCTION}。`,
  ].filter(Boolean).join('\n\n')

  app.post<{
    Body: { script: string; shotCount: number }
  }>(
    '/canvas-agent/storyboard-split-sync',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['script', 'shotCount'],
          properties: {
            script: { type: 'string', maxLength: 10000 },
            shotCount: { type: 'number', minimum: 0, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const { script, shotCount } = request.body
      // 每次请求实时读取 Nacos getter，支持热更（改 key/model 免重启）。
      const API_URL = qwenConfig.apiUrl
      const API_KEY = qwenConfig.apiKey
      const MODEL = qwenConfig.model
      const endpoint = '/chat/completions'

      const countInstruction = shotCount > 0
        ? `分割成 ${shotCount} 个分镜，每个分镜约3-5秒`
        : `根据剧本内容自动决定分镜数量，${STORYBOARD_SEGMENT_DURATION_INSTRUCTION}`
      const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`
      const requestPayload = {
        model: MODEL,
        messages: [
          { role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        enable_thinking: true,
        max_tokens: systemConfig.canvasAgentStoryboardMaxTokens,
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180_000)
      const startedAt = Date.now()

      let res: Response
      try {
        res = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await recordLlmProviderCall({
          userId: request.user.id,
          module: 'storyboard',
          provider: 'qwen',
          model: MODEL,
          operation: 'storyboard.split.sync',
          endpoint,
          requestPayload,
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: message,
        })
        throw error
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        await recordLlmProviderCall({
          userId: request.user.id,
          module: 'storyboard',
          provider: 'qwen',
          model: MODEL,
          operation: 'storyboard.split.sync',
          endpoint,
          requestPayload,
          responseStatus: res.status,
          responsePayload: { body: errText },
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: `Storyboard split sync LLM HTTP ${res.status}: ${errText.slice(0, 500)}`,
        })
        app.log.error({ status: res.status, body: errText }, 'Storyboard split sync LLM error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }
      await recordLlmProviderCall({
        userId: request.user.id,
        module: 'storyboard',
        provider: 'qwen',
        model: MODEL,
        operation: 'storyboard.split.sync',
        endpoint,
        requestPayload,
        responseStatus: res.status,
        responsePayload: data,
        durationMs: Date.now() - startedAt,
        status: 'success',
      })
      const raw = data.choices?.[0]?.message?.content ?? ''

      const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        return reply.status(502).send({ success: false, error: { code: 'AI_PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
      }

      try {
        const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
        const shots = parsed.map((s, i) => ({
          shotNumber: (s.shotNumber as number) ?? i + 1,
          duration: (s.duration as number) ?? 4,
          sceneDescription: (s.sceneDescription as string) ?? '',
          character1: (s.character1 as string) ?? '',
          characterDesc1: (s.characterDesc1 as string) ?? '',
          character2: (s.character2 as string) ?? '',
          characterDesc2: (s.characterDesc2 as string) ?? '',
          reference: (s.reference as string) ?? '',
          shotType: (s.shotType as string) ?? '',
          characterAction: (s.characterAction as string) ?? '',
          emotion: (s.emotion as string) ?? '',
          sceneTags: Array.isArray(s.sceneTags) ? (s.sceneTags as string[]) : [],
          lightAtmosphere: (s.lightAtmosphere as string) ?? '',
          soundEffect: (s.soundEffect as string) ?? '',
          dialogue: (s.dialogue as string) ?? '无',
          compositionPrompt: (s.compositionPrompt as string) ?? '',
          cameraMotionPrompt: (s.cameraMotionPrompt as string) ?? '',
        }))
        return reply.send({ success: true, shots })
      } catch {
        return reply.status(502).send({ success: false, error: { code: 'AI_PARSE_ERROR', message: 'AI返回解析失败，请重试' } })
      }
    },
  )
}

export default route
