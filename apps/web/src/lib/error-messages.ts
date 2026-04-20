/**
 * 错误信息中文化映射
 * 将后端返回的英文错误信息翻译为用户友好的中文提示
 */

// API 错误码映射
export const ERROR_CODE_MAP: Record<string, string> = {
  // 认证相关
  AUTH_REQUIRED: '请先登录',
  INVALID_CREDENTIALS: '用户名或密码错误',
  SESSION_EXPIRED: '登录已过期，请重新登录',
  TOKEN_EXPIRED: '登录已过期，请重新登录',
  FORBIDDEN: '没有权限执行此操作',

  // 资源相关
  NOT_FOUND: '请求的资源不存在',
  ALREADY_EXISTS: '资源已存在',

  // 业务逻辑
  INSUFFICIENT_CREDITS: '积分不足，请充值后继续',
  TOO_MANY_PENDING: '待处理任务过多，请等待完成后再提交',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  PROMPT_BLOCKED: '提示词包含敏感内容，请修改后重试',

  // 服务器错误
  INTERNAL_ERROR: '服务器内部错误，请稍后重试',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  TIMEOUT: '生成超时，请稍后重新发起请求',

  // 验证错误
  INVALID_INPUT: '输入数据格式不正确',
  VALIDATION_ERROR: '数据验证失败',
  FST_ERR_VALIDATION: '输入数据格式不正确',

  // 团队/工作区相关
  TEAM_NAME_TAKEN: '已有同名团队，请换一个名称',
  WORKSPACE_NAME_TAKEN: '该团队下已有同名工作区，请换一个名称',
  USER_ALREADY_OWNER: '该用户已是其他团队的组长，同一账号只能担任一个团队的组长',
  CANNOT_REMOVE_OWNER: '不能移除团队组长',
  ALREADY_MEMBER: '该用户已是成员',

  // 其他
  UNKNOWN: '未知错误，请联系客服',
}

