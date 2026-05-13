import type { FastifyPluginAsync } from 'fastify'
import { callLLM, parseJSON } from './_shared.js'

// POST /video-studio/script-write — AI 生成视频剧本
const route: FastifyPluginAsync = async (app) => {
  const SCRIPT_SYSTEM_PROMPT = process.env.AI_PROMPT_STUDIO_SCRIPT ?? ''

  app.post<{
    Body: { description: string; style: string; duration: number; feedback?: string }
  }>(
    '/video-studio/script-write',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description', 'style', 'duration'],
          properties: {
            description: { type: 'string', maxLength: 3000 },
            style: { type: 'string', maxLength: 200 },
            duration: { type: 'number', minimum: 10, maximum: 600 },
            feedback: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { description, style, duration, feedback } = request.body
      const actCount = Math.ceil(duration / 12)
      let userPrompt = `风格：${style}\n目标时长：${duration}秒\n剧本幕数：${actCount}幕（每幕对应后续一个10-15秒长片段）\n\n故事描述：${description}`
      if (feedback) userPrompt += `\n\n修改意见：${feedback}`

      try {
        const raw = await callLLM(SCRIPT_SYSTEM_PROMPT, userPrompt, 6000)
        type ScriptCharacter = { name: string; description: string; voiceDescription?: string; visualPresence?: boolean }
        type ScriptResult = { title?: string; actCount?: number; script?: string; characters?: ScriptCharacter[]; scenes?: Array<{ name: string; description: string }> }
        const parsed = parseJSON<ScriptResult>(raw)
        return reply.send({
          success: true,
          title: parsed?.title ?? '',
          actCount: parsed?.actCount ?? actCount,
          script: parsed?.script ?? raw,
          characters: parsed?.characters ?? [],
          scenes: parsed?.scenes ?? [],
        })
      } catch (err) {
        app.log.error(err, 'video-studio script-write error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )
}

export default route
