// 开放接口错误码与统一响应信封（api 层）
//
// ErrorCode 枚举与 errorMessage 文案现已迁移到 @aigc/types（callback-payload.ts），
// 供 api 与 worker 共享。此处 re-export 保持现有 `import { ErrorCode } from
// './open-api-errors.js'` 调用点零改动。
//
// 本文件仅保留 api 专用部分：
// - successResponse：统一成功响应信封（HTTP 层）
// - OpenApiError：开放接口业务异常（含 rawMessage 内部信息，仅日志使用）
//
// 对外只暴露固定中文文案，不向客户端泄漏内部异常文本；JSON 字段名
// task_id/code/message 保持源项目拼写，是对客户端的契约，不得"修正"。

// 复用 @aigc/types 的错误码与文案（api 内部代码统一从这里 import）
export { ErrorCode, errorMessage } from '@aigc/types'
import { errorMessage as _errorMessage } from '@aigc/types'
import { ErrorCode as _ErrorCode } from '@aigc/types'

// HTTP 状态码策略（对齐源项目 app/api 两段式语义）：
// 源项目 HTTP 码表达"框架层结果"，body result.code 表达"业务结果"：
//   - AUTH_FAILED → 401（app/api/deps.py:22,39 认证 HTTPException）
//   - RequestValidationError → 422（app/main.py:39 FastAPI schema 校验全局 handler）
//   - 其余业务错误（DUPLICATE/SYSTEM/EXTERNAL/...）→ 路由内 return error_response() 即 HTTP 200，
//     由 body code 表达业务结果（见各 routes_*.py 的 error_response 调用）。
// 因此不再需要 ErrorCode→HTTP 映射表：sendOpenApiError 内只对 AUTH 特判 401，
// 其余 OpenApiError 统一 200，schema 校验失败 422，未知异常 500。

// 统一成功响应信封（对齐源项目 success_response）
// 注意：函数名用 camelCase(successResponse)，JSON 字段保持对外契约拼写
export function successResponse(taskId: string, message = _errorMessage(_ErrorCode.SUCCESS)) {
  return {
    result: {
      task_id: taskId,
      code: _ErrorCode.SUCCESS,
      message,
    },
  }
}

// 开放接口业务异常（对齐源项目 AppError）
// - publicMessage：对外固定文案，写入响应体
// - rawMessage：内部原始信息，仅日志使用，不回传客户端
export class OpenApiError extends Error {
  readonly code: string
  readonly rawMessage?: string

  constructor(code: string, rawMessage?: string) {
    super(rawMessage ?? _errorMessage(code))
    this.code = code
    this.rawMessage = rawMessage
    this.name = 'OpenApiError'
  }

  // 对外暴露的固定文案（始终从 ERROR_MESSAGES 取，不受 rawMessage 影响）
  get publicMessage(): string {
    return _errorMessage(this.code)
  }
}
