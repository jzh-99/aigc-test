// 开放接口共享：错误处理 + 认证 preHandler
// HTTP 状态码对齐源项目 app/api 两段式语义（HTTP 表达框架层结果，body result.code 表达业务结果）：
//   - Fastify schema 校验失败（err.validation）：HTTP 422 + PARAM_ERROR
//     （对齐源项目 app/main.py:39 RequestValidationError 全局 handler）
//   - OpenApiError(AUTH_FAILED)：HTTP 401 + body code/publicMessage
//     （对齐源项目 app/api/deps.py:22,39 认证 HTTPException）
//   - OpenApiError(其他 code)：HTTP 200 + body code/publicMessage
//     （对齐源项目各 routes_*.py 路由内 return error_response()，业务错误走 200，
//      由 body code 表达业务结果，客户端按 result.code 判定）
//   - 未知异常：HTTP 500 + SYSTEM_FAILED，不泄漏内部堆栈
// body 结构对齐源项目 error_response 的 result 子结构：{ result: { code, message } }
import type { FastifyReply, FastifyRequest } from 'fastify'

import { ErrorCode, errorMessage, OpenApiError } from '../../lib/open-api-errors.js'
import { authenticateApiKey } from '../../plugins/api-key-auth.js'

// 业务错误响应体（对齐源项目 error_response 的 result 子结构）
function buildBusinessBody(code: string, message?: string): { result: { code: string; message: string } } {
  return { result: { code, message: message ?? errorMessage(code) } }
}

// 开放接口统一错误响应（scoped 到 /api/v3 实例，不影响 /api/v1 的默认错误格式）
// 四档判断：schema 校验 422 / AUTH 401 / 业务 200 / 未知 500
export function sendOpenApiError(reply: FastifyReply, err: unknown): void {
  // 1. Fastify schema 校验失败：错误对象带 validation 字段（优先判断，对齐源项目 422）
  if (err != null && typeof err === 'object' && Array.isArray((err as { validation?: unknown }).validation)) {
    reply.status(422).send(buildBusinessBody(ErrorCode.PARAM_ERROR))
    return
  }

  // 2. 业务错误：AUTH 特判 401，其余统一 200（body code 表达业务结果）
  if (err instanceof OpenApiError) {
    const httpStatus = err.code === ErrorCode.AUTH_FAILED ? 401 : 200
    reply.status(httpStatus).send(buildBusinessBody(err.code, err.publicMessage))
    return
  }

  // 3. 兜底：未知异常转 SYSTEM_FAILED + HTTP 500（避免泄漏内部堆栈）
  reply.status(500).send(buildBusinessBody(ErrorCode.SYSTEM_FAILED))
}

// 开放接口路由的认证 preHandler：失败抛 OpenApiError(AUTH_FAILED)，
// 由 setErrorHandler 转为 401 + code 响应。
// 包装为 Fastify preHandler 签名（request, reply），调用底层 authenticateApiKey。
export async function openApiPreHandler(request: FastifyRequest): Promise<void> {
  await authenticateApiKey(request)
}
