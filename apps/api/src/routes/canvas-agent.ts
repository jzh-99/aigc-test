import type { FastifyInstance } from 'fastify'
import { encryptProxyUrl } from '../lib/storage.js'

const PROXY_URL_PREFIX = '/api/v1/assets/proxy?token='
const BASE64_PROXY_PREFIX = `base64:${PROXY_URL_PREFIX}`

type ContentPart = { type?: unknown; [key: string]: unknown }

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function toAbsoluteUrl(pathOrUrl: string, baseUrl: string): string | null {
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl
  if (pathOrUrl.startsWith('/')) {
    if (!baseUrl) return null
    return `${normalizeBaseUrl(baseUrl)}${pathOrUrl}`
  }
  return null
}

function normalizeContentForUpstream(
  content: string | Array<{ type: string; [key: string]: unknown }>,
  publicBaseUrl: string,
): {
  content: string | Array<{ type: string; [key: string]: unknown }>
  totalMediaCount: number
  rewrittenMediaCount: number
  invalidMediaCount: number
} {
  if (typeof content === 'string') {
    return { content, totalMediaCount: 0, rewrittenMediaCount: 0, invalidMediaCount: 0 }
  }

  let totalMediaCount = 0
  let rewrittenMediaCount = 0
  let invalidMediaCount = 0

  const normalized = (content as ContentPart[]).map((part) => {
    const mediaType = part.type
    if (mediaType !== 'image_url' && mediaType !== 'video_url' && mediaType !== 'audio_url') return part

    totalMediaCount++
    const mediaKey = mediaType as 'image_url' | 'video_url' | 'audio_url'
    const mediaVal = part[mediaKey]
    if (!mediaVal || typeof mediaVal !== 'object') {
      invalidMediaCount++
      return part
    }

    const originalUrl = (mediaVal as { url?: unknown }).url
    if (typeof originalUrl !== 'string' || !originalUrl.trim()) {
      invalidMediaCount++
      return part
    }

    let nextUrl = originalUrl.trim()
    let changed = false

    if (nextUrl.startsWith(BASE64_PROXY_PREFIX)) {
      nextUrl = nextUrl.slice('base64:'.length)
      changed = true
    }

    if (nextUrl.startsWith('http://')) {
      if (!publicBaseUrl) {
        invalidMediaCount++
        return part
      }
      nextUrl = `${normalizeBaseUrl(publicBaseUrl)}${PROXY_URL_PREFIX}${encryptProxyUrl(nextUrl)}`
      changed = true
    } else if (nextUrl.startsWith('/')) {
      const absolute = toAbsoluteUrl(nextUrl, publicBaseUrl)
      if (!absolute) {
        invalidMediaCount++
        return part
      }
      nextUrl = absolute
      changed = true
    }

    if (!/^https?:\/\//i.test(nextUrl) && !nextUrl.startsWith('data:')) {
      invalidMediaCount++
      return part
    }

    if (changed) rewrittenMediaCount++

    return {
      ...part,
      [mediaKey]: {
        ...(mediaVal as Record<string, unknown>),
        url: nextUrl,
      },
    }
  })

  return {
    content: normalized as Array<{ type: string; [key: string]: unknown }>,
    totalMediaCount,
    rewrittenMediaCount,
    invalidMediaCount,
  }
}

export async function canvasAgentRoutes(app: FastifyInstance): Promise<void> {
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

      // Append canvas context to the user message so LLM always sees current canvas state
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

  // ── Script writer endpoint ────────────────────────────────────────────────

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
        // Fallback: return raw text as script
        return reply.send({ success: true, script: raw, characters: [], scenes: [] })
      }
    },
  )

  // ── Storyboard splitter endpoint ──────────────────────────────────────────

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
