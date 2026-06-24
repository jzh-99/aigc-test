// 绘本生成核心业务逻辑（Phase 4）。
//
// 纯业务模块：移植源项目 app/providers/storybook_provider.py 的两步流程，
// 不含 BullMQ Worker / DB 事务副作用，便于单元测试。
// storybook.ts（worker）import 本模块做编排，DB 状态流转仍留在 worker 内。
//
// 两步流程：
//   ① polishPrompt：Ark chat/completions 润色分镜（移植源 _polish_prompt）
//   ② generateGroupImages：seedream /images/generations 组图（移植源 _generate_group_images）
//   ③ transferImageToTos：逐张转存 TOS（移植源 MinioStorageClient.transfer，改 TOS）
import { getTos, getBucket, getPublicUrl } from '../lib/storage.js'
import { validateExternalUrl } from '../lib/url-validator.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

// 火山方舟 API 基址（统一用 DOUBAO_API_URL，与主线一致）
const DOUBAO_API_BASE = process.env.DOUBAO_API_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
// 绘本润色分镜模型（Ark chat/completions）
const STORYBOOK_POLISH_MODEL = process.env.DOUBAO_STORYBOOK_POLISH_MODEL ?? 'doubao-pro-32k'
// 绘本组图模型（seedream，支持 sequential_image_generation）
const STORYBOOK_IMAGE_MODEL = process.env.DOUBAO_STORYBOOK_IMAGE_MODEL ?? 'seedream-4.5'
// seedream 模型 ID 映射（对齐 volcengine-image.ts 的 MODEL_ID_MAP）
const SEEDREAM_MODEL_ID_MAP: Record<string, string> = {
  'seedream-5.0-lite': 'doubao-seedream-5-0-lite-260128',
  'seedream-4.5': 'doubao-seedream-4-5-251128',
  'seedream-4.0': 'doubao-seedream-4-0-250828',
}
// 组图请求超时（10 分钟，组图耗时长）
export const GROUP_IMAGE_TIMEOUT_MS = 600_000
// 润色请求超时（5 分钟）
export const POLISH_TIMEOUT_MS = 300_000
// 图片下载超时（30 秒）
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000

// 故事类别文案（对齐源 storybook_provider.py:CATEGORY_LABELS）
const CATEGORY_LABELS: Record<number, string> = {
  0: '故事文学',
  1: '科普教育',
  2: '习惯养成',
  3: '性格养成',
  4: '教育启蒙',
}

// 画风文案（对齐源 storybook_provider.py:STYLE_LABELS）
const STYLE_LABELS: Record<number, string> = {
  0: '卡通矢量',
  1: '可爱治愈',
  2: '清新扁平',
  3: '写实细腻',
}

// ─── 分镜润色：构建 system prompt（移植源 _polish_prompt）──────────────────────
export function buildPolishPrompt(prompt: string, age: string, category: number, style: number, pages: number): string {
  const categoryLabel = CATEGORY_LABELS[category] ?? String(category)
  const styleLabel = STYLE_LABELS[style] ?? String(style)
  return `# 角色

你是一位**绘本创作大师**。

## 任务

贴合用户指定的读者群，创作情节线性连贯的、生动有趣的、充满情绪价值和温度的、有情感共鸣的、分镜-文案-画面严格顺序对应的绘本内容。
核心约束：分镜拆分→文案（scenes）→画面描述（scenes_detail）必须1:1顺序绑定，从故事开头到结尾，像放电影一样按时间线推进，绝无错位。
用户故事：${prompt}
年龄段：${age}
类别：${categoryLabel}
风格：${styleLabel}
页数：${pages}

## 工作流程

1. 充分理解用户诉求，优先按照用户的创作细节要求执行。
2. 故事构思：创作一个能够精准回应用户诉求、提供情感慰藉的故事脉络，围绕共情和情绪价值展开。
3. 分镜结构与数量：必须生成 exactly ${pages} 个分镜，不能多也不能少，且不能超过10个。必须遵循清晰的叙事弧线：开端 → 发展 → 高潮 → 结局。
4. 文案与画面一一对应：
   - scenes：每个分镜创作具备情感穿透力的文案，文案必须与画面描述紧密贴合，禁止使用任何英文引号。
   - scenes_detail：每个分镜构思详细画面，画风必须贴合用户诉求和故事氛围，包含构图、光影、色彩、角色神态、动作和环境细节，达到可直接用于图片生成的标准。
5. title：构思一个简洁、好记、有创意的书名。
6. summary：创作一句不超过30个汉字的总结，凝练故事核心思想与情感价值。

## 安全限制

生成内容必须禁止暴力血腥、色情内容、仇恨歧视、违法危险行为、自残或危险行为描绘，整体保持普遍适宜的艺术创作范围。

## 输出格式要求

只输出 JSON，不要输出解释说明或 Markdown。scenes 和 scenes_detail 必须与分镜保持顺序一致，一一对应，数量必须等于 ${pages}。
{
  "title": "书名",
  "summary": "30字内的总结",
  "scenes": [
    "分镜1的文案，用50字篇幅传递情绪和情感，引发读者共鸣，语言风格需符合设定。",
    "分镜2的文案"
  ],
  "scenes_detail": [
    "图片1：这是第一页的画面描述。必须以'图片'+序号开头。要有强烈的视觉感，详细描述构图、光影、色彩、角色表情、动作和环境细节，符合生图提示词要求。",
    "图片2：这是第二页的画面描述。"
  ]
}
`
}

