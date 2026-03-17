import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'

// Public routes that skip auth
const PUBLIC_ROUTES = [
  '/api/v1/healthz',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/accept-invite',
  '/api/v1/assets/proxy',
  '/api/v1/assets/thumbnail',
]

export interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'member'
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser
  }
}

export const jwtAuthPlugin = fp(async function jwtAuth(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is required')
  if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters')

  app.decorateRequest('user', null)

  app.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_ROUTES.some((r) => request.url.startsWith(r))) return

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Missing or invalid authorization header' },
      })
    }

    try {
      const token = authHeader.slice(7)
      const payload = jwt.verify(token, secret) as { sub: string; email: string; role: string }
      request.user = { id: payload.sub, email: payload.email, role: payload.role as 'admin' | 'member' }
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'Invalid or expired access token' },
      })
    }
  })
})
