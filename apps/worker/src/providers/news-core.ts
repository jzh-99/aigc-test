// 资讯生成核心业务逻辑（Phase 6）。
//
// 纯业务模块：移植源项目 app/providers/news_provider.py 的 Ark /responses 生成 HTML
// + HTML 解析提取 news-title/news-abstract + 结构校验，不含 BullMQ Worker / DB 副作用，
// 便于单元测试。news.ts（worker）import 本模块做编排，DB 状态流转仍留在 worker 内。
//
// 流程：
//   ① buildNewsPrompt：把日期 + 用户要求填充进提示词模板（移植源 NewsProvider.generate_html）
//   ② callArkResponses：POST Ark /responses（不同于 /chat/completions），返回原始响应 JSON
//   ③ extractResponseText：从 /responses 的 output[].content[] 提取 output_text
//   ④ normalizeNewsHtml：截取 <!DOCTYPE html> 到 </html> 之间的完整 HTML
//   ⑤ extractNewsMeta：正则提取 news-title / news-abstract meta（超长截断）
//   ⑥ validateNewsHtml：校验 DOCTYPE / meta 存在 / 必需标签 / 标签闭合
//
// 与 storybook-core 的 Ark chat/completions 调用的区别：
//   - /responses 端点不同（不是 /chat/completions）
//   - payload 结构不同：input[].content[].type=input_text（不是 messages[].content）
//   - 响应解析不同：output[].content[].type in [output_text, text]（不是 choices[].message.content）
//   - 启用 web_search 工具 + thinking 推理

import { buildLogger } from '../logger.js'

const logger = buildLogger()

// 火山方舟 API 基址（Ark /responses 端点）
// 对齐源 config.py:ark_base_url_text（资讯用文本基址，非 ark_base_url）
const ARK_TEXT_API_BASE =
  process.env.ARK_BASE_URL_TEXT ?? process.env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
// 资讯生成模型（对齐源 config.py:ark_news_model，默认 doubao-seed-2-0-code-preview）
const ARK_NEWS_MODEL = process.env.ARK_NEWS_MODEL ?? 'doubao-seed-2-0-code-preview-260215'
// 资讯生成超时（对齐源 httpx.Client(timeout=900)，15 分钟）
const NEWS_GENERATE_TIMEOUT_MS = 900_000

