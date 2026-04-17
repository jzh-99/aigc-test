import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { buildUserProfile } from '../services/user-profile.js'

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /users/me
  app.get('/users/me', async (request) => {
    const db = getDb()
    return buildUserProfile(db, request.user.id)
  })

  // PATCH /users/me
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
        // Basic URL validation
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

  // POST /users/me/password — change password
  app.post<{ Body: { current_password: string; new_password: string } }>('/users/me/password', {
    schema: {
      body: {
        type: 'object',
        required: ['current_password', 'new_password'],
        properties: {
          current_password: { type: 'string', minLength: 1 },
          new_password: { type: 'string', minLength: 8, maxLength: 72 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { current_password, new_password } = request.body
    if (new_password.length < 8) {
      return reply.badRequest('新密码长度至少为 8 个字符')
    }
    if (!/[a-zA-Z]/.test(new_password) || !/\d/.test(new_password)) {
      return reply.badRequest('新密码必须包含字母和数字')
    }

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'password_hash'])
      .where('id', '=', request.user.id)
      .executeTakeFirstOrThrow()

    const valid = await bcrypt.compare(current_password, user.password_hash)
    if (!valid) {
      return reply.status(400).send({
        success: false,
        error: { code: 'WRONG_PASSWORD', message: '当前密码不正确' },
      })
    }

    const newHash = await bcrypt.hash(new_password, 12)
    await db
      .updateTable('users')
      .set({ password_hash: newHash, password_change_required: false })
      .where('id', '=', user.id)
      .execute()

    return { success: true }
  })

  // GET /users/me/generation-defaults
  app.get('/users/me/generation-defaults', async (request) => {
    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select('generation_defaults')
      .where('id', '=', request.user.id)
      .executeTakeFirstOrThrow()
    return user.generation_defaults ?? {}
  })

  // PATCH /users/me/generation-defaults
  app.patch<{ Body: Record<string, unknown> }>('/users/me/generation-defaults', {
    schema: {
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request) => {
    const db = getDb()
    await db
      .updateTable('users')
      .set({ generation_defaults: JSON.stringify(request.body) })
      .where('id', '=', request.user.id)
      .execute()
    return request.body
  })
}
