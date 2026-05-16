import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import crypto from 'node:crypto'
import { sql } from 'kysely'

const route: FastifyPluginAsync = async (app) => {
  // POST /auth/logout — 撤销 refresh token 并清除 cookie
  app.post('/auth/logout', async (request, reply) => {
    const refreshToken = (request.cookies as Record<string, string | undefined>)?.refresh_token
    if (refreshToken) {
      const db = getDb()
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('token_hash', '=', tokenHash)
        .execute()
    }

    reply.clearCookie('refresh_token', { path: '/api/v1/auth' })
    return { success: true }
  })
}

export default route
