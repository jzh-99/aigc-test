// 必须在 import 拉入 storage/db 之前加载 .env（worker 走 bootstrap.ts 加载 .env）
import '../bootstrap.js'

// 绘本生成 worker 单元测试（Phase 4）。
//
// 测试目标：验证移植自源项目的两步流程核心逻辑正确性：
//   ① buildPolishPrompt：Ark 润色 system prompt 构造（含 category/style 文案映射、pages 占位）
//   ② buildImagePrompt：组图 prompt 构造（含安全约束 + 分镜顺序）
//   ③ parseStorybookOutline：润色响应 JSON 解析（含 ``` 围栏剥离、字段校验、pages 数量校验）
//   ④ polishPrompt：mock fetch 验证 Ark chat/completions 的 payload（model/messages/response_format）
//   ⑤ generateGroupImages：mock fetch 验证 seedream /images/generations 的组图参数
//      （sequential_image_generation/max_images/size/output_format）
//   ⑥ transferImageToTos：mock fetch + TOS putObject 验证转存流程 + key 格式
//   ⑦ 错误处理：润色响应非法 JSON、组图无 url、HTTP 错误
//
// 不测 DB 事务/状态流转（markTaskSucceeded/markTaskFailed）：
//   - 这些复用 complete.ts/fail.ts 的事务模式，已被 image/music worker 充分覆盖
//   - 绘本 worker 的核心差异在两步流程，DB 流转是标准模式
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPolishPrompt,
  buildImagePrompt,
  parseStorybookOutline,
  polishPrompt,
  generateGroupImages,
  transferImageToTos,
} from './storybook-core.js'

// ─── mock 工具 ─────────────────────────────────────────────────────────────────
const originalFetch = globalThis.fetch

// 记录 fetch 调用 + 返回可配置响应
interface FetchCall {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}
let fetchCalls: FetchCall[] = []
let fetchResponses: Map<string, (body: unknown) => Response> = new Map()

function installFetchMock(responses: Record<string, (body: unknown) => Response> = {}): void {
  fetchCalls = []
  fetchResponses = new Map(Object.entries(responses))
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString()
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers as Record<string, string>
      for (const [k, v] of Object.entries(h)) headers[k] = v
    }
    fetchCalls.push({ url: urlStr, method: init?.method ?? 'GET', body, headers })

    // 按路径子串匹配响应工厂
    for (const [path, factory] of fetchResponses) {
      if (urlStr.includes(path)) {
        return factory(body)
      }
    }
    return new Response('{"error":"not mocked"}', { status: 404 })
  }) as typeof fetch
}

// ─── buildPolishPrompt ────────────────────────────────────────────────────────
describe('buildPolishPrompt（润色 system prompt 构造）', () => {
  test('含用户 prompt / age / category 文案 / style 文案 / pages 占位', () => {
    const prompt = buildPolishPrompt('小兔子的冒险', '3-6', 0, 1, 4)
    assert.ok(prompt.includes('小兔子的冒险'), '应含用户原始 prompt')
    assert.ok(prompt.includes('年龄段：3-6'), '应含 age')
    assert.ok(prompt.includes('类别：故事文学'), 'category=0 → 故事文学')
    assert.ok(prompt.includes('风格：可爱治愈'), 'style=1 → 可爱治愈')
    assert.ok(prompt.includes('exactly 4 个分镜'), '应含 pages=4 占位')
    assert.ok(prompt.includes('数量必须等于 4'), '输出格式约束应含 pages')
  })

  test('category/style 未知值回退为数字字符串', () => {
    const prompt = buildPolishPrompt('测试', '6+', 9, 9, 2)
    assert.ok(prompt.includes('类别：9'), '未知 category 回退为数字')
    assert.ok(prompt.includes('风格：9'), '未知 style 回退为数字')
  })
})