// ─── 组图 prompt（移植源 _build_image_prompt）─────────────────────────────────
export function buildImagePrompt(userPrompt: string, scenesDetail: string[], pages: number): string {
  const sceneDetails = scenesDetail.join('\n')
  return `用户原始需求：
${userPrompt}。

生成内容安全约束：请确保画面健康、积极、合规，适合公开展示和全年龄观看。避免任何不适宜、暴力、冒犯性、伤害性、违法违规、危险诱导或违反公序良俗的内容。避免出现公众人物、明星、政治人物、知名IP角色的真实或高相似度形象。如用户需求中存在不适宜元素，请自动转化为安全、温和、正向、非伤害性的表达。

请严格按照以下 ${pages} 页分镜顺序生成 ${pages} 张连续绘本图片。
第1张图片对应第1页，第2张图片对应第2页，以此类推。
保持角色、服装、画风、色彩一致。
以下是每页画面描述：
${sceneDetails}

最后，检查所有图片，去除图片中的文字。`
}

// 润色响应结构（对齐源 _build_storybook_response_format 的 json_schema）
export interface StorybookOutline {
  title: string
  summary: string
  scenes: string[]
  scenesDetail: string[]
}

// 去除 ``` 代码块围栏（移植源 _strip_json_fence）
function stripJsonFence(content: string): string {
  const text = content.trim()
  if (!text.startsWith('```')) return text
  let lines = text.split('\n')
  if (lines.length > 0 && lines[0].trim().startsWith('```')) lines = lines.slice(1)
  if (lines.length > 0 && lines[lines.length - 1].trim() === '```') lines = lines.slice(0, -1)
  return lines.join('\n').trim()
}

// 解析润色响应为 StorybookOutline（移植源 parse_storybook_outline）
export function parseStorybookOutline(content: string, pages: number): StorybookOutline {
  let data: unknown
  try {
    data = JSON.parse(stripJsonFence(content))
  } catch {
    throw new Error('绘本润色响应非合法 JSON')
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('绘本润色响应必须是 JSON 对象')
  }
  const obj = data as Record<string, unknown>
  const title = obj.title
  const summary = obj.summary
  const scenes = obj.scenes
  const scenesDetail = obj.scenes_detail
  if (typeof title !== 'string' || !title) throw new Error('绘本润色响应缺少 title')
  if (typeof summary !== 'string' || !summary) throw new Error('绘本润色响应缺少 summary')
  if (!Array.isArray(scenes) || !scenes.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new Error('绘本润色响应缺少 scenes')
  }
  if (!Array.isArray(scenesDetail) || !scenesDetail.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new Error('绘本润色响应缺少 scenes_detail')
  }
  if (scenes.length !== pages) {
    throw new Error(`绘本 scenes 数量 ${scenes.length} 不等于页数 ${pages}`)
  }
  if (scenesDetail.length !== pages) {
    throw new Error(`绘本 scenes_detail 数量 ${scenesDetail.length} 不等于页数 ${pages}`)
  }
  return {
    title,
    summary,
    scenes: scenes as string[],
    scenesDetail: scenesDetail as string[],
  }
}

