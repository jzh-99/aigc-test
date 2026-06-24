// 文本润色 Ark provider（Phase 7，同步链路）。
//
// 移植源项目 app/providers/ark_text.py:ArkTextProvider.polish：
//   - POST {ARK_BASE_URL_TEXT}/chat/completions（注意：不是 /responses）
//   - payload：{model, thinking:{type:disabled}, max_tokens:500, messages:[system, user]}
//   - system prompt 按 create_mode 分流：0-3 对应 音乐/图片/视频/绘本 润色，4 行业分类
//   - 超时 60s（对齐源 httpx.Client(timeout=60)）
//   - 返回 choices[0].message.content
//
// 与 news-core（资讯，Ark /responses）的区别：
//   - 端点 /chat/completions（非 /responses）
//   - payload 用 messages[]（非 input[]）+ thinking disabled（非 enabled）
//   - 响应解析 choices[0].message.content（非 output[].content[].output_text）
//   - 无 web_search 工具、无推理链
//
// 同步链路：api 进程直接调用（不走 BullMQ），对齐源 routes_text.py 的同步语义。
// 纯逻辑函数（无 DB/无 worker 副作用），便于单元测试 mock fetch。

// Ark 文本基址（对齐源 config.py:ark_base_url_text）
// 源项目默认私有部署 IP http://117.80.225.73:18080/v1，aigc-test 不硬编码该私有地址，
// 回退顺序：ARK_BASE_URL_TEXT → ARK_BASE_URL → 官方域名（与 news-core 一致）。
// 生产环境必须由 .env 配置真实地址（否则 MODEL_CONFIG_ERROR）。
const ARK_TEXT_API_BASE =
  process.env.ARK_BASE_URL_TEXT ?? process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
// 文本润色模型（对齐源 config.py:ark_text_model，默认 doubao-seed-2-0-lite-260215）
const ARK_TEXT_MODEL = process.env.ARK_TEXT_MODEL ?? 'doubao-seed-2-0-lite-260215'
// 超时（对齐源 httpx.Client(timeout=60)，60 秒）
const TEXT_POLISH_TIMEOUT_MS = 60_000
// 最大输出 token（对齐源 payload max_tokens=500）
const TEXT_POLISH_MAX_TOKENS = 500

// create_mode → 场景名映射（对齐源 ark_text.py:modes）
const CREATE_MODE_NAMES: Record<string, string> = {
  '0': '音乐',
  '1': '图片',
  '2': '视频',
  '3': '绘本',
}

// 构造 system prompt（逐字移植源 ArkTextProvider._system_prompt）
// create_mode=4：行业分类助手；0-3：对应场景的文本润色助手
// 已剥离源 Python 三引号字符串的缩进空格（前导空白对模型语义无影响）
export function buildTextSystemPrompt(createMode: string): string {
  if (createMode === '4') {
    return `你是行业分类助手。请根据用户输入文本判断其所属行业分类。
要求：
1. 只输出2个中文行业分类，使用中文顿号"、"分隔。
2. 不要输出解释、编号、JSON、前后缀、标点句号或其他内容。
3. 行业分类应简洁、通用，例如：医疗健康、科技互联网、文化娱乐、教育培训、金融服务等
4. 如果用户输入的文本无法确定所属分类，只输出"热点新闻"，不要输出其他内容`
  }
  const modeName = CREATE_MODE_NAMES[createMode] ?? createMode
  return `你是专业的文本润色助手。请将用户输入直接改写成适合${modeName}创作场景的提示词。
要求：
1. 必须基于用户已提供的内容直接输出润色结果，即使内容很短或不完整也要合理补全。
2. 不要询问用户补充内容，不要道歉，不要解释你的能力。
3. 不要输出"请提供""您还没有提供""我可以帮你"等对话式内容。
4. 不改变用户核心意图，可补充细节、氛围、风格和画面感。
5. 只输出最终提示词。`
}

// Ark /chat/completions 调用依赖（可注入，便于测试 mock fetch 而不真实联网）
export interface ArkTextDeps {
  fetch?: (url: string, init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }) => Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
    text: () => Promise<string>
  }>
}

// 调用 Ark /chat/completions 执行文本润色（对齐源 ArkTextProvider.polish）
// 返回 choices[0].message.content；HTTP 错误或响应结构异常时抛错
// （由路由捕获并转为 EXTERNAL_SERVICE_FAILED + meta.output_text=""）。
export async function polishText(params: {
  apiKey: string
  inputText: string
  createMode: string
  model?: string
  deps?: ArkTextDeps
}): Promise<string> {
  const { apiKey, inputText, createMode } = params
  const model = params.model ?? ARK_TEXT_MODEL

  // payload 对齐源 ark_text.py:13-21
  const payload = {
    model,
    thinking: { type: 'disabled' },
    max_tokens: TEXT_POLISH_MAX_TOKENS,
    messages: [
      { role: 'system', content: buildTextSystemPrompt(createMode) },
      { role: 'user', content: inputText },
    ],
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEXT_POLISH_TIMEOUT_MS)
  const fetchFn = params.deps?.fetch ?? fetch
  let response: Awaited<ReturnType<typeof fetchFn>>
  try {
    response = await fetchFn(`${ARK_TEXT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Ark /chat/completions HTTP ${response.status}: ${errText.slice(0, 500)}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Ark /chat/completions response missing choices[0].message.content')
  }
  return content
}