// ─── buildImagePrompt ─────────────────────────────────────────────────────────
describe('buildImagePrompt（组图 prompt 构造）', () => {
  test('含安全约束 + 分镜顺序 + 各页画面描述', () => {
    const scenesDetail = ['图片1：森林清晨', '图片2：小兔遇见狐狸']
    const prompt = buildImagePrompt('小兔子的冒险', scenesDetail, 2)
    assert.ok(prompt.includes('小兔子的冒险'), '应含用户原始需求')
    assert.ok(prompt.includes('生成内容安全约束'), '应含安全约束')
    assert.ok(prompt.includes('2 页分镜顺序'), '应含 pages 占位')
    assert.ok(prompt.includes('图片1：森林清晨'), '应含第1页画面')
    assert.ok(prompt.includes('图片2：小兔遇见狐狸'), '应含第2页画面')
    assert.ok(prompt.includes('保持角色、服装、画风、色彩一致'), '应含一致性约束')
  })
})

// ─── parseStorybookOutline ────────────────────────────────────────────────────
describe('parseStorybookOutline（润色响应解析）', () => {
  test('合法 JSON → 正确解析 title/summary/scenes/scenesDetail', () => {
    const content = JSON.stringify({
      title: '小兔历险记',
      summary: '勇敢的小兔',
      scenes: ['文案1', '文案2'],
      scenes_detail: ['画面1', '画面2'],
    })
    const outline = parseStorybookOutline(content, 2)
    assert.equal(outline.title, '小兔历险记')
    assert.equal(outline.summary, '勇敢的小兔')
    assert.deepEqual(outline.scenes, ['文案1', '文案2'])
    assert.deepEqual(outline.scenesDetail, ['画面1', '画面2'])
  })

  test('剥离 ```json 代码块围栏', () => {
    const content = '```json\n{"title":"t","summary":"s","scenes":["a"],"scenes_detail":["b"]}\n```'
    const outline = parseStorybookOutline(content, 1)
    assert.equal(outline.title, 't')
  })

  test('非法 JSON → 抛错', () => {
    assert.throws(() => parseStorybookOutline('not json', 1), /非合法 JSON/)
  })

  test('scenes 数量不等于 pages → 抛错', () => {
    const content = JSON.stringify({
      title: 't',
      summary: 's',
      scenes: ['a'],
      scenes_detail: ['b'],
    })
    assert.throws(() => parseStorybookOutline(content, 2), /数量 1 不等于页数 2/)
  })

  test('scenes_detail 含空串 → 抛错', () => {
    const content = JSON.stringify({
      title: 't',
      summary: 's',
      scenes: ['a', 'b'],
      scenes_detail: ['画面1', ''],
    })
    assert.throws(() => parseStorybookOutline(content, 2), /缺少 scenes_detail/)
  })

  test('缺 title → 抛错', () => {
    const content = JSON.stringify({
      summary: 's',
      scenes: ['a'],
      scenes_detail: ['b'],
    })
    assert.throws(() => parseStorybookOutline(content, 1), /缺少 title/)
  })
})

