import assert from 'node:assert/strict'
import test from 'node:test'
import { disableTosAxiosEnvProxy, getStorageRuntimeInfo, normalizeTosEndpoint } from './storage.js'

test('worker TOS endpoint 进入 SDK 前会移除协议和路径', () => {
  assert.equal(normalizeTosEndpoint('http://tos-cn-shanghai.volces.com/'), 'tos-cn-shanghai.volces.com')
  assert.equal(normalizeTosEndpoint('https://tos-cn-shanghai.volces.com/path'), 'tos-cn-shanghai.volces.com')
})

test('worker TOS SDK 的 axios 请求禁用环境代理', () => {
  type RequestInterceptor = (config: { proxy?: unknown }) => { proxy: false }
  let interceptor: RequestInterceptor | undefined
  const client = {
    axiosInst: {
      interceptors: {
        request: {
          use(fn: RequestInterceptor) {
            interceptor = fn
          },
        },
      },
    },
  }

  disableTosAxiosEnvProxy(client)

  assert.deepEqual(interceptor?.({}), { proxy: false })
})

test('worker 存储运行时诊断不暴露密钥', () => {
  const info = getStorageRuntimeInfo()

  assert.equal(Object.hasOwn(info, 'tosAccessKeyId'), false)
  assert.equal(Object.hasOwn(info, 'tosSecretAccessKey'), false)
})
