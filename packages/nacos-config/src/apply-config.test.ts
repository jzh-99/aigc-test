// apply-config.test.ts
//
// 单元测试：parseProperties 解析 + applyConfig 写入与热更。
// 全部用手写 mock ConfigSource，不连接真实 Nacos。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { parseProperties, applyConfig, type ConfigSource } from './apply-config.js'

describe('parseProperties', () => {
  test('解析标准 KEY=VALUE 行', () => {
    const content = 'DOUBAO_API_KEY=sk-xxx\nDOUBAO_MODEL=ep-123'
    assert.deepEqual(parseProperties(content), [
      ['DOUBAO_API_KEY', 'sk-xxx'],
      ['DOUBAO_MODEL', 'ep-123'],
    ])
  })

  test('跳过空行与注释行', () => {
    const content = '# 这是注释\n\nDOUBAO_API_KEY=sk-xxx\n  # 缩进注释\n'
    assert.deepEqual(parseProperties(content), [['DOUBAO_API_KEY', 'sk-xxx']])
  })

  test('trim 行首尾与等号两侧空格', () => {
    const content = '  DOUBAO_API_KEY  =  sk-xxx  \n'
    assert.deepEqual(parseProperties(content), [['DOUBAO_API_KEY', 'sk-xxx']])
  })

  test('跳过非法 key（小写、数字开头、含连字符）', () => {
    const content = [
      'lower_case=key', // 小写不合法
      '1INVALID=key', // 数字开头不合法
      'HAS-DASH=key', // 含连字符不合法
      'VALID_KEY=val',
      'nodEqSign', // 无等号
    ].join('\n')
    assert.deepEqual(parseProperties(content), [['VALID_KEY', 'val']])
  })

  test('value 含等号时只按第一个等号切分', () => {
    // 某些值（如连接串）可能含 =，必须保留
    assert.deepEqual(parseProperties('CONN=postgres://u:p@h=5432'), [
      ['CONN', 'postgres://u:p@h=5432'],
    ])
  })

  test('空内容返回空数组', () => {
    assert.deepEqual(parseProperties(''), [])
    assert.deepEqual(parseProperties('   \n\n  '), [])
  })

  test('Windows 换行（\\r\\n）也能正确解析', () => {
    const content = 'A=1\r\nB=2\r\n'
    assert.deepEqual(parseProperties(content), [
      ['A', '1'],
      ['B', '2'],
    ])
  })
})

// ─── applyConfig 测试 ───────────────────────────────────────────────────────

/** 构造一个可控的 mock ConfigSource：记录 getConfig/subscribe 调用，可主动触发推送。 */
function makeMockSource(initialContent: string) {
  const getConfigCalls: Array<{ dataId: string; group: string }> = []
  const subscribeCalls: Array<{ dataId: string; group: string }> = []
  const listeners: Array<(content: string) => void> = []

  const source: ConfigSource = {
    async getConfig(dataId, group) {
      getConfigCalls.push({ dataId, group })
      return initialContent
    },
    subscribe(info, listener) {
      subscribeCalls.push(info)
      listeners.push(listener)
      return () => {
        /* no-op */
      }
    },
  }

  return {
    source,
    getConfigCalls,
    subscribeCalls,
    // 模拟 Nacos 推送配置变更
    push(newContent: string) {
      for (const l of listeners) l(newContent)
    },
  }
}

describe('applyConfig', () => {
  test('拉取一次并写入注入的 envSetter，注册订阅', async () => {
    const initial = 'DOUBAO_API_KEY=sk-initial\nDOUBAO_MODEL=ep-1'
    const { source, getConfigCalls, subscribeCalls } = makeMockSource(initial)
    const written: Array<[string, string]> = []
    const envSetter = (k: string, v: string) => written.push([k, v])

    await applyConfig(source, 'doubao.properties', 'AI_GROUP', { envSetter })

    assert.equal(getConfigCalls.length, 1)
    assert.equal(subscribeCalls.length, 1)
    assert.deepEqual(written, [
      ['DOUBAO_API_KEY', 'sk-initial'],
      ['DOUBAO_MODEL', 'ep-1'],
    ])
  })

  test('热更：订阅推送新内容时，envSetter 被再次调用写入新值', async () => {
    const { source, push } = makeMockSource('DOUBAO_API_KEY=sk-old')
    const written: Array<[string, string]> = []
    const envSetter = (k: string, v: string) => written.push([k, v])

    await applyConfig(source, 'doubao.properties', 'AI_GROUP', { envSetter })
    // 初始写入一次
    assert.deepEqual(written, [['DOUBAO_API_KEY', 'sk-old']])

    // 模拟 Nacos 推送变更
    push('DOUBAO_API_KEY=sk-new\nDOUBAO_MODEL=ep-2')
    assert.deepEqual(written, [
      ['DOUBAO_API_KEY', 'sk-old'],
      ['DOUBAO_API_KEY', 'sk-new'],
      ['DOUBAO_MODEL', 'ep-2'],
    ])
  })

  test('默认 envSetter 写入真实 process.env', async () => {
    // 用一个不太可能冲突的 key
    const { source } = makeMockSource('__NACOS_TEST_KEY_42__=hello')
    delete process.env.__NACOS_TEST_KEY_42__

    await applyConfig(source, 'test.properties', 'G')
    assert.equal(process.env.__NACOS_TEST_KEY_42__, 'hello')

    delete process.env.__NACOS_TEST_KEY_42__
  })

  test('applyToEnv=false 时不调用 envSetter', async () => {
    const { source } = makeMockSource('DOUBAO_API_KEY=sk-x')
    const written: Array<[string, string]> = []
    const envSetter = (k: string, v: string) => written.push([k, v])

    await applyConfig(source, 'x.properties', 'G', { applyToEnv: false, envSetter })
    assert.deepEqual(written, [])
  })

  test('坏格式行被静默跳过，不影响合法行写入', async () => {
    const { source } = makeMockSource('VALID=ok\nbad-key!\n#comment\nALSO_VALID=yes')
    const written: Array<[string, string]> = []
    const envSetter = (k: string, v: string) => written.push([k, v])

    await applyConfig(source, 'x.properties', 'G', { envSetter })
    assert.deepEqual(written, [
      ['VALID', 'ok'],
      ['ALSO_VALID', 'yes'],
    ])
  })
})
