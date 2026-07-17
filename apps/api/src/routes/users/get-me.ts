import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { buildUserProfile } from '../../services/user-profile.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /users/me — 获取当前用户信息
  app.get('/users/me', async (request) => {
    const db = getDb()
    return buildUserProfile(db, request.user.id)
  })
}

export default route
