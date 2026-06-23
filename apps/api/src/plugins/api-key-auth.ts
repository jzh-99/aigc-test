import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { resolveApiClient, type FindActiveClientByDigest } from '../lib/api-client.js'

// 开放接口调用方主体：认证通过后挂到 request.apiClient，
// 字段对齐 packages/db schema ApiClientsTable 的归属字段（驼峰转下划线映射在此完成）。
export interface ApiClientPrincipal {
  id: string
  name: string
  teamId: string | null
  workspaceId: string | null
  systemUserId: string | null
}

// Fastify 请求装饰：开放接口路由经认证后可读 request.apiClient（null 表示未认证/未挂载）。
// 装饰模式对齐 apps/api/src/plugins/jwt-auth.ts 的 request.user 装饰写法。
declare module 'fastify' {
  interface FastifyRequest {
    apiClient: ApiClientPrincipal | null
  }
}

// 装饰器插件：注册时给 request 预置 apiClient=null（Task 0.6 在 /api/v3 注册此插件）。
// 仅声明装饰，不在此处挂 onRequest/preHandler 钩子——开放接口路由用 authenticateApiKey 作 preHandler。
export const requireApiKey = fp(async function apiKeyDecorator(app: FastifyInstance): Promise<void> {
  app.decorateRequest('apiClient', null)
}, { name: 'api-key-decorator' })

// 认证函数：开放接口路由用 preHandler 调用（Task 0.6 路由模板挂载）。
// 失败时抛 OpenApiError(AUTH_FAILED)，由全局错误处理器转为 401 固定文案响应。
// 可选 queryClient 仅用于测试注入，生产调用省略（走默认 getDb()）。
export async function authenticateApiKey(
  request: FastifyRequest,
  finder?: FindActiveClientByDigest,
): Promise<void> {
  const header = request.headers.authorization
  // 仅接受 "Bearer <token>" 形式，对齐源项目 app/api/deps.py 的 Bearer 解析
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined

  const client = await resolveApiClient(token, finder)
  request.apiClient = {
    id: client.id,
    name: client.name,
    teamId: client.team_id,
    workspaceId: client.workspace_id,
    systemUserId: client.system_user_id,
  }
}
