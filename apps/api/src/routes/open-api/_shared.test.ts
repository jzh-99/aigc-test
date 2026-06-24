// 开放接口错误处理测试：验证 sendOpenApiError 四档语义
// 对齐源项目 app/api 两段式：HTTP 表达框架层结果，body result.code 表达业务结果
//   - schema 校验失败 → 422（源 main.py:39 RequestValidationError）
//   - AUTH_FAILED → 401（源 deps.py:22,39 认证 HTTPException）
//   - 其余业务错误 → 200（源 routes_*.py 路由内 return error_response）
//   - 未知异常 → 500 + SYSTEM_FAILED（不泄漏堆栈）
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
  test('Fastify schema 校验失败（err.validation）→ HTTP 422 + PARAM_ERROR', () => {
    const { reply, state } = createMockReply()
    const validationError = Object.assign(new Error('body must be string'), {
      validation: [{ field: 'task_id', message: 'required' }],
    })
    sendOpenApiError(reply, validationError)
    assert.equal(state.status, 422)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })

  test('OpenApiError(AUTH_FAILED) → HTTP 401 + body code/publicMessage（对齐源 deps 认证）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.AUTH_FAILED))
    assert.equal(state.status, 401)
    assert.deepEqual(state.body, { result: { code: ErrorCode.AUTH_FAILED, message: '不符合创作规范' } })
  })

  test('OpenApiError(DUPLICATE_TASK) → HTTP 200 + body code（业务错误走 200，关键对齐源路由）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.DUPLICATE_TASK))
    assert.equal(state.status, 200)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.DUPLICATE_TASK)
  })

  test('OpenApiError(SYSTEM_FAILED) → HTTP 200 + body code（不再 500，关键对齐源路由）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.SYSTEM_FAILED, '内部堆栈：DB 连接超时'))
    assert.equal(state.status, 200)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.SYSTEM_FAILED)
    // publicMessage 固定文案
    assert.equal((state.body as { result: { message: string } }).result.message, '不符合创作规范')
    // body 内不得出现 rawMessage
    assert.equal(JSON.stringify(state.body).includes('DB 连接超时'), false)
  })

  test('OpenApiError(SECURITY_CHECK_FAILED) → HTTP 200 + 公开文案「含敏感信息」', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.SECURITY_CHECK_FAILED))
    assert.equal(state.status, 200)
    assert.equal((state.body as { result: { message: string } }).result.message, '含敏感信息')
  })

  test('OpenApiError(EXTERNAL_SERVICE_FAILED) → HTTP 200（业务错误统一 200）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.EXTERNAL_SERVICE_FAILED))
    assert.equal(state.status, 200)
  })

  test('OpenApiError(MODEL_CONFIG_ERROR) → HTTP 200（路由内抛的业务错误走 200）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.MODEL_CONFIG_ERROR))
    assert.equal(state.status, 200)
  })

  test('OpenApiError(PARAM_ERROR) → HTTP 200（路由内手动抛的业务 PARAM，区别于 schema 422）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.PARAM_ERROR))
    assert.equal(state.status, 200)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })

  test('OpenApiError 不泄漏 rawMessage（只暴露 publicMessage）', () => {
    const { reply, state } = createMockReply()
    sendOpenApiError(reply, new OpenApiError(ErrorCode.EXTERNAL_SERVICE_FAILED, '供应商 5xx：upstream timeout'))
    assert.equal(JSON.stringify(state.body).includes('upstream timeout'), false)
    assert.equal(JSON.stringify(state.body).includes('供应商 5xx'), false)
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
    // 即使错误对象同时是 OpenApiError，只要带 validation 字段就走 422
    const { reply, state } = createMockReply()
    const err = new OpenApiError(ErrorCode.AUTH_FAILED)
    ;(err as unknown as { validation: unknown[] }).validation = []
    sendOpenApiError(reply, err)
    assert.equal(state.status, 422)
    assert.equal((state.body as { result: { code: string } }).result.code, ErrorCode.PARAM_ERROR)
  })
})
