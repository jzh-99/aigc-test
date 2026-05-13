import type { FastifyPluginAsync } from 'fastify'

// POST /canvas-agent/script-write — AI 剧本生成
const route: FastifyPluginAsync = async (app) => {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? ''
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.NANO_BANANA_MODEL ?? ''
  const SCRIPT_WRITER_SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_SCRIPT_WRITER ?? ''

  app.post<{
    Body: { description: string; style: string; duration: number }
  }>(
    '/canvas-agent/script-write',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description', 'style', 'duration'],
          properties: {
            description: { type: 'string', maxLength: 2000 },
            style: { type: 'string', maxLength: 100 },
            duration: { type: 'number', minimum: 10, maximum: 600 },
          },
        },
      },
    },
    async (request, reply) => {
      const { description, style, duration } = request.body
      const shotCount = Math.ceil(duration / 10)

      const userPrompt = `风格：${style}\n目标时长：${duration}秒（约${shotCount}个镜头）\n\n用户描述：${description}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)

      let res: Response
      try {
        res = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: 'system', content: SCRIPT_WRITER_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 4000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Script writer LLM error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const raw = data.choices?.[0]?.message?.content ?? ''

      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('no JSON')
        const parsed = JSON.parse(jsonMatch[0]) as { script?: string; characters?: string[]; scenes?: string[] }
        return reply.send({
          success: true,
          script: parsed.script ?? raw,
          characters: parsed.characters ?? [],
          scenes: parsed.scenes ?? [],
        })
      } catch {
        // 降级：直接返回原始文本作为剧本
        return reply.send({ success: true, script: raw, characters: [], scenes: [] })
      }
    },
  )
}

export default route
