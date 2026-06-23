// 开放接口错误码与统一响应信封
// 逐字对齐源项目 app/schemas/errors.py 的码值与用户可见文案。
// 约定：对外只暴露固定中文文案，不向客户端泄漏内部异常文本；
//       rawMessage 仅用于日志/内部排查。JSON 字段名 task_id/code/message
//       保持源项目拼写，是对客户端的契约，不得"修正"。

// 错误码枚举（值锁定，新增码值必须同步更新 ERROR_MESSAGES）
export const ErrorCode = {
  SUCCESS: '0000',
  PARAM_ERROR: '1001',
  AUTH_FAILED: '1002',
  MODEL_CONFIG_ERROR: '1003',
  SECURITY_CHECK_FAILED: '2001',
  DUPLICATE_TASK: '2002',
  EXTERNAL_SERVICE_FAILED: '4001',
  FILE_PROCESS_FAILED: '4002',
  STORAGE_FAILED: '4003',
  CALLBACK_FAILED: '4004',
  SYSTEM_FAILED: '5001',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// 用户可见文案映射（除 SECURITY_CHECK_FAILED 外，其余统一文案，避免泄漏内部细节）
const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.SUCCESS]: '正在加速生成中，请稍等',
  [ErrorCode.SECURITY_CHECK_FAILED]: '含敏感信息',
  // 其余码统一文案（不向客户端暴露内部异常文本）
  [ErrorCode.PARAM_ERROR]: '不符合创作规范',
  [ErrorCode.AUTH_FAILED]: '不符合创作规范',
  [ErrorCode.MODEL_CONFIG_ERROR]: '不符合创作规范',
  [ErrorCode.DUPLICATE_TASK]: '不符合创作规范',
  [ErrorCode.EXTERNAL_SERVICE_FAILED]: '不符合创作规范',
  [ErrorCode.FILE_PROCESS_FAILED]: '不符合创作规范',
  [ErrorCode.STORAGE_FAILED]: '不符合创作规范',
  [ErrorCode.CALLBACK_FAILED]: '不符合创作规范',
  [ErrorCode.SYSTEM_FAILED]: '不符合创作规范',
}

// 根据错误码取用户可见文案；未知码兜底为「不符合创作规范」
export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? '不符合创作规范'
}

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
export function successResponse(taskId: string) {
  return {
    result: {
      task_id: taskId,
      code: ErrorCode.SUCCESS,
      message: errorMessage(ErrorCode.SUCCESS),
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
    super(rawMessage ?? errorMessage(code))
    this.code = code
    this.rawMessage = rawMessage
    this.name = 'OpenApiError'
  }

  // 对外暴露的固定文案（始终从 ERROR_MESSAGES 取，不受 rawMessage 影响）
  get publicMessage(): string {
    return errorMessage(this.code)
  }
}
