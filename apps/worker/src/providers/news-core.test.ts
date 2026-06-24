// 必须在 import 拉入 storage/db 之前加载 .env（worker 走 bootstrap.ts 加载 .env）
import '../bootstrap.js'

// 资讯生成核心逻辑单元测试（Phase 6）。
//
// 测试目标：验证移植自源项目 news_provider.py 的核心逻辑正确性：
//   ① buildNewsPrompt：模板替换（{date}/{prompt} 占位符填充）
//   ② extractResponseText：Ark /responses 响应解析（output[].content[].type=output_text）
//   ③ normalizeNewsHtml：HTML 文档截取（DOCTYPE 起始 + </html> 结束）
//   ④ extractNewsMeta：正则提取 news-title/news-abstract（含超长截断）
//   ⑤ validateNewsHtml：结构校验（DOCTYPE/meta/必需标签/标签闭合）
//   ⑥ callArkResponses：mock fetch 验证 /responses payload（input/tools/thinking）
//   ⑦ generateNewsWithRetry：重试循环（HTML 验证失败→重试→成功；安全检测失败→重试→成功）
//
// 红线验证（对齐源 process_news_generation 重试循环）：
//   - 首次 HTML 校验失败（缺 meta）→ 重试 → 成功
//   - 首次安全检测失败 → 重试 → 安全通过
//   - 连续 3 次失败 → 返回 null（对齐源 result is None）
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildNewsPrompt,
  extractResponseText,
  normalizeNewsHtml,
  extractNewsMeta,
  validateNewsHtml,
  callArkResponses,
  generateNewsWithRetry,
  NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS,
} from './news-core.js'

// ─── mock 工具 ─────────────────────────────────────────────────────────────────
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

// 构造合法的 Ark /responses 响应（output[].content[].type=output_text）
function buildArkResponsesBody(html: string): unknown {
  return {
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: html }],
      },
    ],
  }
}