// ─── polishPrompt（mock fetch）─────────────────────────────────────────────────
describe('polishPrompt（Ark chat/completions 润色）', () => {
  before(() => {
    installFetchMock({
      '/chat/completions': (body) => {
        // 验证请求结构符合 Ark 契约后返回成功响应
        const pages = (body as { messages?: Array<{ content?: string }> }).messages?.[0]?.content
        // 从 prompt 中提取 pages（exactly N 个分镜）
        const match = pages?.match(/exactly (\d+) 个分镜/)
        const n = match ? parseInt(match[1], 10) : 1
        const scenes = Array.from({ length: n }, (_, i) => `文案${i + 1}`)
        const scenesDetail = Array.from({ length: n }, (_, i) => `图片${i + 1}：画面`)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '测试绘本',
                    summary: '测试摘要',
                    scenes,
                    scenes_detail: scenesDetail,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })
  })

  after(() => {
    globalThis.fetch = originalFetch
  })

  test('构造正确的 Ark chat/completions payload 并解析响应', async () => {
    const outline = await polishPrompt({
      apiKey: 'test-ark-key',
      prompt: '小兔子的冒险',
      age: '3-6',
      category: 0,
      style: 1,
      pages: 3,
      caller: 'caller-1',
      taskId: 'task-1',
    })

    // 验证 fetch 调用：URL + 方法 + Authorization
    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]
    assert.ok(call.url.includes('/chat/completions'), 'URL 应为 chat/completions')
    assert.equal(call.method, 'POST')
    assert.equal(call.headers.Authorization, 'Bearer test-ark-key')
    assert.equal(call.headers['Content-Type'], 'application/json')

    // 验证 payload：model / messages / response_format（json_schema 强制结构）
    const body = call.body as {
      model: string
      messages: Array<{ role: string; content: string }>
      response_format: { type: string; json_schema: { schema: { required: string[] } } }
    }
    assert.equal(typeof body.model, 'string')
    assert.equal(body.messages.length, 1)
    assert.equal(body.messages[0].role, 'user')
    assert.ok(body.messages[0].content.includes('小兔子的冒险'))
    assert.ok(body.messages[0].content.includes('3-6'))
    // response_format 强制返回结构化 JSON
    assert.equal(body.response_format.type, 'json_schema')
    assert.deepEqual(body.response_format.json_schema.schema.required, [
      'title',
      'summary',
      'scenes',
      'scenes_detail',
    ])

    // 验证响应解析：返回 3 页分镜
    assert.equal(outline.title, '测试绘本')
    assert.equal(outline.scenes.length, 3)
    assert.equal(outline.scenesDetail.length, 3)
  })

  test('HTTP 错误 → 抛错含状态码', async () => {
    installFetchMock({
      '/chat/completions': () =>
        new Response('{"error":"rate limit"}', { status: 429 }),
    })
    await assert.rejects(
      polishPrompt({
        apiKey: 'k',
        prompt: 'p',
        age: '3-6',
        category: 0,
        style: 0,
        pages: 1,
        caller: 'c',
        taskId: 't',
      }),
      /HTTP 429/,
    )
    globalThis.fetch = originalFetch
  })

  test('响应缺 content → 抛错', async () => {
    installFetchMock({
      '/chat/completions': () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    })
    await assert.rejects(
      polishPrompt({
        apiKey: 'k',
        prompt: 'p',
        age: '3-6',
        category: 0,
        style: 0,
        pages: 1,
        caller: 'c',
        taskId: 't',
      }),
      /缺少 content/,
    )
    globalThis.fetch = originalFetch
  })
})