// 常见英文错误信息关键词映射
const ERROR_KEYWORD_MAP: Array<{ pattern: RegExp; message: string }> = [
  // 网络相关
  { pattern: /network error|fetch failed|failed to fetch/i, message: '网络连接失败，请检查网络后重试' },
  { pattern: /timeout|timed out/i, message: '生成超时，请稍后重新发起请求' },
  { pattern: /aborted|abort/i, message: '生成超时，请稍后重新发起请求' },

  // 认证相关
  { pattern: /unauthorized|not authorized/i, message: '未授权，请先登录' },
  { pattern: /forbidden|access denied/i, message: '没有权限访问此资源' },
  { pattern: /invalid token|token invalid/i, message: '登录凭证无效，请重新登录' },

  // 资源相关
  { pattern: /not found|404/i, message: '请求的资源不存在' },
  { pattern: /already exists|duplicate/i, message: '资源已存在' },

  // 服务器错误
  { pattern: /internal server error|500/i, message: '服务器错误，请稍后重试' },
  { pattern: /service unavailable|503/i, message: '服务暂时不可用，请稍后重试' },
  { pattern: /bad gateway|502/i, message: '网关错误，请稍后重试' },

  // 业务逻辑
  { pattern: /insufficient (credits|balance)/i, message: '积分不足' },
  { pattern: /quota exceeded|limit exceeded/i, message: '已超出配额限制' },
  { pattern: /rate limit/i, message: '请求过于频繁，请稍后再试' },

  // 上传相关
  { pattern: /未检测到文件/i, message: '未检测到文件，请重新选择后上传' },
  { pattern: /不支持的文件格式/i, message: '文件格式不支持，请检查后重新上传' },
  { pattern: /file too large|文件过大/i, message: '文件过大，请压缩后重新上传' },
  { pattern: /no file provided/i, message: '未检测到文件，请重新选择后上传' },
  { pattern: /unsupported file type/i, message: '不支持的文件格式，请检查后重新上传' },
  { pattern: /image too large/i, message: '图片文件过大，请压缩后重新上传' },
  { pattern: /video too large/i, message: '视频文件过大，请压缩后重新上传' },
  { pattern: /audio too large/i, message: '音频文件过大，请压缩后重新上传' },

  // AI 生成相关
  { pattern: /could not generate|generation failed/i, message: '生成失败，请尝试修改提示词后重试' },
  { pattern: /prompt (blocked|rejected|filtered)/i, message: '提示词包含敏感内容，请修改后重试' },
  { pattern: /content (policy|filter)/i, message: '内容不符合规范，请修改后重试' },
  { pattern: /copyright/i, message: '生成内容可能涉及版权限制，请修改提示词后重试' },
  { pattern: /sensitive (information|content)|contains sensitive/i, message: '生成内容可能包含敏感信息，请修改提示词后重试' },

  // 数据验证
  { pattern: /invalid (input|format|data)/i, message: '输入数据格式不正确' },
  { pattern: /validation (failed|error)/i, message: '数据验证失败' },
  { pattern: /missing required/i, message: '缺少必填字段' },

  // Fastify / AJV schema validation messages
  { pattern: /must match format "email"/i, message: '邮箱格式不正确，请输入有效的邮箱地址' },
  { pattern: /must match format "uuid"/i, message: '字段格式不正确' },
  { pattern: /must NOT be shorter than (\d+) characters/i, message: '输入内容过短，请检查长度要求' },
  { pattern: /must NOT be longer than (\d+) characters/i, message: '输入内容超出长度限制' },
  { pattern: /must match pattern/i, message: '输入内容格式不符合要求' },
  { pattern: /must be (integer|number)/i, message: '请输入有效的数字' },
  { pattern: /must have required property/i, message: '缺少必填字段' },
  { pattern: /must be >= (\d+)/i, message: '数值不能小于最小限制' },
  { pattern: /must be <= (\d+)/i, message: '数值超出最大限制' },
  { pattern: /must be equal to one of the allowed values/i, message: '输入值不在允许的范围内' },
]

/**
 * 将错误信息转换为用户友好的中文提示
 */
export function translateError(error: unknown): string {
  // 如果已经是中文，直接返回
  if (typeof error === 'string') {
    if (/[\u4e00-\u9fa5]/.test(error)) {
      return error
    }

    // 尝试匹配关键词
    for (const { pattern, message } of ERROR_KEYWORD_MAP) {
      if (pattern.test(error)) {
        return message
      }
    }

    return error
  }

  // 处理 Error 对象
  if (error instanceof Error) {
    const message = error.message

    // 如果已经是中文
    if (/[\u4e00-\u9fa5]/.test(message)) {
      return message
    }

    // 尝试匹配关键词
    for (const { pattern, message: translatedMsg } of ERROR_KEYWORD_MAP) {
      if (pattern.test(message)) {
        return translatedMsg
      }
    }

    return message
  }

  return '操作失败，请稍后重试'
}

/**
 * 根据错误码获取中文提示
 */
export function getErrorMessage(code: string, fallback?: string): string {
  // For unknown codes, prefer the actual backend message over a generic placeholder
  if (code === 'UNKNOWN' || !ERROR_CODE_MAP[code]) {
    return fallback || ERROR_CODE_MAP.UNKNOWN
  }
  return ERROR_CODE_MAP[code]
}