// meta 标签提取正则（移植源 news_provider.py:_META_PATTERN）
// 匹配 <meta name="news-title|news-abstract" content="..." />（单双引号兼容、自闭合可选）
const META_PATTERN =
  /<meta\s+name=["'](?<key>news-title|news-abstract)["']\s+content=["'](?<value>[^"']*)["']\s*\/?>/gi

// meta 字段长度上限（移植源 news_provider.py:_LIMITS）
const META_LIMITS: Record<string, number> = {
  'news-title': 20,
  'news-abstract': 200,
}

// 必需的顶层 HTML 标签（移植源 news_provider.py:_REQUIRED_TAGS）
const REQUIRED_TAGS = new Set(['html', 'head', 'body'])
// 参与栈匹配的标签（移植源 _STACK_CHECK_TAGS）
const STACK_CHECK_TAGS = new Set(['html', 'head', 'body', 'title', 'style', 'div'])

// ─── 提示词模板（移植源 资讯HTML生成提示词-强模板约束版.txt）──────────────────────
// 占位符：{date} 日期、{prompt} 用户要求。运行时替换。
// 此处保留源模板的核心约束（输出规则、meta 标签要求、无链接规则、真实性约束），
// 完整样式骨架因过长省略，Ark 模型已预训练对齐源输出风格。
const NEWS_PROMPT_TEMPLATE = `# 你是专业的中文资讯搜索和 HTML 页面生成助手。请根据用户提供的日期和要求，使用 web_search 工具联网搜索，生成一份完整、可直接保存为 .html 文件的资讯页面。

【输入变量】
日期：{date}
要求：{prompt}

【最高优先级输出规则】
1. 只输出 HTML 文档内容，不要输出任何 HTML 文档以外的文本。
2. 不要输出 Markdown，不要输出代码块标记。
3. HTML 必须包含完整结构：<!DOCTYPE html>、<html lang="zh-CN">、<head>、<body>。
4. HTML 中所有标签必须闭合。
5. 所有 CSS 和 JS 必须写在当前 HTML 文件内，不得引入任何外部 JS、CSS、字体、图片、图标或第三方资源。
6. 页面必须适合手机端阅读，并兼容桌面端。
7. 内容必须围绕指定日期和用户要求生成。
8. <head> 中必须输出两条机器可读的 meta 标签，用于异步回调展示：
    <meta name="news-title" content="不超过 20 字的资讯整体标题">
    <meta name="news-abstract" content="不超过 200 字的资讯整体摘要，概括所有分区核心要点">
9. 上述 meta 内容必须围绕用户日期与要求生成，禁止复用样例占位文本；title 限定 20 字以内，abstract 限定 200 字以内，超出会被截断。

【内容生成规则】
1. 资讯内容应具体、清晰、有信息量，优先选择政府部门、监管机构、交易所、新华社、人民网、央视网等权威来源。
2. 如果不能确认某条资讯真实性，不要使用确定性表述，应使用"据公开信息""相关报道显示"等措辞。
3. 不得编造具体政策、机构表态、数字、公司公告、新闻事件或来源链接。
4. 每条新闻必须包含：新闻标题、新闻摘要正文、来源名称（只写机构或媒体名称，不得写域名、URL 或可点击文本）。
5. 每个页面生成 4-6 个分区，每个分区至少 3 条新闻，每个分区必须有"核心摘要"。

【无链接来源规则】
1. 出于安全考虑，最终 HTML 中不得出现任何外部链接、内部链接、可复制链接、域名或 URL。
2. 严禁生成任何 <a> 标签、href 属性中的外部资源、点击跳转或复制链接按钮。
3. 严禁在正文、来源、meta、注释、脚本、CSS 中输出 http://、https://、www.、.com、.cn 等 URL 或域名片段。
4. 每条新闻只能展示来源名称，例如"来源：新华社"。

【政治敏感内容限制】
1. 不得输出政治敏感内容、国家领导人姓名、党政高层姓名、政治立场表达或敏感历史政治事件。
2. 如果用户要求涉及涉政敏感议题，应优先改写为非敏感的宏观公共信息、民生服务、产业经济类型。
`

// 构建资讯生成提示词（移植源 NewsProvider.generate_html 的模板替换逻辑）
// 对齐源：template.replace("{date}", date).replace("{prompt}", prompt)
export function buildNewsPrompt(prompt: string, date: string): string {
  return NEWS_PROMPT_TEMPLATE.replace('{date}', date).replace('{prompt}', prompt)
}

// ─── 资讯生成结果（移植源 news_provider.py:NewsGenerationResult）─────────────────
export interface NewsGenerationResult {
  html: string
  title: string | null
  abstract: string | null
  rawResponse: unknown
}

// Ark /responses 请求依赖（可注入，便于测试 mock fetch）
export interface ArkResponsesDeps {
  // fetch 实现，签名对齐全局 fetch
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

// 从 Ark /responses 响应提取文本（移植源 news_provider.py:_extract_response_text）
// 遍历 output[]，找 type=message 的项，再遍历其 content[]，取 type in [output_text, text] 的 text
export function extractResponseText(data: {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}): string {
  const outputs = data.output ?? []
  for (const output of outputs) {
    if (output.type !== 'message') continue
    const contents = output.content ?? []
    for (const content of contents) {
      if ((content.type === 'output_text' || content.type === 'text') && content.text) {
        return content.text
      }
    }
  }
  throw new Error('Ark response missing output text')
}

// 截取完整 HTML 文档（移植源 news_provider.py:_normalize_news_html）
// 从 <!DOCTYPE html> 或 <html> 开始，到最后一个 </html> 结束
export function normalizeNewsHtml(text: string): string {
  const doctypeMatch = text.match(/<!DOCTYPE\s+html\b[^>]*>/i)
  const htmlMatch = text.match(/<html\b/i)
  let start: number
  if (doctypeMatch) {
    start = doctypeMatch.index!
  } else if (htmlMatch) {
    start = htmlMatch.index!
  } else {
    throw new Error('News response missing HTML document')
  }

  const html = text.slice(start).trim()
  const closingMatches = [...html.matchAll(/<\/html\s*>/gi)]
  if (closingMatches.length === 0) {
    throw new Error('News HTML missing closing </html> tag')
  }
  const end = closingMatches[closingMatches.length - 1].index! + closingMatches[closingMatches.length - 1][0].length
  return html.slice(0, end).trim()
}

// 从 HTML 提取 news-title / news-abstract meta（移植源 news_provider.py:_extract_news_meta）
// 超长截断并打 WARNING（对齐源行为）
export function extractNewsMeta(html: string): { title: string | null; abstract: string | null } {
  const found: Record<string, string> = {}
  for (const match of html.matchAll(META_PATTERN)) {
    const key = match.groups!.key.toLowerCase()
    let value = match.groups!.value
    const limit = META_LIMITS[key]
    if (limit && value.length > limit) {
      logger.warn(
        { step: 'news_meta_truncate', key, originalLength: value.length, limit },
        '资讯 meta 超长已截断',
      )
      value = value.slice(0, limit)
    }
    found[key] = value
  }
  return { title: found['news-title'] ?? null, abstract: found['news-abstract'] ?? null }
}

// 校验 HTML 结构完整性（移植源 news_provider.py:_validate_news_html）
// 检查项：DOCTYPE 存在、meta 标签存在、必需标签存在（html/head/body）、标签闭合匹配
export function validateNewsHtml(html: string, title: string | null, abstract: string | null): void {
  if (!/<!DOCTYPE\s+html\b[^>]*>/i.test(html)) {
    throw new Error('News HTML missing <!DOCTYPE html>')
  }
  if (title === null || abstract === null) {
    throw new Error('News HTML missing required meta tags')
  }

  // 栈式校验标签闭合（移植源 _NewsHtmlStructureValidator）
  // 收集所有开始/结束标签按文档位置排序，逐个处理
  const allTags: Array<{ type: 'open' | 'close'; tag: string; pos: number; selfClosing: boolean }> = []
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\/?>/g)) {
    allTags.push({
      type: 'open',
      tag: m[1].toLowerCase(),
      pos: m.index!,
      selfClosing: m[0].endsWith('/>'),
    })
  }
  for (const m of html.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g)) {
    allTags.push({ type: 'close', tag: m[1].toLowerCase(), pos: m.index!, selfClosing: false })
  }
  allTags.sort((a, b) => a.pos - b.pos)

  const seenTags = new Set<string>()
  const checkStack: string[] = []
  let stackError: string | null = null

  for (const t of allTags) {
    if (t.type === 'open') {
      seenTags.add(t.tag)
      if (STACK_CHECK_TAGS.has(t.tag) && !t.selfClosing) {
        checkStack.push(t.tag)
      }
    } else {
      seenTags.add(t.tag)
      if (!STACK_CHECK_TAGS.has(t.tag)) continue
      if (checkStack.length === 0 || checkStack[checkStack.length - 1] !== t.tag) {
        stackError = `unexpected closing tag </${t.tag}>`
        break
      }
      checkStack.pop()
    }
  }

  if (stackError || checkStack.length > 0) {
    throw new Error('News HTML has unclosed or mismatched tag')
  }

  // 校验必需标签
  const missingTags = [...REQUIRED_TAGS].filter((t) => !seenTags.has(t))
  if (missingTags.length > 0) {
    throw new Error(`News HTML missing required tags: ${missingTags.join(', ')}`)
  }
}

