// OpenAPI 文档共享 schema。
// 这里只描述对外接口契约，不参与业务逻辑；字段名保持源项目约定（如 task_id/bussiness_id）。

const resultEnvelope = {
  type: 'object',
  description: '开放接口统一响应体。业务是否成功请以 result.code 为准。',
  properties: {
    result: {
      type: 'object',
      description: '业务处理结果。',
      required: ['code', 'message'],
      properties: {
        task_id: {
          type: 'string',
          description: '调用方传入的任务 ID。提交成功时原样返回；部分错误响应可能不返回该字段。',
        },
        code: {
          type: 'string',
          description: '业务结果码。0000 表示成功，其余值表示参数、认证、重复任务、外部服务等业务错误。',
          examples: ['0000'],
        },
        message: {
          type: 'string',
          description: '业务结果文案。对外只返回固定中文文案，不暴露内部异常详情。',
          examples: ['正在加速生成中，请稍等'],
        },
      },
    },
    meta: {
      type: 'object',
      description: '同步接口的扩展结果。异步提交接口通常不返回该字段。',
      additionalProperties: true,
    },
  },
}

export const OPENAPI_COMMON_RESPONSES = {
  200: resultEnvelope,
  401: {
    ...resultEnvelope,
    description: '认证失败。请检查 Authorization: Bearer <api_key> 请求头。',
  },
  422: {
    ...resultEnvelope,
    description: '参数校验失败。通常是缺少必填字段、字段类型错误或枚举值不合法。',
  },
  500: {
    ...resultEnvelope,
    description: '系统异常。响应不会包含内部堆栈或第三方原始错误。',
  },
}

export const OPENAPI_TEXT_RESPONSES = {
  ...OPENAPI_COMMON_RESPONSES,
  200: {
    ...resultEnvelope,
    description: '文本润色同步响应。成功时 meta.output_text 为润色后的文本；失败时为空字符串或不返回。',
    properties: {
      ...resultEnvelope.properties,
      meta: {
        type: 'object',
        description: '文本润色同步结果。',
        properties: {
          output_text: {
            type: 'string',
            description: '润色后的输出文本。仅 code=0000 时有有效内容。',
          },
        },
      },
    },
  },
  400: {
    ...resultEnvelope,
    description: '模型配置错误。通常是服务端缺少 DOUBAO_API_KEY 等必要配置。',
  },
}

export const OPENAPI_PING_RESPONSES = {
  200: {
    ...resultEnvelope,
    description: '连接性测试成功响应。',
  },
  401: OPENAPI_COMMON_RESPONSES[401],
}