// 视频生成 API 特定错误信息映射（精确匹配优先，在通用关键词匹配之前执行）
const VIDEO_API_ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  // 版权 / 敏感内容（Nano Banana 原文）
  {
    pattern: /output video may be related to copyright/i,
    message: '生成失败：视频内容可能涉及版权限制，请修改提示词后重试',
  },
  {
    pattern: /output video may contain sensitive/i,
    message: '生成失败：视频内容可能包含敏感信息，请修改提示词后重试',
  },
  // 超时（worker 内部写入）
  {
    pattern: /video generation timed out/i,
    message: '生成超时，请稍后重新发起请求',
  },
  // Volcengine 输入图片敏感
  {
    pattern: /InputImageSensitiveContentDetected\.PolicyViolation/,
    message: '参考图片违反平台安全规范，请更换素材后重试',
  },
  {
    pattern: /InputImageSensitiveContentDetected/,
    message: '参考图片包含敏感内容，请更换素材后重试',
  },
  // Volcengine 输入视频敏感
  {
    pattern: /InputVideoSensitiveContentDetected\.PolicyViolation/,
    message: '参考视频违反平台安全规范，请更换素材后重试',
  },
  {
    pattern: /InputVideoSensitiveContentDetected/,
    message: '参考视频包含敏感内容，请更换素材后重试',
  },
  // Gemini 安全拦截（API 422）
  {
    pattern: /gemini could not generate.*prompt or image safety/i,
    message: '提示词或参考图片不符合安全规范，请修改后重试',
  },
  // 上游服务内存不足（NewAPI 网关）
  {
    pattern: /system.?memory.?overload/i,
    message: '上游服务繁忙，请稍后重试',
  },
]

/**
 * 翻译任务错误信息（用于显示在卡片上）
 */
export function translateTaskError(errorMessage: string | null | undefined): string {
  if (!errorMessage) return '未知错误'

  // 精确匹配视频 API 特定错误（在中文检测之前，因为这些是英文原始消息）
  for (const { pattern, message } of VIDEO_API_ERROR_MAP) {
    if (pattern.test(errorMessage)) {
      return message
    }
  }

  // 如果已经是中文
  if (/[\u4e00-\u9fa5]/.test(errorMessage)) {
    return errorMessage
  }

  // 特殊处理 Volcengine API 错误格式: "Volcengine API 400: {...}"
  const volcengineMatch = errorMessage.match(/^Volcengine API \d+:\s*(.+)/)
  if (volcengineMatch) {
    try {
      const parsed = JSON.parse(volcengineMatch[1])
      const code: string = parsed.error?.code ?? ''
      const msg: string = parsed.error?.message ?? ''
      // 先用 VIDEO_API_ERROR_MAP 匹配 code 或 message
      for (const { pattern, message } of VIDEO_API_ERROR_MAP) {
        if (pattern.test(code) || pattern.test(msg)) return message
      }
      // 再走通用关键词
      if (msg) return translateError(msg)
    } catch {
      // 非 JSON，走后续通用匹配
    }
  }

  // 特殊处理 API 错误格式: "API 422: {...}"
  const apiErrorMatch = errorMessage.match(/^API (\d+):\s*(.+)/)
  if (apiErrorMatch) {
    const [, statusCode, body] = apiErrorMatch

    // 尝试解析 JSON 错误信息
    try {
      const parsed = JSON.parse(body)
      const errMsg: string = parsed.error?.message ?? ''
      const errCode: string = parsed.error?.code ?? ''
      // 先走 VIDEO_API_ERROR_MAP 精确匹配
      for (const { pattern, message } of VIDEO_API_ERROR_MAP) {
        if (pattern.test(errCode) || pattern.test(errMsg)) return message
      }
      if (errMsg) {
        const translated = translateError(errMsg)
        if (translated !== errMsg) return translated
        // 如果已是中文直接返回
        if (/[\u4e00-\u9fa5]/.test(errMsg)) return errMsg
      }
    } catch {
      // 不是 JSON，继续处理
    }

    // 根据状态码返回通用提示
    if (statusCode === '422') return '生成失败，请尝试修改提示词'
    if (statusCode === '429') return '请求过于频繁'
    if (statusCode === '500') return '服务器错误'
    if (statusCode === '503') return '服务暂时不可用'
  }

  // 尝试关键词匹配
  return translateError(errorMessage)
}