// ─── 步骤①：Ark chat/completions 润色分镜 ──────────────────────────────────────
export async function polishPrompt(params: {
  apiKey: string
  prompt: string
  age: string
  category: number
  style: number
  pages: number
  caller: string
  taskId: string
}): Promise<StorybookOutline> {
  const { apiKey, prompt, age, category, style, pages, caller, taskId } = params
  const systemPrompt = buildPolishPrompt(prompt, age, category, style, pages)

  const requestBody = {
    model: STORYBOOK_POLISH_MODEL,
    messages: [{ role: 'user', content: systemPrompt }],
    // 对齐源 _build_storybook_response_format：强制返回结构化 JSON
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'storybook_outline',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            scenes: { type: 'array', items: { type: 'string' }, minItems: pages, maxItems: pages },
            scenes_detail: { type: 'array', items: { type: 'string' }, minItems: pages, maxItems: pages },
          },
          required: ['title', 'summary', 'scenes', 'scenes_detail'],
          additionalProperties: false,
        },
      },
    },
  }

  logger.info({ caller, taskId, model: STORYBOOK_POLISH_MODEL, pages }, '[storybook] 步骤1 润色分镜请求')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POLISH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${DOUBAO_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`润色接口 HTTP ${response.status}: ${errText.slice(0, 500)}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('润色响应缺少 content')
  }

  const outline = parseStorybookOutline(content, pages)
  logger.info(
    { caller, taskId, title: outline.title, scenesCount: outline.scenes.length },
    '[storybook] 步骤1 润色分镜成功',
  )
  return outline
}

// ─── 步骤②：seedream /images/generations 组图 ──────────────────────────────────
export async function generateGroupImages(params: {
  apiKey: string
  model: string
  userPrompt: string
  scenesDetail: string[]
  pages: number
  caller: string
  taskId: string
}): Promise<string[]> {
  const { apiKey, model, userPrompt, scenesDetail, pages, caller, taskId } = params
  const volcengineModel = SEEDREAM_MODEL_ID_MAP[model] ?? model
  const imagePrompt = buildImagePrompt(userPrompt, scenesDetail, pages)

  // 移植源 _generate_group_images 的 payload
  const requestBody = {
    model: volcengineModel,
    prompt: imagePrompt,
    size: '2K',
    // 批量组图核心参数：auto 自动按 prompt 内的页数生成，max_images 限制上限
    sequential_image_generation: 'auto',
    sequential_image_generation_options: { max_images: pages },
    output_format: 'png',
    response_format: 'url',
    watermark: true,
  }

  logger.info(
    { caller, taskId, model: volcengineModel, pages },
    '[storybook] 步骤2 组图请求',
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GROUP_IMAGE_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${DOUBAO_API_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`组图接口 HTTP ${response.status}: ${errText.slice(0, 500)}`)
  }

  const data = (await response.json()) as {
    data?: Array<{ url?: string }>
  }
  const urls = (data.data ?? [])
    .map((item) => item.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0)

  if (urls.length === 0) {
    throw new Error('组图响应缺少 image urls')
  }

  logger.info(
    { caller, taskId, imageCount: urls.length },
    '[storybook] 步骤2 组图成功',
  )
  return urls
}

// ─── 步骤③：下载单张图片到 Buffer ──────────────────────────────────────────────
async function downloadImageBuffer(url: string, index: number): Promise<Buffer> {
  // 复用 transfer.ts 的 SSRF 防护
  validateExternalUrl(url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`下载图片 ${index + 1} 失败: HTTP ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

// TOS 上传依赖（可注入，便于测试 mock putObject 而不真实连接 TOS）
// 用结构性接口描述所需方法，避免 TosClient 的 this 类型约束
export interface TosUploader {
  putObject(params: { bucket: string; key: string; body: Buffer; contentType: string }): Promise<unknown>
}

// ─── 步骤③：转存单张图片到 TOS，返回永久 URL ──────────────────────────────────
// tosUploader 可选注入：生产用 getTos()，测试传 mock 记录 putObject 调用
export async function transferImageToTos(
  sourceUrl: string,
  index: number,
  storageKeyPrefix: string,
  tosUploader?: TosUploader,
): Promise<{ storageUrl: string; buffer: Buffer; contentType: string }> {
  const buffer = await downloadImageBuffer(sourceUrl, index)
  const contentType = 'image/png'
  // key 格式：assets/storybook/<prefix>/page_<N>.png（按页码顺序，便于排查）
  const key = `${storageKeyPrefix}/page_${index + 1}.png`
  // 显式收窄为 TosUploader 接口调用，绕过 TosClient 的 this 类型约束
  const tos: TosUploader = tosUploader ?? (getTos() as unknown as TosUploader)
  await tos.putObject({ bucket: getBucket(), key, body: buffer, contentType })
  const storageUrl = `${getPublicUrl()}/${encodeURI(key)}`
  return { storageUrl, buffer, contentType }
}
