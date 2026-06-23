// 开放接口错误处理测试：验证 sendOpenApiError 按 ErrorCode→HTTP 映射返回正确状态码
// 对齐源项目 app/main.py 异常处理语义（HTTPException 用 exc.status_code + body {result:{code,message}}）
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { ErrorCode, OpenApiError } from '../../lib/open-api-errors.js'
import { sendOpenApiError } from './_shared.js'

// 轻量 mock reply：记录最后一次 status/send 的值
function createMockReply() {
  const state = { status: 0 as number, body: null as unknown }
  const reply = {
    status(code: number) {
      state.status = code
      return reply
    },
    send(body: unknown) {
      state.body = body
      return reply
    },
  } as unknown as import('fastify').FastifyReply
  return { reply, state }
}

describe('sendOpenApiError', () => {
  test('OpenApiError(AUTH_FAILED) → HTTP 401 + body code/message', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.AUTH_FAILED))
    assert.equal(state.status, 401)
    assert.deepEqual(state.body, { result: { code: ErrorCode.AUTH_FAILED, message: '不符合创作规范' } })
  })

  test('OpenApiError(PARAM_ERROR) → HTTP 422（对齐源项目 RequestValidationError 全局 handler）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.PARAM_ERROR))
    assert.equal(state.status, 422)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })

  test('OpenApiError(DUPLICATE_TASK) → HTTP 400', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.DUPLICATE_TASK))
    assert.equal(state.status, 400)
  })

  test('OpenApiError(EXTERNAL_SERVICE_FAILED) → HTTP 400', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.EXTERNAL_SERVICE_FAILED))
    assert.equal(state.status, 400)
  })

  test('OpenApiError(MODEL_CONFIG_ERROR) → HTTP 400', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.MODEL_CONFIG_ERROR))
    assert.equal(state.status, 400)
  })

  test('OpenApiError(SECURITY_CHECK_FAILED) → HTTP 400 + 公开文案「含敏感信息」', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.SECURITY_CHECK_FAILED))
    assert.equal(state.status, 400)
    assert.equal((state.body as { result: { message: string } }).result.message, '含敏感信息')
  })

  test('OpenApiError(SYSTEM_FAILED) → HTTP 500（内部异常不泄漏堆栈）', () => {
    const { reply, state } = createMockReply()
    // rawMessage 含内部堆栈，但 publicMessage 必须为固定文案
    sendOpenApiError(reply, new OpenApiError(ErrorCode.SYSTEM_FAILED, '内部堆栈：DB 连接超时'))
    assert.equal(state.status, 500)
    assert.equal((state.body as { result: { message: string } }).result.message, '不符合创作规范')
    // body 内不得出现 rawMessage
    assert.equal(JSON.stringify(state.body).includes('DB 连接超时'), false)
  })

  test('Fastify schema 校验失败（err.validation）→ HTTP 422 + PARAM_ERROR', () => {
    const { reply, state } = createMockReply()
    const validationError = Object.assign(new Error('body must be string'), {
      validation: [{ field: 'task_id', message: 'required' }],
    })
    sendOpenApiError(reply, validationError)
    assert.equal(state.status, 422)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })

  test('未知异常 → HTTP 500 + SYSTEM_FAILED（不暴露内部文本）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new Error('unexpected: boom'))
    assert.equal(state.status, 500)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.SYSTEM_FAILED)
    // body 内不得出现原始异常文本
    assert.equal(JSON.stringify(state.body).includes('boom'), false)
  })

  test('校验错误优先于 OpenApiError 判定（validation + instanceof 不冲突）', () => {
    // 即使错误对象同时是某种 Error，只要带 validation 字段就走 422
    const { reply, state } = createMockReply()
    const err = new OpenApiError(ErrorCode.AUTH_FAILED)
    ;(err as unknown as { validation: unknown[] }).validation = []
    sendOpenApiError(reply, err)
    assert.equal(state.status, 422)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })
})
