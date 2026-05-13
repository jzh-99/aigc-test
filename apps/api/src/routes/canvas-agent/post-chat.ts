import type { FastifyPluginAsync } from 'fastify'
import { normalizeContentForUpstream, firstHeader } from './_shared.js'

// POST /canvas-agent/chat — 画布 AI 助手对话（SSE 流式响应）
const route: FastifyPluginAsync = async (app) => {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? ''
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.NANO_BANANA_MODEL ?? ''
  const AI_SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_AGENT ?? ''

  app.post<{
    Body: {
      content: string | Array<{ type: string; [key: string]: unknown }>
      canvasContext: {
        nodes: Array<{
          id: string
          type: string
          label: string
          configSummary: string
          hasOutput: boolean
          selectedOutputId: string | null
        }>
        edges: Array<{ source: string; target: string }>
      }
      history: Array<{ role: 'user' | 'assistant'; content: string }>
    }
  }>(
    '/canvas-agent/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content', 'canvasContext'],
          properties: {
            content: {},
            canvasContext: {
              type: 'object',
              required: ['nodes', 'edges'],
              properties: {
                nodes: { type: 'array' },
                edges: { type: 'array' },
              },
            },
            history: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: 30000 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { content, canvasContext, history = [] } = request.body

      // 构建公开 base URL（用于媒体 URL 规范化）
      const configuredBaseUrl =
        process.env.AI_UPLOAD_BASE_URL
        ?? process.env.AVATAR_UPLOAD_BASE_URL
        ?? process.env.NEXT_PUBLIC_API_URL
        ?? ''

      const forwardedProto = firstHeader(request.headers['x-forwarded-proto'] as string | string[] | undefined)
      const forwardedHost = firstHeader(request.headers['x-forwarded-host'] as string | string[] | undefined)
      const host = firstHeader(request.headers.host as string | string[] | undefined)
      const fallbackBaseUrl =
        forwardedProto && forwardedHost
          ? `${forwardedProto}://${forwardedHost}`
          : host
            ? `${request.protocol}://${host}`
            : ''
      const publicBaseUrl = configuredBaseUrl || fallbackBaseUrl

      const normalized = normalizeContentForUpstream(content, publicBaseUrl)
      if (normalized.invalidMediaCount > 0) {
        app.log.warn(
          {
            totalMediaCount: normalized.totalMediaCount,
            rewrittenMediaCount: normalized.rewrittenMediaCount,
            invalidMediaCount: normalized.invalidMediaCount,
          },
          'Canvas agent media URL normalization failed',
        )
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_MEDIA_URL',
            message: '引用素材地址无效，请重新选择素材后再试',
          },
        })
      }

      if (normalized.rewrittenMediaCount > 0) {
        app.log.info(
          {
            totalMediaCount: normalized.totalMediaCount,
            rewrittenMediaCount: normalized.rewrittenMediaCount,
          },
          'Canvas agent media URL normalized',
        )
      }

      // 将画布上下文追加到用户消息末尾，让 LLM 始终感知当前画布状态
      const canvasContextStr = JSON.stringify(canvasContext, null, 2)
      const userContentWithContext = typeof normalized.content === 'string'
        ? `${normalized.content}\n\n<canvas_context>\n${canvasContextStr}\n</canvas_context>`
        : [
            ...(normalized.content as unknown[]),
            { type: 'text', text: `\n\n<canvas_context>\n${canvasContextStr}\n</canvas_context>` },
          ]

      const messages: unknown[] = [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContentWithContext },
      ]

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 300_000)

      let geminiRes: Response
      try {
        geminiRes = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({ model: AI_MODEL, messages, stream: true, max_tokens: 8000 }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text()
        app.log.error({ status: geminiRes.status, body: errText }, 'Canvas agent Gemini error')
        return reply.status(502).send({
          success: false,
          error: { code: 'AI_ERROR', message: 'AI助手暂时不可用，请稍后重试' },
        })
      }

      // 设置 SSE 响应头
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const reader = geminiRes.body!.getReader()
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
