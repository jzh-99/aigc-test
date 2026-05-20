import type { FastifyPluginAsync } from 'fastify'

// POST /canvas-agent/storyboard-split — AI 分镜拆分（Qwen + thinking）
const route: FastifyPluginAsync = async (app) => {
  const API_URL = process.env.QWEN_API_URL ?? ''
  const API_KEY = process.env.QWEN_API_KEY ?? ''
  const MODEL = process.env.QWEN_MODEL ?? 'qwen3-6b-plus'
  const SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_STORYBOARD_SPLIT ?? ''

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
      if (!API_URL || !API_KEY) {
        return reply.status(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Qwen 服务未配置' } })
      }

      const { script, shotCount } = request.body
      const countInstruction = shotCount > 0
        ? `分割成 ${shotCount} 个分镜`
        : '根据剧本内容自动决定分镜数量（每个分镜约10秒）'

      const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120_000)

      let res: Response
      try {
        res = await fetch(`${API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            enable_thinking: true,
            max_tokens: 16000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Storyboard splitter Qwen error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      // thinking 模式下 content 可能包含 <think>...</think> 标签，需先剔除
      const raw = (data.choices?.[0]?.message?.content ?? '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim()

      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error('no JSON array')
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
          sceneTags: Array.isArray(s.sceneTags) ? s.sceneTags as string[] : [],
          lightAtmosphere: (s.lightAtmosphere as string) ?? '',
          soundEffect: (s.soundEffect as string) ?? '',
          dialogue: (s.dialogue as string) ?? '无',
          compositionPrompt: (s.compositionPrompt as string) ?? '',
          cameraMotionPrompt: (s.cameraMotionPrompt as string) ?? '',
        }))
        return reply.send({ success: true, shots })
      } catch {
        app.log.error({ raw }, 'Storyboard splitter parse error')
        return reply.status(502).send({ success: false, error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
      }
    },
  )
}

export default route
