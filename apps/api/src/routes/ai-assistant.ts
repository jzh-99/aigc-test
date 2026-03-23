import type { FastifyInstance } from 'fastify'
import { createWriteStream, createReadStream } from 'node:fs'
import { unlink, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'

const UPLOAD_DIR = '/tmp/ai-uploads'
const MAX_VIDEO_AGE_MS = 15 * 60 * 1000 // 15 minutes
const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100 MB

const SYSTEM_PROMPT = `你是 Toby.AI 专业创作助手，支持：
1. 根据描述设计中英双语提示词
2. 分析图片/视频，生成复刻提示词
3. 在原有描述或参考素材基础上改写提示词
灵活根据用户意图处理，提示词同时输出中文和英文版本。`

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'avi']
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
}
const SAFE_ID = /^[\w-]+\.(mp4|mov|webm|avi)$/

export async function aiAssistantRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true })

  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? 'https://ai.comfly.chat'
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-preview-thinking'
  const BASE_URL = process.env.AI_UPLOAD_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

  // ── POST /ai-assistant/upload ───────────────────────────────────────────────
  // Upload a video file; returns temp_id + public URL for Gemini to fetch
  app.post('/ai-assistant/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_VIDEO_SIZE } })

    if (!data) return reply.badRequest('No file provided')

    const ext = (data.filename as string).split('.').pop()?.toLowerCase() ?? 'mp4'
    if (!VIDEO_EXTS.includes(ext)) {
      return reply.badRequest('Only video files are supported (mp4, mov, webm, avi)')
    }

    const id = `${randomUUID()}.${ext}`
    const filePath = join(UPLOAD_DIR, id)

    await pipeline(data.file, createWriteStream(filePath))

    return { temp_id: id, url: `${BASE_URL}/api/v1/ai-assistant/uploads/${id}` }
  })

  // ── GET /ai-assistant/uploads/:id ──────────────────────────────────────────
  // Serve a temp video file so Gemini can fetch it (public, no auth)
  app.get<{ Params: { id: string } }>('/ai-assistant/uploads/:id', async (request, reply) => {
    const { id } = request.params
    if (!SAFE_ID.test(id)) return reply.status(404).send()

    const filePath = join(UPLOAD_DIR, id)
    try {
      const s = await stat(filePath)
      if (Date.now() - s.mtimeMs > MAX_VIDEO_AGE_MS) {
        await unlink(filePath).catch(() => {})
        return reply.status(404).send()
      }
      const ext = id.split('.').pop()!
      reply.header('Content-Type', VIDEO_MIME[ext] ?? 'video/mp4')
      reply.header('Content-Length', s.size)
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Robots-Tag', 'noindex')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send()
    }
  })

  // ── POST /ai-assistant/chat ─────────────────────────────────────────────────
  // Streaming chat with Gemini; supports text, image (base64), and video (URL)
  app.post<{
    Body: {
      message?: string
      tab: 'chat' | 'image' | 'video'
      image_base64?: string | null
      image_type?: string | null
      video_temp_id?: string | null
      history?: { role: 'user' | 'assistant'; content: string }[]
    }
  }>(
    '/ai-assistant/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['tab'],
          properties: {
            message: { type: 'string', maxLength: 2000 },
            tab: { type: 'string', enum: ['chat', 'image', 'video'] },
            image_base64: { type: ['string', 'null'], maxLength: 20_000_000 },
            image_type: { type: ['string', 'null'], maxLength: 100 },
            video_temp_id: { type: ['string', 'null'], maxLength: 200 },
            history: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: 4000 },
                },
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { message = '', tab, image_base64, image_type, video_temp_id, history = [] } = request.body

      // Build OpenAI-compatible messages array
      const messages: any[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ]

      // Build user content based on what was sent
      let userContent: any

      if (image_base64) {
        // Image attached (any tab) — send as base64 data URI
        const defaultPrompt =
          tab === 'image'
            ? '请详细分析这张图片的视觉元素，生成可复刻的AI绘图提示词（中英双语）。'
            : message || '请分析这张图片。'
        userContent = [
          {
            type: 'image_url',
            image_url: { url: `data:${image_type ?? 'image/jpeg'};base64,${image_base64}` },
          },
          { type: 'text', text: defaultPrompt },
        ]
      } else if (video_temp_id) {
        // Video attached — send as public URL
        if (!SAFE_ID.test(video_temp_id)) return reply.badRequest('Invalid video_temp_id')
        const videoUrl = `${BASE_URL}/api/v1/ai-assistant/uploads/${video_temp_id}`
        const defaultPrompt =
          tab === 'video'
            ? '请详细分析这个视频的视觉风格、场景构成和画面语言，生成可参考复刻的AI视频生成提示词（中英双语）。'
            : message || '请分析这个视频。'
        userContent = [
          { type: 'image_url', image_url: { url: videoUrl } },
          { type: 'text', text: defaultPrompt },
        ]
      } else {
        // Text only
        if (!message.trim()) return reply.badRequest('message is required when no media is provided')
        userContent = message
      }

      messages.push({ role: 'user', content: userContent })

      // Call Gemini via comfly (OpenAI-compatible)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120_000)

      let geminiRes: Response
      try {
        geminiRes = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({ model: AI_MODEL, messages, stream: true, max_tokens: 4000 }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text()
        app.log.error({ status: geminiRes.status, body: errText }, 'Gemini API error')
        return reply.status(502).send({
          success: false,
          error: { code: 'AI_ERROR', message: 'AI助手暂时不可用，请稍后重试' },
        })
      }

      // Stream response back to client
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
        // Delete temp video after analysis
        if (video_temp_id && SAFE_ID.test(video_temp_id)) {
          await unlink(join(UPLOAD_DIR, video_temp_id)).catch(() => {})
        }
      }
    },
  )
}
