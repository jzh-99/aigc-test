// 开放接口临时验证路由（Task 0.6）：
// 用于手测 /api/v3 认证链路——无 Authorization 返回 AUTH_FAILED，合法 Bearer 返回成功信封。
// Task 1.4 端到端验证后可保留为 health 或删除。
import type { FastifyPluginAsync } from 'fastify'

import { successResponse } from '../../lib/open-api-errors.js'
import { openApiPreHandler } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /api/v3/ping：preHandler 认证 API Key，成功返回 task_id=ping 的成功信封
  app.get('/ping', {
    schema: { tags: ['OpenApi'] },
    preHandler: [openApiPreHandler],
  }, async (request, reply) => {
    // request.apiClient 由 requireApiKey 装饰 + openApiPreHandler 挂载（非空断言：preHandler 已确保）
    const clientId = request.apiClient?.id ?? 'unknown'
    return reply.status(200).send(successResponse(`ping:${clientId}`))
  })
}

export default route
