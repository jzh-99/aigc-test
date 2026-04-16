import type { FastifyInstance } from 'fastify'
import { encryptProxyUrl } from '../lib/storage.js'

const PROXY_URL_PREFIX = '/api/v1/assets/proxy?token='
const BASE64_PROXY_PREFIX = `base64:${PROXY_URL_PREFIX}`

type ContentPart = { type?: unknown; [key: string]: unknown }

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function toAbsoluteUrl(pathOrUrl: string, baseUrl: string): string | null {
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl
  if (pathOrUrl.startsWith('/')) {
    if (!baseUrl) return null
    return `${normalizeBaseUrl(baseUrl)}${pathOrUrl}`
  }
  return null
}

function normalizeContentForUpstream(
  content: string | Array<{ type: string; [key: string]: unknown }>,
  publicBaseUrl: string,
): {
  content: string | Array<{ type: string; [key: string]: unknown }>
  totalMediaCount: number
  rewrittenMediaCount: number
  invalidMediaCount: number
} {
  if (typeof content === 'string') {
    return { content, totalMediaCount: 0, rewrittenMediaCount: 0, invalidMediaCount: 0 }
  }

  let totalMediaCount = 0
  let rewrittenMediaCount = 0
  let invalidMediaCount = 0

  const normalized = (content as ContentPart[]).map((part) => {
    const mediaType = part.type
    if (mediaType !== 'image_url' && mediaType !== 'video_url' && mediaType !== 'audio_url') return part

    totalMediaCount++
    const mediaKey = mediaType as 'image_url' | 'video_url' | 'audio_url'
    const mediaVal = part[mediaKey]
    if (!mediaVal || typeof mediaVal !== 'object') {
      invalidMediaCount++
      return part
    }

    const originalUrl = (mediaVal as { url?: unknown }).url
    if (typeof originalUrl !== 'string' || !originalUrl.trim()) {
      invalidMediaCount++
      return part
    }

    let nextUrl = originalUrl.trim()
    let changed = false

    if (nextUrl.startsWith(BASE64_PROXY_PREFIX)) {
      nextUrl = nextUrl.slice('base64:'.length)
      changed = true
    }

    if (nextUrl.startsWith('http://')) {
      if (!publicBaseUrl) {
        invalidMediaCount++
        return part
      }
      nextUrl = `${normalizeBaseUrl(publicBaseUrl)}${PROXY_URL_PREFIX}${encryptProxyUrl(nextUrl)}`
      changed = true
    } else if (nextUrl.startsWith('/')) {
      const absolute = toAbsoluteUrl(nextUrl, publicBaseUrl)
      if (!absolute) {
        invalidMediaCount++
        return part
      }
      nextUrl = absolute
      changed = true
    }

    if (!/^https?:\/\//i.test(nextUrl) && !nextUrl.startsWith('data:')) {
      invalidMediaCount++
      return part
    }

    if (changed) rewrittenMediaCount++

    return {
      ...part,
      [mediaKey]: {
        ...(mediaVal as Record<string, unknown>),
        url: nextUrl,
      },
    }
  })

  return {
    content: normalized as Array<{ type: string; [key: string]: unknown }>,
    totalMediaCount,
    rewrittenMediaCount,
    invalidMediaCount,
  }
}

