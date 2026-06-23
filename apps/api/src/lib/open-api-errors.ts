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

// 业务错误码 → HTTP 状态码（对齐源项目 app/api 抛 HTTPException 的 status_code）
// 源项目核实结果（D:/haobai/aigc-miniapp-server）：
//   - AUTH_FAILED → 401（app/api/deps.py:22-25 缺 Bearer、:39-42 无效 key）
//   - MODEL_CONFIG_ERROR → 400（app/api/deps.py:66-69 缺供应商 key）
//   - PARAM_ERROR → 422（app/main.py:39 RequestValidationError 全局 handler）
//   - 其余业务码（DUPLICATE/SYSTEM/EXTERNAL/...）：源项目路由内 return error_response() 即 HTTP 200，
//     此处按 Task 0.6 显式契约将其映射为 4xx/5xx（小程序按 body.code 判定，HTTP 码兼容不影响）。
//   - 未知码默认 400（与源项目 deps 缺 key 一致，避免 200 误导客户端）。
const ERROR_HTTP_STATUS: Record<string, number> = {
  [ErrorCode.PARAM_ERROR]: 422,
  [ErrorCode.AUTH_FAILED]: 401,
  [ErrorCode.MODEL_CONFIG_ERROR]: 400,
  [ErrorCode.SECURITY_CHECK_FAILED]: 400,
  [ErrorCode.DUPLICATE_TASK]: 400,
  [ErrorCode.EXTERNAL_SERVICE_FAILED]: 400,
  [ErrorCode.FILE_PROCESS_FAILED]: 400,
  [ErrorCode.STORAGE_FAILED]: 400,
  [ErrorCode.CALLBACK_FAILED]: 400,
  [ErrorCode.SYSTEM_FAILED]: 500,
}

// 根据错误码取 HTTP 状态码；未知码兜底 400
export function httpStatusForErrorCode(code: string): number {
  return ERROR_HTTP_STATUS[code] ?? 400
}

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
