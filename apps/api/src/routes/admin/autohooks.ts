import type { FastifyPluginAsync } from 'fastify'
import { adminGuard } from '../../plugins/guards.js'

// admin 目录下所有路由自动挂载此 preHandler 守卫
const hooks: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', adminGuard())
}

export default hooks
