import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { stripHtml } from '../../lib/sanitize.js'

// 客户端错误上报路由：限流 20次/分钟，防止滥用
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      error_code: string
      detail?: string
      http_status?: number | null
      model?: string
      canvas_id?: string
    }
  }>('/client-errors', {
    // 路由级限流配置（依赖全局 @fastify/rate-limit 插件）
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (request: { user?: { id: string }; ip: string }) =>
          `client-errors:${request.user?.id ?? request.ip}`,
        errorResponseBuilder: (_request: unknown, context: { ttl: number }) => ({
          statusCode: 429,
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `上报过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`,
          },
        }),
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['error_code'],
        properties: {
          error_code: { type: 'string', minLength: 1, maxLength: 80 },
          detail: { type: 'string', maxLength: 2000 },
          http_status: { type: ['integer', 'null'], minimum: 100, maximum: 599 },
          model: { type: 'string', maxLength: 100 },
          canvas_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    // 对 detail 字段做 XSS 过滤并截断，防止存储恶意内容
    const detail = request.body.detail
      ? stripHtml(request.body.detail).slice(0, 1000)
      : null

    // 异步写入，不阻塞响应；写入失败只记录警告，不影响用户
    getDb()
      .insertInto('submission_errors')
      .values({
        user_id: request.user.id,
        source: 'client',
        error_code: request.body.error_code,
        http_status: request.body.http_status ?? null,
        detail,
        model: request.body.model ?? null,
        canvas_id: request.body.canvas_id ?? null,
      })
      .execute()
      .catch((err) => {
        app.log.warn(
          { err, errorCode: request.body.error_code },
          'Failed to log client submission error',
        )
      })

    return { success: true }
  })
}

export default route
