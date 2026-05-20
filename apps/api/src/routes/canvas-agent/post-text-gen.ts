import type { FastifyPluginAsync } from 'fastify'

// POST /canvas-agent/text-gen — 画布文本节点 AI 生成（Qwen SSE 流式）
const route: FastifyPluginAsync = async (app) => {
  const API_URL = process.env.QWEN_API_URL ?? ''
  const API_KEY = process.env.QWEN_API_KEY ?? ''
  const MODEL = process.env.QWEN_MODEL ?? 'qwen3-6b-plus'

  app.post<{ Body: { prompt: string } }>(
    '/canvas-agent/text-gen',
    {
      schema: {
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { prompt } = request.body

      if (!API_URL || !API_KEY) {
        return reply.status(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Qwen 服务未配置' } })
      }

      const controller = new AbortController()
      // Qwen 流式接口，超时放宽到 120s
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
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 2000,
            // Qwen3 系列默认开启深度思考，文本节点不需要，显式关闭
            enable_thinking: false,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Qwen text-gen error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      // 设置 SSE 响应头，透传 Qwen 的流
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          reply.raw.write(decoder.decode(value, { stream: true }))
        }
      } finally {
        reply.raw.end()
      }
    },
  )
}

export default route
