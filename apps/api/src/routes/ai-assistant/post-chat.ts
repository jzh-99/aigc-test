import type { FastifyPluginAsync } from 'fastify'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@aigc/db'
import { UPLOAD_DIR, SAFE_ID, chatEndpoint, AI_API_KEY, AI_MODEL, SYSTEM_PROMPT, BASE_URL } from './_shared.js'

// POST /ai-assistant/chat — 流式对话（支持文本、图片 base64、视频 URL）
const route: FastifyPluginAsync = async (app) => {
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
            message: { type: 'string', maxLength: 4000 },
            tab: { type: 'string', enum: ['chat', 'image', 'video'] },
            image_base64: { type: ['string', 'null'], maxLength: 20_000_000 },
            image_type: { type: ['string', 'null'], maxLength: 100 },
            video_temp_id: { type: ['string', 'null'], maxLength: 200 },
            history: {
              type: 'array',
              maxItems: 6,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: 12000 },
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
      const userId = request.user?.id

      // 记录 AI 助手使用日志，便于监控
      app.log.info({
        userId,
        tab,
        hasImage: !!image_base64,
        hasVideo: !!video_temp_id,
        messageLength: message?.length || 0,
        historyLength: history.length,
      }, 'AI assistant request')

      // 构建 OpenAI 兼容的 messages 数组
      const messages: any[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ]

      // 根据传入内容类型构建用户消息
      let userContent: any

      if (image_base64) {
        // 图片附件（任意 tab）— 以 base64 data URI 发送
        const defaultPrompt =
          tab === 'image'
            ? '我要复刻这张图片，请以JSON格式返回详细的技术规格和提示词。要求：1. 精细到像素级别，详细描述所有视觉元素（主体对象、背景环境、颜色色调、光影效果、构图布局、材质纹理、细节特征、整体氛围、艺术风格等）；2. 如果原图中出现任何文字内容，必须在提示词中准确保留原文（中文保留中文，英文保留英文，数字保留数字）；3. 只返回纯JSON对象，不要markdown代码块标记，不要任何额外说明；4. JSON结构应包含：metadata（主题、尺寸、渲染引擎、色彩模式等元数据）、typography_layer_specification（文字内容、字体样式、视觉效果、位置等排版规格）、pixel_level_visual_specs（角色/主体细节、背景场景、光照设置等像素级视觉规格）、color_palette_hex（十六进制色彩方案）、ai_generation_prompts（包含dalle_3_optimized、midjourney_v6、chinese_description等多种AI生成提示词）。'
            : message || '请分析这张图片。'
        userContent = [
          {
            type: 'image_url',
            image_url: { url: `data:${image_type ?? 'image/jpeg'};base64,${image_base64}` },
          },
          { type: 'text', text: defaultPrompt },
        ]
      } else if (video_temp_id) {
        // 视频附件 — 以公开 URL 发送
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
        // 纯文本
        if (!message.trim()) return reply.badRequest('message is required when no media is provided')
        userContent = message
      }

      messages.push({ role: 'user', content: userContent })

      // 调用豆包（OpenAI 兼容接口），5 分钟超时
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 300_000)

      let doubaoRes: Response
      try {
        doubaoRes = await fetch(chatEndpoint, {
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

      if (!doubaoRes.ok) {
        const errText = await doubaoRes.text()
        app.log.error({ status: doubaoRes.status, body: errText }, 'Doubao API error')
        getDb().insertInto('ai_assistant_errors').values({
          user_id: request.user.id,
          http_status: doubaoRes.status,
          error_detail: errText.slice(0, 2000),
        }).execute().catch(() => {})
        return reply.status(502).send({
          success: false,
          error: { code: 'AI_ERROR', message: 'AI助手暂时不可用，请稍后重试' },
        })
      }

      // 将 AI 响应流式转发给客户端
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const reader = doubaoRes.body!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          reply.raw.write(decoder.decode(value, { stream: true }))
        }
      } finally {
        reply.raw.end()
        // 分析完成后删除临时视频文件
        if (video_temp_id && SAFE_ID.test(video_temp_id)) {
          await unlink(join(UPLOAD_DIR, video_temp_id)).catch(() => {})
        }
      }
    },
  )
}

export default route
