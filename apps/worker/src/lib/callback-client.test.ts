import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { CallbackClient } from './callback-client.js'

/**
 * 伪造 fetch 调用的入参快照，用于断言签名头/body/URL
 */
interface FetchCall {
  url: string
  init: RequestInit | undefined
}

/**
 * 构造一个替换 globalThis.fetch 的实现，记录每次调用并返回指定 Response
 */
function mockFetch(
  calls: FetchCall[],
  respond: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    return respond(url, init)
  }) as typeof fetch
}

test('回调签名头格式为 sha256=<64 位 hex>，X-Timestamp 为 13 位毫秒', async () => {
  const calls: FetchCall[] = []
  const real = globalThis.fetch
  globalThis.fetch = mockFetch(calls, () => new Response('ok', { status: 200 }))
  try {
    const client = new CallbackClient(10, 'super-secret')
    await client.post('https://example.com/cb', { a: 1 })
  } finally {
    globalThis.fetch = real
  }

  assert.equal(calls.length, 1)
  const headers = new Headers(calls[0]!.init?.headers)
  assert.match(headers.get('X-Signature')!, /^sha256=[0-9a-f]{64}$/)
  assert.match(headers.get('X-Timestamp')!, /^\d{13}$/)
  assert.equal(headers.get('Content-Type'), 'application/json')
})

test('body 为紧凑 JSON：无多余空格且不转义中文', async () => {
  const calls: FetchCall[] = []
  const real = globalThis.fetch
  globalThis.fetch = mockFetch(calls, () => new Response('ok', { status: 200 }))
  try {
    const client = new CallbackClient(10, 'k')
    await client.post('https://example.com/cb', { a: 1, b: '中' })
  } finally {
    globalThis.fetch = real
  }

  const body = calls[0]!.init!.body as Buffer
  // 等价 Python ensure_ascii=False + separators=(",",":")
  assert.equal(body.toString('utf-8'), '{"a":1,"b":"中"}')
})

test('签名值等于 HMAC-SHA256(secret, body) 的 hex（仅含 body，不含 timestamp）', async () => {
  const calls: FetchCall[] = []
  const secret = 'my-secret-key'
  const real = globalThis.fetch
  globalThis.fetch = mockFetch(calls, () => new Response('ok', { status: 200 }))
  try {
    const client = new CallbackClient(10, secret)
    await client.post('https://example.com/cb', { task_id: 't1', ok: true })
  } finally {
    globalThis.fetch = real
  }

  const body = calls[0]!.init!.body as Buffer
  const headers = new Headers(calls[0]!.init?.headers)
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(headers.get('X-Signature'), expected)
})

test('HTTP 非 2xx 时抛错以触发上层重试', async () => {
  const calls: FetchCall[] = []
  const real = globalThis.fetch
  globalThis.fetch = mockFetch(calls, () => new Response('err', { status: 500 }))
  try {
    const client = new CallbackClient(10, 'k')
    await assert.rejects(
      () => client.post('https://example.com/cb', { a: 1 }),
      /callback http 500/,
    )
  } finally {
    globalThis.fetch = real
  }
  assert.equal(calls.length, 1)
})

test('3xx 也视为失败（对齐 Python raise_for_status 仅接受 2xx）', async () => {
  const real = globalThis.fetch
  globalThis.fetch = mockFetch([], () => new Response('redirected', { status: 302 }))
  try {
    const client = new CallbackClient(10, 'k')
    await assert.rejects(
      () => client.post('https://example.com/cb', { a: 1 }),
      /callback http 302/,
    )
  } finally {
    globalThis.fetch = real
  }
})

test('2xx 返回成功且不抛错', async () => {
  const real = globalThis.fetch
  globalThis.fetch = mockFetch([], () => new Response('ok', { status: 200 }))
  try {
    const client = new CallbackClient(10, 'k')
    await client.post('https://example.com/cb', { a: 1 })
  } finally {
    globalThis.fetch = real
  }
})
