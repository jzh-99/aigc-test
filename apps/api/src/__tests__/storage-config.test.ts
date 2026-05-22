import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { disableTosAxiosEnvProxy, getStorageRuntimeInfo, normalizeTosEndpoint } from '../lib/storage.js'

describe('storage config', () => {
  test('TOS endpoint 进入 SDK 前会移除协议和路径', () => {
    assert.equal(normalizeTosEndpoint('http://tos-cn-shanghai.volces.com/'), 'tos-cn-shanghai.volces.com')
    assert.equal(normalizeTosEndpoint('https://tos-cn-shanghai.volces.com/path'), 'tos-cn-shanghai.volces.com')
  })

  test('运行时诊断只暴露无密钥的存储配置', () => {
    const info = getStorageRuntimeInfo()

    assert.equal(Object.hasOwn(info, 'tosAccessKeyId'), false)
    assert.equal(Object.hasOwn(info, 'tosSecretAccessKey'), false)
    assert.equal(Object.hasOwn(info, 's3SecretAccessKey'), false)
  })

  test('TOS SDK 的 axios 请求禁用环境代理', () => {
    let interceptor: ((config: { proxy?: unknown }) => { proxy: false }) | null = null
    const client = {
      axiosInst: {
        interceptors: {
          request: {
            use(fn: typeof interceptor) {
              interceptor = fn
            },
          },
        },
      },
    }

    disableTosAxiosEnvProxy(client)

    assert.deepEqual(interceptor?.({}), { proxy: false })
  })
})
