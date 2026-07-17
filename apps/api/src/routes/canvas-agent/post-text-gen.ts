import type { FastifyPluginAsync } from 'fastify'
import {
  recordLlmProviderCall,
  summarizeLlmStreamChunk,
  type LlmStreamSummary,
} from '../../lib/provider-api-audit.js'

// POST /canvas-agent/text-gen — 画布文本节点 AI 生成（Qwen SSE 流式）
const route: FastifyPluginAsync = async (app) => {
  const API_URL = process.env.QWEN_API_URL ?? ''
  const API_KEY = process.env.QWEN_API_KEY ?? ''
  const MODEL = process.env.QWEN_MODEL ?? 'qwen3.6-plus'

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
      const endpoint = '/chat/completions'

      if (!API_URL || !API_KEY) {
        return reply.status(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Qwen 服务未配置' } })
      }

      const requestPayload = {
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: 2000,
        enable_thinking: false,
      }
      const controller = new AbortController()
      // Qwen 流式接口，超时放宽到 120s
      const timer = setTimeout(() => controller.abort(), 120_000)
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
          module: 'agent',
          provider: 'qwen',
          model: MODEL,
          operation: 'text.generate',
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
          module: 'agent',
          provider: 'qwen',
          model: MODEL,
          operation: 'text.generate',
          endpoint,
          requestPayload,
          responseStatus: res.status,
          responsePayload: { body: errText },
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: `Qwen text-gen HTTP ${res.status}: ${errText.slice(0, 500)}`,
        })
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
      const summary: LlmStreamSummary = {
        stream: true,
        chunk_count: 0,
        response_bytes: 0,
        text_preview: '',
        finished: false,
      }
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          summarizeLlmStreamChunk(summary, chunk)
          reply.raw.write(chunk)
        }
        summary.finished = true
        await recordLlmProviderCall({
          userId: request.user.id,
          module: 'agent',
          provider: 'qwen',
          model: MODEL,
          operation: 'text.generate',
          endpoint,
          requestPayload,
          responseStatus: res.status,
          responsePayload: summary,
          durationMs: Date.now() - startedAt,
          status: 'success',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await recordLlmProviderCall({
          userId: request.user.id,
          module: 'agent',
          provider: 'qwen',
          model: MODEL,
          operation: 'text.generate',
          endpoint,
          requestPayload,
          responseStatus: res.status,
          responsePayload: summary,
          durationMs: Date.now() - startedAt,
          status: 'failed',
          errorMessage: message,
        })
        throw error
      } finally {
        reply.raw.end()
      }
    },
  )
}

export default route
