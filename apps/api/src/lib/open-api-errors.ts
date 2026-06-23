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