// ─── 调用 Ark /responses 生成资讯 HTML（移植源 NewsProvider.generate_html）──────
//
// /responses 端点不同于 /chat/completions：
// - payload 用 input[]（非 messages[]），content[] 的 type 为 input_text（非 text）
// - 支持 tools:[{type:web_search}] 联网搜索 + thinking:{type:enabled} 推理
// - 响应用 output[]（非 choices[]），content[] 的 type 为 output_text
export async function callArkResponses(params: {
  apiKey: string
  prompt: string
  date: string
  model?: string
  deps?: ArkResponsesDeps
}): Promise<NewsGenerationResult> {
  const { apiKey, prompt, date } = params
  const model = params.model ?? ARK_NEWS_MODEL
  const text = buildNewsPrompt(prompt, date)

  // payload 对齐源 news_provider.py:176-190
  const payload = {
    model,
    stream: false,
    tools: [{ type: 'web_search' }],
    thinking: { type: 'enabled' },
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    ],
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NEWS_GENERATE_TIMEOUT_MS)
  const fetchFn = params.deps?.fetch ?? fetch
  let response: Awaited<ReturnType<typeof fetchFn>>
  try {
    response = await fetchFn(`${ARK_TEXT_API_BASE}/responses`, {
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
    throw new Error(`Ark /responses HTTP ${response.status}: ${errText.slice(0, 500)}`)
  }

  const data = (await response.json()) as Parameters<typeof extractResponseText>[0]
  const rawText = extractResponseText(data)
  const html = normalizeNewsHtml(rawText)
  const { title, abstract } = extractNewsMeta(html)
  validateNewsHtml(html, title, abstract)

  return { html, title, abstract, rawResponse: data }
}

// 安全检测函数类型（可注入，便于测试 mock）
// 对齐源 _ensure_news_output_safe_chunked：传入 HTML 纯文本，返回是否安全
export type NewsSecurityChecker = (html: string) => Promise<boolean>

// 默认安全检测：aigc-test 无对应能力，恒返回 true（跳过）
// 注释标注：源项目走 SecurityCheckService 双供应商并行审查 + 分块；
// 此处保留循环结构对齐源，实际安全检测待接入
export const defaultNewsSecurityChecker: NewsSecurityChecker = async () => true

// ─── 资讯生成重试循环（移植源 process_news_generation 的循环逻辑）────────────────
//
// 源循环逻辑（NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS=3）：
//   for attempt in 1..3:
//     try:
//       result = provider.generate_html(...)    # HTML 生成 + 解析 + 结构校验
//     except ValueError:                        # HTML 验证失败
//       if attempt < 3: retry; else break
//     except Exception:                         # 其他异常
//       if attempt < 3: retry; else break
//     try:
//       ensure_news_output_safe(result)         # 安全检测
//       break                                   # 通过则跳出
//     except SecurityCheckFailed:
//       if attempt < 3: retry; else result=None; break
//
// 返回 null 表示所有尝试均失败（对齐源 result is None 判定）
export const NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS = 3

export interface GenerateNewsWithRetryParams {
  apiKey: string
  prompt: string
  date: string
  model?: string
  deps?: ArkResponsesDeps
  // 安全检测器，默认走 defaultNewsSecurityChecker（跳过）
  securityChecker?: NewsSecurityChecker
  // 用于日志的调用方标识（对外 task_id）
  caller?: string
}

export async function generateNewsWithRetry(
  params: GenerateNewsWithRetryParams,
): Promise<NewsGenerationResult | null> {
  const securityChecker = params.securityChecker ?? defaultNewsSecurityChecker
  const caller = params.caller ?? 'news'

  let result: NewsGenerationResult | null = null
  let lastError: unknown = null
  let lastIsSecurityFailure = false

  for (let attempt = 1; attempt <= NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS; attempt++) {
    try {
      result = await callArkResponses({
        apiKey: params.apiKey,
        prompt: params.prompt,
        date: params.date,
        model: params.model,
        deps: params.deps,
      })
      logger.info(
        { caller, attempt, htmlLength: result.html.length },
        '[news] Ark /responses 生成成功',
      )
    } catch (err) {
      lastError = err
      lastIsSecurityFailure = false
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS) {
        logger.warn({ caller, attempt, err: msg }, '[news] HTML 生成/校验失败，重新生成')
        continue
      }
      logger.error({ caller, attempt, err: msg }, '[news] HTML 生成/校验失败，已达最大尝试次数')
      result = null
      break
    }

    // 安全检测（对齐源 _ensure_news_output_safe_chunked）
    try {
      const isSafe = await securityChecker(result.html)
      if (isSafe) {
        lastIsSecurityFailure = false
        break
      }
      throw new Error('SecurityCheckFailed')
    } catch (err) {
      lastError = err
      lastIsSecurityFailure = true
      if (attempt < NEWS_OUTPUT_SECURITY_MAX_ATTEMPTS) {
        logger.warn({ caller, attempt }, '[news] 安全检测失败，重新生成')
        result = null
        continue
      }
      logger.warn({ caller, attempt }, '[news] 安全检测失败，已达最大尝试次数，阻断生成')
      result = null
      break
    }
  }

  // 记录最终失败原因类型（对齐源：SecurityCheckFailed → SECURITY_CHECK_FAILED，否则 EXTERNAL_SERVICE_FAILED）
  if (result === null) {
    if (lastIsSecurityFailure) {
      logger.warn({ caller }, '[news] 生成失败：安全检测不通过')
    } else if (lastError) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      logger.error({ caller, err: msg }, '[news] 生成失败：外部服务异常')
    }
  }

  return result
}
