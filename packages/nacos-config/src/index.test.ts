// index.test.ts
//
// 验证 loadNacosConfig 编排逻辑：
// 1. 注入 mock source 时，遍历所有 dataId 并写入 env
// 2. 未注入 source 且未配 NACOS_SERVER_ADDR 时直接失败（AI 配置必须来自 Nacos）
// 3. 单个 dataId 失败会阻止启动，避免局部旧配置混用

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { loadNacosConfig, AI_CONFIG_DATA_IDS, AI_CONFIG_GROUP } from './index.js'
import type { ConfigSource, DiffRecord } from './apply-config.js'

const NACOS_ENV_KEYS = ['NACOS_SERVER_ADDR', 'NACOS_NAMESPACE', 'NACOS_USERNAME', 'NACOS_PASSWORD']
const snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of NACOS_ENV_KEYS) snapshot[k] = process.env[k]
  // 默认清空，让"未配 server addr"场景可测
  for (const k of NACOS_ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of NACOS_ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

describe('loadNacosConfig', () => {
  test('注入 mock source 时，对所有 dataId 调用 getConfig 并写入注入的 envSetter', async () => {
    let getConfigCount = 0
    let subscribeCount = 0
    const written: Record<string, string> = {}

    const mockSource: ConfigSource = {
      async getConfig(dataId, group) {
        getConfigCount++
        assert.equal(group, AI_CONFIG_GROUP)
        return `${dataId.replace(/[^A-Z]/gi, '_').toUpperCase()}=value-for-${dataId}`
      },
      subscribe(info, listener) {
        subscribeCount++
        return () => {}
      },
    }

    // 用捕获型 envSetter，避免污染真实 process.env
    const envSetter = (k: string, v: string) => {
      written[k] = v
    }

    await loadNacosConfig({
      source: mockSource,
      applyOptions: { envSetter },
      validateRequired: false,
    })

    // 每个 dataId 都被拉取且订阅
    assert.equal(getConfigCount, AI_CONFIG_DATA_IDS.length)
    assert.equal(subscribeCount, AI_CONFIG_DATA_IDS.length)
    // 至少有写入（dataId 内容被解析成 key=value）
    assert.ok(Object.keys(written).length > 0)
  })

  test('未配 NACOS_SERVER_ADDR 且未注入 source 时直接失败', async () => {
    await assert.rejects(
      () => loadNacosConfig(),
      /NACOS_SERVER_ADDR/,
    )
  })

  test('单个 dataId getConfig 失败时直接失败，避免局部配置启动', async () => {
    const getConfigCalls: string[] = []

    // 用单调递增的合法 key，便于断言"第一个失败后其余仍写入了"
    let idx = 0
    const mockSource: ConfigSource = {
      async getConfig(dataId) {
        getConfigCalls.push(dataId)
        idx += 1
        // 第一个 dataId 故意失败
        if (idx === 1) {
          throw new Error('mock nacos error for first dataId')
        }
        return `MOCK_KEY_${idx}=ok`
      },
      subscribe() {
        return () => {}
      },
    }

    const written: Record<string, string> = {}
    const envSetter = (k: string, v: string) => {
      written[k] = v
    }

    await assert.rejects(
      () => loadNacosConfig({
        source: mockSource,
        applyOptions: { envSetter },
        validateRequired: false,
      }),
      /mock nacos error for first dataId/,
    )

    assert.equal(getConfigCalls.length, 1)
    assert.equal(Object.keys(written).length, 0)
  })

  test('onDiff 回调能收到每个 key 的 before/after，且来源判断正确', async () => {
    // 准备：让 .env（process.env）里预先有不同状态的值
    // - DIFFTEST_ONLY_NACOS：.env 不配 → 期望 before=undefined（仅Nacos）
    // - DIFFTEST_OVERRIDE：.env 配旧值 → 期望 before!==after（Nacos覆盖）
    // - DIFFTEST_SAME：.env 配与 Nacos 相同值 → 期望 before===after（一致）
    delete process.env.DIFFTEST_ONLY_NACOS
    process.env.DIFFTEST_OVERRIDE = 'old-from-env'
    process.env.DIFFTEST_SAME = 'same-value'

    const collected: Array<{ key: string; before: string | undefined; after: string }> = []
    const onDiff = (records: DiffRecord[]) => collected.push(...records)

    const mockSource: ConfigSource = {
      async getConfig() {
        return [
          'DIFFTEST_ONLY_NACOS=nacos-only-value',
          'DIFFTEST_OVERRIDE=new-from-nacos',
          'DIFFTEST_SAME=same-value',
        ].join('\n')
      },
      subscribe() {
        return () => {}
      },
    }

    await loadNacosConfig({
      source: mockSource,
      applyOptions: { onDiff },
      validateRequired: false,
      clearExistingAiEnv: false,
    })

    // 找回三项 diff
    const onlyNacos = collected.find((d) => d.key === 'DIFFTEST_ONLY_NACOS')
    const override = collected.find((d) => d.key === 'DIFFTEST_OVERRIDE')
    const same = collected.find((d) => d.key === 'DIFFTEST_SAME')

    assert.ok(onlyNacos, '应收到 DIFFTEST_ONLY_NACOS 的 diff')
    assert.equal(onlyNacos!.before, undefined, '.env 未配时 before 应为 undefined')
    assert.equal(onlyNacos!.after, 'nacos-only-value')

    assert.equal(override!.before, 'old-from-env', '.env 的旧值应被记录为 before')
    assert.equal(override!.after, 'new-from-nacos', 'Nacos 的新值应被记录为 after')
    assert.notEqual(override!.before, override!.after, '覆盖场景 before≠after')

    assert.equal(same!.before, 'same-value')
    assert.equal(same!.after, 'same-value', '一致场景 before===after')

    // 清理测试写入的 env
    delete process.env.DIFFTEST_ONLY_NACOS
    delete process.env.DIFFTEST_OVERRIDE
    delete process.env.DIFFTEST_SAME
  })

  test('启动期允许未使用供应商的配置项为空，具体业务调用时再校验', async () => {
    const mockSource: ConfigSource = {
      async getConfig(dataId) {
        if (dataId === 'ai-providers-tokenbus.properties') {
          return [
            'TOKENBUS_API_BASE_URL=https://tokenbus.wangpudata.com',
            'TOKENBUS_API_KEY=tokenbus-key',
          ].join('\n')
        }
        if (dataId === 'ai-providers-volcengine.properties') {
          return [
            'VOLCENGINE_API_URL=',
            'VOLCENGINE_API_KEY=',
          ].join('\n')
        }
        if (dataId === 'ai-providers-podcast.properties') {
          return [
            'PODCAST_WS_URL=',
            'PODCAST_APP_ID=',
            'PODCAST_ACCESS_KEY=',
            'PODCAST_RESOURCE_ID=',
            'PODCAST_APP_KEY=',
            'PODCAST_TIMEOUT_SECONDS=120',
          ].join('\n')
        }
        return `${dataId.replace(/[^A-Z]/gi, '_').toUpperCase()}=configured`
      },
      subscribe() {
        return () => {}
      },
    }

    await loadNacosConfig({ source: mockSource })

    assert.equal(process.env.TOKENBUS_API_BASE_URL, 'https://tokenbus.wangpudata.com')
    assert.equal(process.env.PODCAST_WS_URL, '')

    delete process.env.TOKENBUS_API_BASE_URL
    delete process.env.TOKENBUS_API_KEY
    delete process.env.VOLCENGINE_API_URL
    delete process.env.VOLCENGINE_API_KEY
    delete process.env.PODCAST_WS_URL
    delete process.env.PODCAST_APP_ID
    delete process.env.PODCAST_ACCESS_KEY
    delete process.env.PODCAST_RESOURCE_ID
    delete process.env.PODCAST_APP_KEY
    delete process.env.PODCAST_TIMEOUT_SECONDS
  })
})