const AI_SYSTEM_PROMPT = `你是画布工作流规划师。用户在使用一个 AI 内容生产画布。

【节点类型】
- text_input：文本节点，输出文字 prompt，无输入引脚
- image_gen：AI 生图节点，接收文本（prompt）和图片（参考图）
- video_gen：AI 视频节点，支持 multiref（多参考图）和 keyframe（首尾帧）两种模式
- asset：素材节点，持有已上传文件，只有输出引脚，不能执行生成
- script_writer：剧本生成节点，接收用户描述，输出完整剧本文本（含角色列表、场景列表）
- storyboard_splitter：分镜拆分节点，接收剧本文本，执行后在面板中展示可编辑分镜列表，用户确认后自动展开为多个 text_input 节点

【连线规则】
- text_input → image_gen（文本作为 prompt）
- image_gen → image_gen（图片作为参考）
- image_gen → video_gen（图片作为参考帧）
- asset → image_gen / video_gen（素材作为参考）

【布局规则】
- 起始节点 x=100，每向右一层 x+=350
- 同层多个节点 y 方向间距 300
- append 时新节点在已有节点右侧或下方延伸，避免重叠
- 新节点 id 必须以 "agent_" 前缀开头

【当前画布状态】
每条用户消息末尾会附带当前画布的 JSON 摘要，格式如下：
<canvas_context>
{
  "nodes": [{ "id": "...", "type": "...", "label": "...", "configSummary": "...", "hasOutput": true/false }],
  "edges": [{ "source": "...", "target": "..." }]
}
</canvas_context>
搭建工作流时必须参考此信息，避免重复创建已有节点。

【你的工作方式】
1. 先充分理解用户的创作意图：故事内容、风格、角色、场景、片段数量等
2. 如果用户描述不够具体，主动追问，直到你能规划出完整的工作流结构
3. 确认创作方向后，再询问是否有现成素材（ask_upload）
4. 素材确认后，输出 apply_workflow 搭建工作流（包含 script_writer 和 storyboard_splitter 节点）
5. 搭建完成后，通过 guide_step 逐步引导用户执行

【指令输出规则】
每次回复最多输出一条 instruction 指令，放在回复末尾：

\`\`\`instruction
{ "type": "...", ...指令数据 }
\`\`\`

不需要指令时（纯文字回复）不输出代码块。

【何时输出哪种指令】
- 用户刚描述需求，但故事/内容细节不足以规划工作流
  → 纯文字追问，不输出任何指令
- 创作内容已明确（故事、角色、场景、片段数量都清楚）
  → 输出 ask_upload，询问是否有现成素材
- 用户上传或引用了素材（消息中包含"已上传素材"或"已引用素材"）
  → 输出 annotate_assets，让用户标注素材用途
  → options.roles 填入剧本中的角色名列表，options.scenes 填入场景名列表，options.segments 填入片段序号列表
  → assets 字段直接从用户消息中的素材列表提取（包含 nodeId、name、mimeType、url）
- 用户描述了需要多个方案选择的需求（如"生成9种风格"）
  → 先输出 confirm_plan，让用户确认方案列表
- 用户说"没有素材"或跳过上传后，信息已充足
  → 输出 apply_workflow，搭建包含 script_writer + storyboard_splitter 的完整工作流
- 工作流已上画布，需要引导执行
  → 依次输出 guide_step，每次一步
- 所有步骤完成
  → 输出 done

【角色/场景描述节点写作规范】
角色形象节点（text_input → image_gen）的 config.text 只能包含：
✅ 时代背景（如：民国时期）
✅ 画风（如：写实风格、动漫风格）
✅ 外貌特征（发型、服装、体型、面部特征）
✅ 固定姿态（如：三视图正面/侧面/背面）

❌ 禁止包含：故事剧情、角色性格、其他角色信息、场景信息

场景设计节点（text_input → image_gen）的 config.text 只能包含：
✅ 时代背景
✅ 画风
✅ 场景视觉元素（建筑、陈设、植被、光线）
✅ 时间与天气

❌ 禁止包含：故事剧情、角色信息、其他场景信息

【禁止走捷径——以下行为一律不允许】
违反字面规则就是违反精神规则，没有例外。

❌ 禁止：用户只说了大方向（如"做个短视频"），就直接输出 ask_upload
   → 必须先追问：故事内容、角色、场景、片段数量，全部明确后才能进入下一步

❌ 禁止：用户说"没有素材，直接开始"，就跳过 apply_workflow 直接输出 guide_step
   → 必须先输出 apply_workflow 搭建工作流，再输出 guide_step

❌ 禁止：用户催促"快点搭建"，就在信息不足时输出 apply_workflow
   → 信息不足时只能追问，不能因为用户催促就跳步骤

❌ 禁止：apply_workflow 的 steps 数组为空
   → 每个工作流必须包含完整的步骤列表，至少 1 步

❌ 禁止：在 apply_workflow 中使用 "create" 策略清空画布
   → 始终使用 "append" 策略，已有节点通过 reusedNodeIds 复用

❌ 禁止：annotate_assets 的 assets 字段为空数组
   → 必须从用户消息中提取素材列表填入

❌ 禁止：在角色/场景描述节点中写入故事剧情或其他角色/场景信息
   → 严格遵守【角色/场景描述节点写作规范】

【自检清单——输出 apply_workflow 前必须确认】
1. 故事内容是否明确？（有剧情/主题）
2. 角色数量是否明确？
3. 场景数量是否明确？
4. 片段数量是否明确？
5. 是否已询问过素材？（ask_upload 已完成）
6. apply_workflow 中是否包含 script_writer 和 storyboard_splitter 节点？
7. steps 数组是否覆盖了所有生成步骤？
8. 所有 asset 节点的 nodeId 是否来自 canvas_context 或用户消息中的素材列表？
9. 每个 text_input 节点的 config.text 是否符合对应的写作规范？

以上任意一项不满足，禁止输出 apply_workflow，改为追问。

【视频创作的标准流程】

默认视频流程（multiref 模式）：
  Step 1：生成剧本（script_writer，needsRun=true）
  Step 2：拆分分镜（storyboard_splitter，needsRun=true）— 执行后用户在面板确认并展开分镜节点
  Step 3：生成人物三视图（image_gen × 角色数 × 3，needsRun=true）
  Step 4：生成场景设计图（image_gen × 场景数，needsRun=true）
  Step 5：生成视频片段（video_gen × 片段数，multiref 模式，needsRun=true）

首尾帧视频流程（keyframe 模式）：
  Step 1：生成剧本（script_writer，needsRun=true）
  Step 2：拆分分镜（storyboard_splitter，needsRun=true）
  Step 3：生成人物三视图（image_gen，needsRun=true）
  Step 4：生成场景设计图（image_gen，needsRun=true）
  Step 5：生成关键帧图片（image_gen × 片段数 × 2，needsRun=true）
  Step 6：生成视频片段（video_gen，keyframe 模式，needsRun=true）

用户上传了角色/场景素材时，对应步骤改用 asset 节点替代 image_gen 节点，并在 reusedNodeIds 中填入对应的 asset 节点 id。

script_writer 节点配置示例：
{
  "id": "agent_sw1",
  "type": "script_writer",
  "position": { "x": 100, "y": 100 },
  "data": {
    "label": "剧本生成",
    "config": { "description": "用户描述的故事内容", "style": "现代都市", "duration": 60 }
  }
}

storyboard_splitter 节点配置示例：
{
  "id": "agent_ss1",
  "type": "storyboard_splitter",
  "position": { "x": 450, "y": 100 },
  "data": {
    "label": "分镜拆分",
    "config": { "shotCount": 0 }
  }
}
连线：script_writer → storyboard_splitter（targetHandle: "any-in"）

【apply_workflow 输出格式】
workflow 字段结构：
{
  "strategy": "create" | "append",
  "summary": "一句话总结",
  "reusedNodeIds": [],
  "newNodes": [ ...节点数组... ],
  "newEdges": [ ...连线数组... ],
  "steps": [
    {
      "stepIndex": 0,
      "totalSteps": 5,
      "label": "确定剧本",
      "nodeIds": ["agent_n1"],
      "needsRun": false,
      "instruction": "给用户的操作说明",
      "nodeType": "text_input"
    }
  ]
}

注意：stepIndex 从 0 开始。

节点格式示例：
{
  "id": "agent_n1",
  "type": "text_input",
  "position": { "x": 100, "y": 100 },
  "data": {
    "label": "剧本",
    "config": { "text": "..." }
  }
}

连线格式示例：
{
  "id": "agent_e1",
  "source": "agent_n1",
  "target": "agent_n2",
  "sourceHandle": null,
  "targetHandle": "any-in"
}

【append 策略】
画布已有内容时：
- 分析已有节点是否与用户需求相关
- 相关节点直接复用（填入 reusedNodeIds），不重新创建
- 只追加缺失的节点和连线
- 不修改任何已有节点的参数`

