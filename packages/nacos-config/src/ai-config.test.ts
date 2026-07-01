// ai-config.test.ts
//
// 验证 getter 门面始终读取 process.env 当前值（这是热更生效的基础）。
// 通过改变 process.env 后重新访问 getter，确认拿到新值。

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  doubaoConfig,
  ctyunEdgeConfig,
  nanoBananaConfig,
  tokenbusConfig,
  podcastConfig,
  minimaxConfig,
} from './ai-config.js'

// 记录被测试改动的 env key，用后还原，避免污染其它测试
const KEYS = [
  'AI_CHAT_PROVIDER',
  'DOUBAO_API_URL',
  'DOUBAO_API_KEY',
  'DOUBAO_MODEL',
  'DOUBAO_NEWS_MODEL',
  'QWEN_API_URL',
  'QWEN_MODEL',
  'CTYUN_EDGE_API_BASE_URL',
  'NANO_BANANA_API_URL',
  'TOKENBUS_API_BASE_URL',
  'TOKENBUS_API_KEY',
  'MINIMAX_TTS_TIMEOUT_MS',
  'PODCAST_TIMEOUT_SECONDS',
]

const snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) snapshot[k] = process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

describe('ai-config getter 门面 - 热更基础', () => {
  test('getter 读 process.env 当前值，改 env 后 getter 返回新值', () => {
    delete process.env.DOUBAO_API_KEY
    assert.equal(doubaoConfig.apiKey, '')

    process.env.DOUBAO_API_KEY = 'sk-v1'
    assert.equal(doubaoConfig.apiKey, 'sk-v1')

    // 模拟 Nacos 推送新 key：覆盖 process.env
    process.env.DOUBAO_API_KEY = 'sk-v2-hotreload'
    assert.equal(doubaoConfig.apiKey, 'sk-v2-hotreload')
  })

  test('未配置时不再返回内置兜底值，AI 配置只认 Nacos 写入的 env', () => {
    delete process.env.DOUBAO_API_URL
    assert.equal(doubaoConfig.apiUrl, '')

    delete process.env.DOUBAO_MODEL
    assert.equal(doubaoConfig.model, '')

    delete process.env.AI_CHAT_PROVIDER
    assert.equal(doubaoConfig.chatProvider, '')
  })

  test('数字型字段解析为数字，缺省不再使用默认值', () => {
    delete process.env.MINIMAX_TTS_TIMEOUT_MS
    assert.equal(minimaxConfig.ttsTimeoutMs, 0)

    process.env.MINIMAX_TTS_TIMEOUT_MS = '12000'
    assert.equal(minimaxConfig.ttsTimeoutMs, 12_000)

    delete process.env.PODCAST_TIMEOUT_SECONDS
    assert.equal(podcastConfig.timeoutSeconds, 0)

    process.env.PODCAST_TIMEOUT_SECONDS = '60'
    assert.equal(podcastConfig.timeoutSeconds, 60)
  })

  test('各提供商门面独立可读', () => {
    process.env.CTYUN_EDGE_API_BASE_URL = 'https://ctyun.example.com'
    assert.equal(ctyunEdgeConfig.apiBaseUrl, 'https://ctyun.example.com')

    process.env.NANO_BANANA_API_URL = 'https://nb.example.com'
    assert.equal(nanoBananaConfig.apiUrl, 'https://nb.example.com')

    process.env.TOKENBUS_API_BASE_URL = 'https://tokenbus.wangpudata.com'
    process.env.TOKENBUS_API_KEY = 'tokenbus-key'
    assert.equal(tokenbusConfig.apiBaseUrl, 'https://tokenbus.wangpudata.com')
    assert.equal(tokenbusConfig.apiKey, 'tokenbus-key')
  })
})
