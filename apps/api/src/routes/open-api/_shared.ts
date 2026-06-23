// 开放接口共享：错误处理 + 认证 preHandler
// HTTP 状态码对齐源项目 app/api 抛 HTTPException 的 status_code（Task 0.6 显式契约）：
//   - 业务错误（OpenApiError）：按 httpStatusForErrorCode 映射返回 4xx/5xx
//     （AUTH=401、PARAM=422、MODEL_CONFIG/SECURITY/DUPLICATE/EXTERNAL=400、SYSTEM=500）
//   - 参数校验失败（Fastify schema 校验）：HTTP 422 + PARAM_ERROR（对齐源项目 RequestValidationError）
//   - 其他未知异常：HTTP 500 + SYSTEM_FAILED，不泄漏内部堆栈
// body 结构对齐源项目 error_response：{ result: { code, message } }
// （源项目 error_response 含 task_id 字段，但错误响应阶段通常无 task_id，保持空 body 一致）
import type { FastifyReply, FastifyRequest } from 'fastify'

import {
  ErrorCode,
  errorMessage,
  httpStatusForErrorCode,
  OpenApiError,
} from '../../lib/open-api-errors.js'
import { authenticateApiKey } from '../../plugins/api-key-auth.js'

// 业务错误响应体（对齐源项目 error_response 的 result 子结构）
function buildBusinessBody(code: string, message?: string): { result: { code: string; message: string } } {
  return { result: { code, message: message ?? errorMessage(code) } }
}

// 开放接口统一错误响应（scoped 到 /api/v3 实例，不影响 /api/v1 的默认错误格式）
// - OpenApiError：按 ErrorCode→HTTP 映射返回对应 status + body code/publicMessage
// - Fastify schema 校验失败（err.validation 存在）：HTTP 422 + PARAM_ERROR
// - 其他异常：HTTP 500 + SYSTEM_FAILED（不暴露内部文本）
export function sendOpenApiError(reply: FastifyReply, err: unknown): void {
  // Fastify schema 校验失败：错误对象带 validation 字段（优先判断，对齐源项目 422）
  if (err != null && typeof err === 'object' && Array.isArray((err as { validation?: unknown }).validation)) {
    reply.status(422).send(buildBusinessBody(ErrorCode.PARAM_ERROR))
    return
  }

  // 业务错误：按 ErrorCode→HTTP 映射返回，publicMessage 为固定文案
  if (err instanceof OpenApiError) {
    reply.status(httpStatusForErrorCode(err.code)).send(buildBusinessBody(err.code, err.publicMessage))
    return
  }

  // 兜底：未知异常转 SYSTEM_FAILED + HTTP 500（避免泄漏内部堆栈）
  reply.status(500).send(buildBusinessBody(ErrorCode.SYSTEM_FAILED))
}

// 开放接口路由的认证 preHandler：失败抛 OpenApiError(AUTH_FAILED)，
// 由 setErrorHandler 转为 401 + code 响应。
// 包装为 Fastify preHandler 签名（request, reply），调用底层 authenticateApiKey。
export async function openApiPreHandler(request: FastifyRequest): Promise<void> {
  await authenticateApiKey(request)
}