export async function canvasAgentRoutes(app: FastifyInstance): Promise<void> {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? 'https://ai.comfly.chat'
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

  app.post<{
    Body: {
      content: string | Array<{ type: string; [key: string]: unknown }>
      canvasContext: {
        nodes: Array<{
          id: string
          type: string
          label: string
          configSummary: string
          hasOutput: boolean
        }>
        edges: Array<{ source: string; target: string }>
      }
      history: Array<{ role: 'user' | 'assistant'; content: string }>
    }
  }>(
    '/canvas-agent/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content', 'canvasContext'],
          properties: {
            content: {},
            canvasContext: {
              type: 'object',
              required: ['nodes', 'edges'],
              properties: {
                nodes: { type: 'array' },
                edges: { type: 'array' },
              },
            },
            history: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: 30000 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { content, canvasContext, history = [] } = request.body

      const configuredBaseUrl =
        process.env.AI_UPLOAD_BASE_URL
        ?? process.env.AVATAR_UPLOAD_BASE_URL
        ?? process.env.NEXT_PUBLIC_API_URL
        ?? ''

      const forwardedProto = firstHeader(request.headers['x-forwarded-proto'] as string | string[] | undefined)
      const forwardedHost = firstHeader(request.headers['x-forwarded-host'] as string | string[] | undefined)
      const host = firstHeader(request.headers.host as string | string[] | undefined)
      const fallbackBaseUrl =
        forwardedProto && forwardedHost
          ? `${forwardedProto}://${forwardedHost}`
          : host
            ? `${request.protocol}://${host}`
            : ''
      const publicBaseUrl = configuredBaseUrl || fallbackBaseUrl

      const normalized = normalizeContentForUpstream(content, publicBaseUrl)
      if (normalized.invalidMediaCount > 0) {
        app.log.warn(
          {
            totalMediaCount: normalized.totalMediaCount,
            rewrittenMediaCount: normalized.rewrittenMediaCount,
            invalidMediaCount: normalized.invalidMediaCount,
          },
          'Canvas agent media URL normalization failed',
        )
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_MEDIA_URL',
            message: '引用素材地址无效，请重新选择素材后再试',
          },
        })
      }

      if (normalized.rewrittenMediaCount > 0) {
        app.log.info(
          {
            totalMediaCount: normalized.totalMediaCount,
            rewrittenMediaCount: normalized.rewrittenMediaCount,
          },
          'Canvas agent media URL normalized',
        )
      }

      // Append canvas context to the user message so LLM always sees current canvas state
      const canvasContextStr = JSON.stringify(canvasContext, null, 2)
      const userContentWithContext = typeof normalized.content === 'string'
        ? `${normalized.content}\n\n<canvas_context>\n${canvasContextStr}\n</canvas_context>`
        : [
            ...(normalized.content as unknown[]),
            { type: 'text', text: `\n\n<canvas_context>\n${canvasContextStr}\n</canvas_context>` },
          ]

      const messages: unknown[] = [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContentWithContext },
      ]

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 300_000)

      let geminiRes: Response
      try {
        geminiRes = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({ model: AI_MODEL, messages, stream: true, max_tokens: 8000 }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text()
        app.log.error({ status: geminiRes.status, body: errText }, 'Canvas agent Gemini error')
        return reply.status(502).send({
          success: false,
          error: { code: 'AI_ERROR', message: 'AI助手暂时不可用，请稍后重试' },
        })
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const reader = geminiRes.body!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          reply.raw.write(decoder.decode(value, { stream: true }))
        }
      } finally {
        reply.raw.end()
      }
    },
  )

  // ── Script writer endpoint ────────────────────────────────────────────────

  const SCRIPT_WRITER_SYSTEM_PROMPT = `你是专业编剧。根据用户的简短描述，写一个适合AI视频生成的完整剧本。

要求：
- 剧本包含场景描述、角色对话、动作指示
- 角色描述只写外貌特征，不写姓名
- 场景描述只写视觉元素，不写抽象情感

严格按以下 JSON 格式输出，不要输出任何其他内容：
{
  "script": "完整剧本文本",
  "characters": ["角色外貌描述1", "角色外貌描述2"],
  "scenes": ["场景视觉描述1", "场景视觉描述2"]
}`

  app.post<{
    Body: { description: string; style: string; duration: number }
  }>(
    '/canvas-agent/script-write',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description', 'style', 'duration'],
          properties: {
            description: { type: 'string', maxLength: 2000 },
            style: { type: 'string', maxLength: 100 },
            duration: { type: 'number', minimum: 10, maximum: 600 },
          },
        },
      },
    },
    async (request, reply) => {
      const { description, style, duration } = request.body
      const shotCount = Math.ceil(duration / 10)

      const userPrompt = `风格：${style}\n目标时长：${duration}秒（约${shotCount}个镜头）\n\n用户描述：${description}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)

      let res: Response
      try {
        res = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: 'system', content: SCRIPT_WRITER_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 4000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Script writer LLM error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const raw = data.choices?.[0]?.message?.content ?? ''

      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('no JSON')
        const parsed = JSON.parse(jsonMatch[0]) as { script?: string; characters?: string[]; scenes?: string[] }
        return reply.send({
          success: true,
          script: parsed.script ?? raw,
          characters: parsed.characters ?? [],
          scenes: parsed.scenes ?? [],
        })
      } catch {
        // Fallback: return raw text as script
        return reply.send({ success: true, script: raw, characters: [], scenes: [] })
      }
    },
  )

  // ── Storyboard splitter endpoint ──────────────────────────────────────────

  const STORYBOARD_SPLIT_SYSTEM_PROMPT = `你是专业分镜师。将剧本分割成指定数量的10秒分镜。

每个分镜的 content 字段必须包含：
✅ 运镜方式（固定镜头、缓慢推进、俯拍等）
✅ 画面构图（近景、全景、特写等）
✅ 角色动作与表情（具体描述，用外貌描述代替角色名）
✅ 台词（如有）
✅ 背景环境（具体视觉描述，不写场景名）
✅ 光线与氛围
✅ 参考图引用（如：角色参考见[角色图1]，背景参考见[场景图2]）

❌ 禁止包含：完整故事大纲、其他镜头内容、与本镜头无关的角色信息、抽象情感描述

严格按以下 JSON 格式输出，不要输出任何其他内容：
{
  "shots": [
    { "id": "shot_1", "label": "镜头1", "content": "..." }
  ]
}`

  app.post<{
    Body: { script: string; shotCount: number }
  }>(
    '/canvas-agent/storyboard-split',
    {
      schema: {
        body: {
          type: 'object',
          required: ['script', 'shotCount'],
          properties: {
            script: { type: 'string', maxLength: 10000 },
            shotCount: { type: 'number', minimum: 0, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const { script, shotCount } = request.body
      const countInstruction = shotCount > 0 ? `分割成 ${shotCount} 个分镜` : '根据剧本内容自动决定分镜数量（每个分镜约10秒）'

      const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 90_000)

      let res: Response
      try {
        res = await fetch(`${AI_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${AI_API_KEY}`,
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              { role: 'system', content: STORYBOARD_SPLIT_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            max_tokens: 8000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Storyboard splitter LLM error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const raw = data.choices?.[0]?.message?.content ?? ''

      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('no JSON')
        const parsed = JSON.parse(jsonMatch[0]) as { shots?: Array<{ id?: string; label?: string; content?: string }> }
        const shots = (parsed.shots ?? []).map((s, i) => ({
          id: s.id ?? `shot_${i + 1}`,
          label: s.label ?? `镜头${i + 1}`,
          content: s.content ?? '',
        }))
        return reply.send({ success: true, shots })
      } catch {
        return reply.status(502).send({ success: false, error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
      }
    },
  )
}
