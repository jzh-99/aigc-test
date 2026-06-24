import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ErrorCode,
  errorMessage,
  successResponse,
  OpenApiError,
} from './open-api-errors.js'

describe('open-api-errors', () => {
  test('ErrorCode 值与文案锁定（逐字对齐源项目 errors.py）', () => {
    // 码值
    assert.equal(ErrorCode.SUCCESS, '0000')
    assert.equal(ErrorCode.PARAM_ERROR, '1001')
    assert.equal(ErrorCode.AUTH_FAILED, '1002')
    assert.equal(ErrorCode.MODEL_CONFIG_ERROR, '1003')
    assert.equal(ErrorCode.SECURITY_CHECK_FAILED, '2001')
    assert.equal(ErrorCode.DUPLICATE_TASK, '2002')
    assert.equal(ErrorCode.EXTERNAL_SERVICE_FAILED, '4001')
    assert.equal(ErrorCode.FILE_PROCESS_FAILED, '4002')
    assert.equal(ErrorCode.STORAGE_FAILED, '4003')
    assert.equal(ErrorCode.CALLBACK_FAILED, '4004')
    assert.equal(ErrorCode.SYSTEM_FAILED, '5001')

    // 文案
    assert.equal(errorMessage(ErrorCode.SUCCESS), '正在加速生成中，请稍等')
    assert.equal(errorMessage(ErrorCode.SECURITY_CHECK_FAILED), '含敏感信息')
    assert.equal(errorMessage(ErrorCode.SYSTEM_FAILED), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.PARAM_ERROR), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.AUTH_FAILED), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.MODEL_CONFIG_ERROR), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.DUPLICATE_TASK), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.EXTERNAL_SERVICE_FAILED), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.FILE_PROCESS_FAILED), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.STORAGE_FAILED), '不符合创作规范')
    assert.equal(errorMessage(ErrorCode.CALLBACK_FAILED), '不符合创作规范')
  })

  test('未知 code 兜底为「不符合创作规范」，不向客户端暴露内部异常', () => {
    assert.equal(errorMessage('9999'), '不符合创作规范')
  })

  test('successResponse 信封（对齐源项目 success_response，字段名保持对外契约拼写）', () => {
    assert.deepEqual(successResponse('t1'), {
      result: { task_id: 't1', code: '0000', message: '正在加速生成中，请稍等' },
    })
  })

  test('OpenApiError：对外只暴露固定文案，rawMessage 仅内部/日志使用', () => {
    const err = new OpenApiError(ErrorCode.SYSTEM_FAILED, '内部堆栈：连接超时')
    assert.equal(err.code, ErrorCode.SYSTEM_FAILED)
    assert.equal(err.publicMessage, '不符合创作规范')
    assert.equal(err.message, '内部堆栈：连接超时')
    assert.equal(err.rawMessage, '内部堆栈：连接超时')

    // 未传 rawMessage 时回退到固定文案
    const err2 = new OpenApiError(ErrorCode.SECURITY_CHECK_FAILED)
    assert.equal(err2.publicMessage, '含敏感信息')
    assert.equal(err2.message, '含敏感信息')
    assert.equal(err2.rawMessage, undefined)
  })

})
