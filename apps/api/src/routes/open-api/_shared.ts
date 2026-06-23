// 开放接口共享：错误处理 + 认证 preHandler
// 对齐源项目 app/main.py 的异常处理语义，但 HTTP 码契约遵循 Task 0.6 计划：
//   - 业务错误（OpenApiError）：HTTP 200 + body { result: { code, message } }
//     （源项目业务错误走 HTTP 4xx，aigc-test 侧统一改为 200+code，与计划已确认契约一致）
//   - 参数校验失败（Fastify schema 校验）：HTTP 422 + body { result: { code: PARAM_ERROR, message } }
//     （对齐源项目 RequestValidationError → 422）
//   - 其他未知异常：HTTP 200 + body { code: SYSTEM_FAILED }，不泄漏内部堆栈
import type { FastifyReply, FastifyRequest } from 'fastify'

import { ErrorCode, errorMessage, OpenApiError } from '../../lib/open-api-errors.js'
import { authenticateApiKey } from '../../plugins/api-key-auth.js'

// 业务错误响应体（HTTP 200，body 内 code 表达业务结果）
function buildBusinessBody(code: string): { result: { code: string; message: string } } {
  return { result: { code, message: errorMessage(code) } }
}

// 开放接口统一错误响应（scoped 到 /api/v3 实例，不影响 /api/v1 的默认错误格式）
// - OpenApiError：HTTP 200 + 公开文案（业务错误对齐计划契约）
// - Fastify schema 校验失败（err.validation 存在）：HTTP 422 + PARAM_ERROR
// - 其他异常：HTTP 200 + SYSTEM_FAILED（不暴露内部文本）
export function sendOpenApiError(reply: FastifyReply, err: unknown): void {
  if (err instanceof OpenApiError) {
    // 业务错误：HTTP 200，body code 表达结果，publicMessage 为固定文案
    reply.status(200).send(buildBusinessBody(err.code))
    return
  }

  // Fastify schema 校验失败：错误对象带 validation 字段
  if (err != null && typeof err === 'object' && Array.isArray((err as { validation?: unknown }).validation)) {
    reply.status(422).send(buildBusinessBody(ErrorCode.PARAM_ERROR))
    return
  }

  // 兜底：未知异常转 SYSTEM_FAILED，HTTP 200（避免泄漏内部堆栈）
  reply.status(200).send(buildBusinessBody(ErrorCode.SYSTEM_FAILED))
}

// 开放接口路由的认证 preHandler：失败抛 OpenApiError(AUTH_FAILED)，
// 由 setErrorHandler 转为 200 + code 响应。
// 包装为 Fastify preHandler 签名（request, reply），调用底层 authenticateApiKey。
export async function openApiPreHandler(request: FastifyRequest): Promise<void> {
  await authenticateApiKey(request)
}
