import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { buildUserProfile } from '../../services/user-profile.js'

const route: FastifyPluginAsync = async (app) => {
  // PATCH /users/me — 更新当前用户的用户名或头像
  app.patch<{ Body: { username?: string; avatar_url?: string } }>('/users/me', {
    schema: {
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 50 },
          avatar_url: { type: ['string', 'null'], maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { username, avatar_url } = request.body ?? {}
    if (!username && avatar_url === undefined) {
      return reply.badRequest('At least one field (username, avatar_url) is required')
    }

    const db = getDb()
    const updates: Record<string, unknown> = {}

    if (username) {
      const sanitized = username.trim().slice(0, 50)
      if (sanitized.length < 1) return reply.badRequest('用户名不能为空')
      updates.username = sanitized
    }

    if (avatar_url !== undefined) {
      if (avatar_url !== null && avatar_url !== '') {
        // 基础 URL 格式校验
        try {
          const parsed = new URL(avatar_url)
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return reply.badRequest('头像 URL 必须是 http 或 https 链接')
          }
        } catch {
          return reply.badRequest('头像 URL 格式无效')
        }
        updates.avatar_url = avatar_url.slice(0, 500)
      } else {
        updates.avatar_url = null
      }
    }

    await db
      .updateTable('users')
      .set(updates)
      .where('id', '=', request.user.id)
      .execute()

    return buildUserProfile(db, request.user.id)
  })
}

export default route
