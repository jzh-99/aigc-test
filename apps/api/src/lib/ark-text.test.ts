// 文本润色 Ark provider 单元测试（Phase 7）。
//
// 测试目标（移植源 ark_text.py:ArkTextProvider 的逻辑正确性）：
//   ① buildTextSystemPrompt：create_mode 0-3 含对应场景名（音乐/图片/视频/绘本），4 含行业分类
//   ② polishText：payload 结构（thinking disabled / max_tokens 500 / messages[system,user]）
//   ③ polishText：返回 choices[0].message.content
//   ④ polishText：HTTP 错误抛错、响应缺 content 抛错
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { buildTextSystemPrompt, polishText } from './ark-text.js'

// ─── mock globalThis.fetch（参考 news-core.test.ts 模式）────────────────────────
const originalFetch = globalThis.fetch

interface FetchCall {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}
let fetchCalls: FetchCall[] = []
let fetchResponseQueue: Array<{ body: unknown; ok: boolean; status: number }> = []

function installFetchMock(responses: Array<{ body: unknown; ok?: boolean; status?: number }>): void {
  fetchCalls = []
  fetchResponseQueue = responses.map((r) => ({
    body: r.body,
    ok: r.ok ?? true,
    status: r.status ?? 200,
  }))
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers as Record<string, string>
      for (const [k, v] of Object.entries(h)) headers[k] = v
    }
    fetchCalls.push({
      url: typeof _input === 'string' ? _input : _input.toString(),
      method: init?.method ?? 'POST',
      body,
      headers,
    })
    const next = fetchResponseQueue.shift() ?? { body: {}, ok: true, status: 200 }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as Response
  }) as typeof globalThis.fetch
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

before(() => {
  if (!process.env.DOUBAO_API_KEY) process.env.DOUBAO_API_KEY = 'test-ark-key'
})

after(() => {
  restoreFetch()
})

describe('ark-text: buildTextSystemPrompt', () => {
  test('create_mode=0 含"音乐"场景', () => {
    const prompt = buildTextSystemPrompt('0')
    assert.ok(prompt.includes('音乐'), '应包含音乐场景')
    assert.ok(prompt.includes('文本润色助手'))
  })

  test('create_mode=1 含"图片"场景', () => {
    const prompt = buildTextSystemPrompt('1')
    assert.ok(prompt.includes('图片'))
  })

  test('create_mode=2 含"视频"场景', () => {
    const prompt = buildTextSystemPrompt('2')
    assert.ok(prompt.includes('视频'))
  })

  test('create_mode=3 含"绘本"场景', () => {
    const prompt = buildTextSystemPrompt('3')
    assert.ok(prompt.includes('绘本'))
  })

  test('create_mode=4 是行业分类助手', () => {
    const prompt = buildTextSystemPrompt('4')
    assert.ok(prompt.includes('行业分类助手'))
    assert.ok(prompt.includes('热点新闻'))
    // 行业分类不含"文本润色助手"
    assert.ok(!prompt.includes('文本润色助手'))
  })
})

describe('ark-text: polishText', () => {
  test('调用 /chat/completions，payload 含 thinking disabled + max_tokens 500 + messages', async () => {
    installFetchMock([
      { body: { choices: [{ message: { content: '润色后的提示词' } }] } },
    ])
    try {
      const result = await polishText({
        apiKey: 'test-key',
        inputText: '一只猫',
        createMode: '1',
      })
      assert.equal(result, '润色后的提示词')

      assert.equal(fetchCalls.length, 1)
      const call = fetchCalls[0]
      // 端点是 /chat/completions（不是 /responses）
      assert.ok(call.url.includes('/chat/completions'), '应调用 /chat/completions 端点')
      assert.equal(call.method, 'POST')
      assert.equal(call.headers['Authorization'], 'Bearer test-key')

      const body = call.body as Record<string, unknown>
      // payload 结构对齐源 ark_text.py:13-21
      assert.deepEqual(body.thinking, { type: 'disabled' })
      assert.equal(body.max_tokens, 500)
      const messages = body.messages as Array<{ role: string; content: string }>
      assert.equal(messages.length, 2)
      assert.equal(messages[0].role, 'system')
      assert.equal(messages[1].role, 'user')
      assert.equal(messages[1].content, '一只猫')
      // create_mode=1 的 system prompt 含"图片"
      assert.ok(messages[0].content.includes('图片'))
    } finally {
      restoreFetch()
    }
  })

  test('create_mode=4 的 system prompt 是行业分类', async () => {
    installFetchMock([
      { body: { choices: [{ message: { content: '科技互联网、金融' } }] } },
    ])
    try {
      await polishText({ apiKey: 'k', inputText: '某文本', createMode: '4' })
      const body = fetchCalls[0].body as { messages: Array<{ content: string }> }
      assert.ok(body.messages[0].content.includes('行业分类助手'))
    } finally {
      restoreFetch()
    }
  })

  test('HTTP 错误抛错', async () => {
    installFetchMock([{ body: { error: 'rate limit' }, ok: false, status: 429 }])
    try {
      await assert.rejects(
        polishText({ apiKey: 'k', inputText: 't', createMode: '0' }),
        /HTTP 429/,
      )
    } finally {
      restoreFetch()
    }
  })

  test('响应缺 choices 抛错', async () => {
    installFetchMock([{ body: { unexpected: true } }])
    try {
      await assert.rejects(
        polishText({ apiKey: 'k', inputText: 't', createMode: '0' }),
        /missing choices/,
      )
    } finally {
      restoreFetch()
    }
  })

  test('choices[0].message.content 非字符串抛错', async () => {
    installFetchMock([{ body: { choices: [{ message: { content: null } }] } }])
    try {
      await assert.rejects(
        polishText({ apiKey: 'k', inputText: 't', createMode: '0' }),
        /missing choices/,
      )
    } finally {
      restoreFetch()
    }
  })
})
