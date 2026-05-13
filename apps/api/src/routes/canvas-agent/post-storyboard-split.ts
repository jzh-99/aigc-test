import type { FastifyPluginAsync } from 'fastify'

// POST /canvas-agent/storyboard-split — AI 分镜拆分
const route: FastifyPluginAsync = async (app) => {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? ''
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.NANO_BANANA_MODEL ?? ''
  const STORYBOARD_SPLIT_SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_STORYBOARD_SPLIT ?? ''

  app.post<{
    Body: { script: string; shotCount: number }
  }>(
    '/canvas-agent/storyboard-split',
    {
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
      const countInstruction = shotCount > 0 ? `分割成 ${shotCount} 个分镜` : '根据剧本内容自动决定分镜数量（每个分镜约10秒）'

      const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 90_000)

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
              { role: 'system', content: STORYBOARD_SPLIT_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 8000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Storyboard splitter LLM error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const raw = data.choices?.[0]?.message?.content ?? ''

      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('no JSON')
        const parsed = JSON.parse(jsonMatch[0]) as { shots?: Array<{ id?: string; label?: string; content?: string }> }
        const shots = (parsed.shots ?? []).map((s, i) => ({
          id: s.id ?? `shot_${i + 1}`,
          label: s.label ?? `镜头${i + 1}`,
          content: s.content ?? '',
        }))
        return reply.send({ success: true, shots })
      } catch {
        return reply.status(502).send({ success: false, error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
      }
    },
  )
}

export default route