// ─── generateGroupImages（mock fetch）──────────────────────────────────────────
describe('generateGroupImages（seedream 组图）', () => {
  before(() => {
    installFetchMock({
      '/images/generations': () =>
        new Response(
          JSON.stringify({
            data: [
              { url: 'https://ark.temp/page1.png' },
              { url: 'https://ark.temp/page2.png' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })
  })

  after(() => {
    globalThis.fetch = originalFetch
  })

  test('构造正确的 seedream 组图 payload（sequential_image_generation）并返回 URL 数组', async () => {
    const urls = await generateGroupImages({
      apiKey: 'test-key',
      model: 'seedream-4.5',
      userPrompt: '小兔子的冒险',
      scenesDetail: ['图片1：画面', '图片2：画面'],
      pages: 2,
      caller: 'caller',
      taskId: 'task',
    })

    // 验证返回顺序与数量
    assert.deepEqual(urls, ['https://ark.temp/page1.png', 'https://ark.temp/page2.png'])

    // 验证 fetch 调用
    assert.equal(fetchCalls.length, 1)
    const call = fetchCalls[0]
    assert.ok(call.url.includes('/images/generations'))
    assert.equal(call.method, 'POST')
    assert.equal(call.headers.Authorization, 'Bearer test-key')

    // 验证组图核心参数（移植源 _generate_group_images）
    const body = call.body as {
      model: string
      prompt: string
      size: string
      sequential_image_generation: string
      sequential_image_generation_options: { max_images: number }
      output_format: string
      response_format: string
      watermark: boolean
    }
    // model 映射：seedream-4.5 → doubao-seedream-4-5-251128
    assert.equal(body.model, 'doubao-seedream-4-5-251128')
    assert.ok(body.prompt.includes('小兔子的冒险'))
    assert.equal(body.size, '2K')
    assert.equal(body.sequential_image_generation, 'auto')
    assert.equal(body.sequential_image_generation_options.max_images, 2)
    assert.equal(body.output_format, 'png')
    assert.equal(body.response_format, 'url')
    assert.equal(body.watermark, true)
  })

  test('未知 model 直接透传（不映射）', async () => {
    installFetchMock({
      '/images/generations': () =>
        new Response(
          JSON.stringify({ data: [{ url: 'https://ark.temp/x.png' }] }),
          { status: 200 },
        ),
    })
    await generateGroupImages({
      apiKey: 'k',
      model: 'custom-model-v1',
      userPrompt: 'p',
      scenesDetail: ['画面'],
      pages: 1,
      caller: 'c',
      taskId: 't',
    })
    assert.equal((fetchCalls[0].body as { model: string }).model, 'custom-model-v1')
    globalThis.fetch = originalFetch
  })

  test('响应无 url → 抛错', async () => {
    installFetchMock({
      '/images/generations': () =>
        new Response(JSON.stringify({ data: [{ error: 'gen failed' }] }), { status: 200 }),
    })
    await assert.rejects(
      generateGroupImages({
        apiKey: 'k',
        model: 'seedream-4.5',
        userPrompt: 'p',
        scenesDetail: ['画面'],
        pages: 1,
        caller: 'c',
        taskId: 't',
      }),
      /缺少 image urls/,
    )
    globalThis.fetch = originalFetch
  })
})

// ─── transferImageToTos（mock fetch + 注入 tosUploader）───────────────────────
describe('transferImageToTos（转存 TOS）', () => {
  // 通过依赖注入的 tosUploader 记录 putObject 调用（避免真实连接 TOS）
  let putObjectCalls: Array<{ bucket: string; key: string; body: Buffer; contentType: string }> = []

  function makeMockUploader() {
    putObjectCalls = []
    return {
      async putObject(params: { bucket: string; key: string; body: Buffer; contentType: string }) {
        putObjectCalls.push(params)
        return {}
      },
    }
  }

  before(() => {
    // mock fetch：图片下载返回固定 PNG 字节
    installFetchMock({
      'ark.temp': () =>
        new Response(Buffer.from('fake-png-bytes'), { status: 200, headers: { 'content-type': 'image/png' } }),
    })
  })

  after(() => {
    globalThis.fetch = originalFetch
  })

  test('下载图片 + putObject 到 TOS，key 按 page 顺序命名', async () => {
    const uploader = makeMockUploader()
    const result = await transferImageToTos(
      'https://ark.temp/page1.png',
      0,
      'assets/storybook/task-123',
      uploader,
    )

    assert.ok(result.storageUrl.includes('assets/storybook/task-123/page_1.png'), 'key 应含 page_1.png')
    assert.equal(putObjectCalls.length, 1)
    assert.equal(putObjectCalls[0].key, 'assets/storybook/task-123/page_1.png')
    assert.equal(putObjectCalls[0].contentType, 'image/png')
    assert.ok(result.buffer.length > 0)
  })

  test('index 决定 key 中的 page 序号（1-based）', async () => {
    const uploader = makeMockUploader()
    await transferImageToTos('https://ark.temp/page2.png', 1, 'assets/storybook/task-123', uploader)
    assert.equal(putObjectCalls[0].key, 'assets/storybook/task-123/page_2.png')
  })
})