// 构造合法的资讯 HTML（含 news-title/news-abstract meta + 完整结构）
function buildValidNewsHtml(
  title = 'AI 行业资讯简报',
  abstract = '今日 AI 行业核心动态摘要',
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="news-title" content="${title}">
    <meta name="news-abstract" content="${abstract}">
    <title>资讯简报</title>
    <style>body { color: #333; }</style>
</head>
<body>
    <div class="header"><h1>简报</h1></div>
    <div class="section"><div class="news-item">新闻内容</div></div>
</body>
</html>`
}

// 构造缺少 meta 标签的 HTML（触发 validateNewsHtml 失败）
function buildHtmlWithoutMeta(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>资讯简报</title></head>
<body><div>内容</div></body>
</html>`
}

// 构造缺少 DOCTYPE 的文本（触发 normalizeNewsHtml/validateNewsHtml 失败）
function buildTextWithoutHtml(): string {
  return '这是纯文本，不是 HTML 文档'
}

before(() => {
  // 测试前确保 ARK_API_KEY 存在（callArkResponses 需要）
  if (!process.env.ARK_API_KEY) process.env.ARK_API_KEY = 'test-ark-key'
})

after(() => {
  restoreFetch()
})

describe('news-core: buildNewsPrompt', () => {
  test('模板替换：{date} 和 {prompt} 占位符被填充', () => {
    const prompt = buildNewsPrompt('AI 行业动态', '2026-06-23')
    assert.ok(prompt.includes('2026-06-23'), '应包含日期')
    assert.ok(prompt.includes('AI 行业动态'), '应包含用户要求')
    assert.ok(!prompt.includes('{date}'), '不应残留 {date} 占位符')
    assert.ok(!prompt.includes('{prompt}'), '不应残留 {prompt} 占位符')
  })
})

describe('news-core: extractResponseText', () => {
  test('从 output[].content[] 提取 output_text', () => {
    const data = {
      output: [
        { type: 'reasoning', content: [{ type: 'thinking', text: '推理过程' }] },
        { type: 'message', content: [{ type: 'output_text', text: '<html>内容</html>' }] },
      ],
    }
    assert.equal(extractResponseText(data), '<html>内容</html>')
  })

  test('兼容 type=text 的 content', () => {
    const data = { output: [{ type: 'message', content: [{ type: 'text', text: '文本' }] }] }
    assert.equal(extractResponseText(data), '文本')
  })

  test('无 message 类型 output 时抛错', () => {
    const data = { output: [{ type: 'reasoning', content: [] }] }
    assert.throws(() => extractResponseText(data), /missing output text/)
  })

  test('content 为空时抛错', () => {
    const data = { output: [{ type: 'message', content: [] }] }
    assert.throws(() => extractResponseText(data), /missing output text/)
  })
})

describe('news-core: normalizeNewsHtml', () => {
  test('从 DOCTYPE 截取到最后一个 </html>', () => {
    const text = '前导文本\n<!DOCTYPE html>\n<html><head></head><body></body></html>\n尾部'
    const html = normalizeNewsHtml(text)
    assert.ok(html.startsWith('<!DOCTYPE html>'))
    assert.ok(html.endsWith('</html>'))
    assert.ok(!html.includes('前导文本'))
    assert.ok(!html.includes('尾部'))
  })

  test('无 DOCTYPE 但有 <html> 时从 <html> 开始', () => {
    const text = '<html><head></head><body></body></html>'
    const html = normalizeNewsHtml(text)
    assert.ok(html.startsWith('<html>'))
  })

  test('无 HTML 文档时抛错', () => {
    assert.throws(() => normalizeNewsHtml('纯文本'), /missing HTML document/)
  })

  test('无 </html> 闭合时抛错', () => {
    assert.throws(() => normalizeNewsHtml('<html><body>未闭合'), /missing closing/)
  })
})

describe('news-core: extractNewsMeta', () => {
  test('提取 news-title 和 news-abstract', () => {
    const html = buildValidNewsHtml('测试标题', '测试摘要')
    const { title, abstract } = extractNewsMeta(html)
    assert.equal(title, '测试标题')
    assert.equal(abstract, '测试摘要')
  })

  test('单引号 meta 也能提取', () => {
    const html = `<html><head><meta name='news-title' content='单引号标题'></head><body></body></html>`
    const { title } = extractNewsMeta(html)
    assert.equal(title, '单引号标题')
  })

  test('news-title 超过 20 字截断', () => {
    const longTitle = '这是一个超过二十个字的标题应该被截断处理掉多余部分'
    const html = buildValidNewsHtml(longTitle)
    const { title } = extractNewsMeta(html)
    assert.equal(title!.length, 20, '应截断为 20 字')
    assert.equal(title, longTitle.slice(0, 20))
  })

  test('news-abstract 超过 200 字截断', () => {
    const longAbstract = '摘要'.repeat(150) // 300 字
    const html = buildValidNewsHtml('标题', longAbstract)
    const { abstract } = extractNewsMeta(html)
    assert.equal(abstract!.length, 200, '应截断为 200 字')
  })

  test('无 meta 时返回 null', () => {
    const html = buildHtmlWithoutMeta()
    const { title, abstract } = extractNewsMeta(html)
    assert.equal(title, null)
    assert.equal(abstract, null)
  })
})

describe('news-core: validateNewsHtml', () => {
  test('合法 HTML 通过校验', () => {
    const html = buildValidNewsHtml()
    const { title, abstract } = extractNewsMeta(html)
    assert.doesNotThrow(() => validateNewsHtml(html, title, abstract))
  })

  test('缺少 DOCTYPE 抛错', () => {
    const html = '<html><head></head><body></body></html>'
    assert.throws(() => validateNewsHtml(html, 't', 'a'), /DOCTYPE/)
  })

  test('title 为 null 抛错', () => {
    const html = buildValidNewsHtml()
    assert.throws(() => validateNewsHtml(html, null, 'a'), /meta tags/)
  })

  test('缺少 html 标签抛错', () => {
    const html = '<!DOCTYPE html><head></head><body></body>'
    assert.throws(() => validateNewsHtml(html, 't', 'a'), /required tags/)
  })

  test('缺少 head 标签抛错', () => {
    const html = '<!DOCTYPE html><html><body></body></html>'
    assert.throws(() => validateNewsHtml(html, 't', 'a'), /required tags/)
  })

  test('div 标签未闭合抛错', () => {
    const html = `<!DOCTYPE html><html><head><meta name="news-title" content="t"></head><body><div>未闭合</body></html>`
    assert.throws(() => validateNewsHtml(html, 't', 'a'), /mismatched/)
  })
})

describe('news-core: callArkResponses', () => {
  test('调用 /responses 端点，payload 含 input/tools/thinking', async () => {
    installFetchMock([{ body: buildArkResponsesBody(buildValidNewsHtml()) }])
    try {
      await callArkResponses({
        apiKey: 'test-key',
        prompt: 'AI 动态',
        date: '2026-06-23',
      })

      assert.equal(fetchCalls.length, 1)
      const call = fetchCalls[0]
      assert.ok(call.url.includes('/responses'), '应调用 /responses 端点')
      assert.equal(call.method, 'POST')

      const body = call.body as Record<string, unknown>
      // payload 结构对齐源 news_provider.py:176-190
      assert.ok(body.tools, '应含 tools（web_search）')
      assert.deepEqual(body.tools, [{ type: 'web_search' }])
      assert.deepEqual(body.thinking, { type: 'enabled' })
      assert.equal(body.stream, false)
      // input 结构：role=user + content[].type=input_text
      const input = body.input as Array<{ role: string; content: Array<{ type: string; text: string }> }>
      assert.equal(input[0].role, 'user')
      assert.equal(input[0].content[0].type, 'input_text')
      assert.ok(input[0].content[0].text.includes('2026-06-23'))
      assert.ok(input[0].content[0].text.includes('AI 动态'))

      // Authorization header
      assert.equal(call.headers['Authorization'], 'Bearer test-key')
    } finally {
      restoreFetch()
    }
  })

  test('返回解析后的 HTML + title + abstract', async () => {
    installFetchMock([{ body: buildArkResponsesBody(buildValidNewsHtml('我的标题', '我的摘要')) }])
    try {
      const result = await callArkResponses({
        apiKey: 'test-key',
        prompt: 'p',
        date: '2026-06-23',
      })
      assert.ok(result.html.startsWith('<!DOCTYPE html>'))
      assert.equal(result.title, '我的标题')
      assert.equal(result.abstract, '我的摘要')
    } finally {
      restoreFetch()
    }
  })

  test('HTTP 错误时抛错', async () => {
    installFetchMock([{ body: { error: 'rate limit' }, ok: false, status: 429 }])
    try {
      await assert.rejects(
        callArkResponses({ apiKey: 'k', prompt: 'p', date: '2026-06-23' }),
        /HTTP 429/,
      )
    } finally {
      restoreFetch()
    }
  })
})

describe('news-core: generateNewsWithRetry', () => {
  test('首次成功：不重试，返回结果', async () => {
    installFetchMock([{ body: buildArkResponsesBody(buildValidNewsHtml()) }])
    try {
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        caller: 'test',
      })
      assert.ok(result !== null)
      assert.equal(fetchCalls.length, 1, '只调用 1 次（首次成功）')
    } finally {
      restoreFetch()
    }
  })

  test('首次 HTML 校验失败（缺 meta）→ 重试 → 成功', async () => {
    // 第一次返回缺 meta 的 HTML（validateNewsHtml 抛错），第二次返回合法 HTML
    installFetchMock([
      { body: buildArkResponsesBody(buildHtmlWithoutMeta()) },
      { body: buildArkResponsesBody(buildValidNewsHtml('重试标题')) },
    ])
    try {
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        caller: 'test',
      })
      assert.ok(result !== null, '重试后应成功')
      assert.equal(result.title, '重试标题')
      assert.equal(fetchCalls.length, 2, '应调用 2 次（首次失败 + 重试成功）')
    } finally {
      restoreFetch()
    }
  })

  test('安全检测失败 → 重试 → 安全通过', async () => {
    installFetchMock([
      { body: buildArkResponsesBody(buildValidNewsHtml('首次')) },
      { body: buildArkResponsesBody(buildValidNewsHtml('重试')) },
    ])
    try {
      let checkCount = 0
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        securityChecker: async () => {
          checkCount++
          return checkCount === 1 ? false : true // 首次不安全，二次安全
        },
        caller: 'test',
      })
      assert.ok(result !== null)
      assert.equal(result.title, '重试')
      assert.equal(fetchCalls.length, 2, '安全检测失败应触发重新生成')
      assert.equal(checkCount, 2, '安全检测应调用 2 次')
    } finally {
      restoreFetch()
    }
  })

  test('连续 3 次 HTML 校验失败 → 返回 null', async () => {
    installFetchMock([
      { body: buildArkResponsesBody(buildHtmlWithoutMeta()) },
      { body: buildArkResponsesBody(buildHtmlWithoutMeta()) },
      { body: buildArkResponsesBody(buildHtmlWithoutMeta()) },
    ])
    try {
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        caller: 'test',
      })
      assert.equal(result, null, '3 次失败后应返回 null')
      assert.equal(fetchCalls.length, NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS, `应调用 ${NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS} 次`)
    } finally {
      restoreFetch()
    }
  })

  test('连续 3 次安全检测失败 → 返回 null', async () => {
    installFetchMock([
      { body: buildArkResponsesBody(buildValidNewsHtml()) },
      { body: buildArkResponsesBody(buildValidNewsHtml()) },
      { body: buildArkResponsesBody(buildValidNewsHtml()) },
    ])
    try {
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        securityChecker: async () => false, // 恒不安全
        caller: 'test',
      })
      assert.equal(result, null, '3 次安全检测失败应返回 null')
      assert.equal(fetchCalls.length, NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS)
    } finally {
      restoreFetch()
    }
  })

  test('Ark HTTP 错误也重试', async () => {
    installFetchMock([
      { body: {}, ok: false, status: 500 },
      { body: buildArkResponsesBody(buildValidNewsHtml('重试成功')) },
    ])
    try {
      const result = await generateNewsWithRetry({
        apiKey: 'k',
        prompt: 'p',
        date: '2026-06-23',
        caller: 'test',
      })
      assert.ok(result !== null)
      assert.equal(result.title, '重试成功')
      assert.equal(fetchCalls.length, 2)
    } finally {
      restoreFetch()
    }
  })
})
