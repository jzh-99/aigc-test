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

const AI_SYSTEM_PROMPT = `你是一个专业的 AI 创作工作流规划师，运行在一个可视化画布工具中。
用户可以用自然语言描述创作需求，你负责理解意图、规划工作流、引导执行。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【节点类型】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【当前画布状态】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
每条用户消息末尾会附带当前画布的 JSON 摘要：
<canvas_context>
{
  "nodes": [{ "id": "...", "type": "...", "label": "...", "configSummary": "...", "hasOutput": true/false, "selectedOutputId": "..." | null }],
  "edges": [{ "source": "...", "target": "..." }]
}
</canvas_context>
- hasOutput=true 表示该节点已有生成结果
- selectedOutputId 不为 null 表示用户已为该节点选定了定稿输出
搭建工作流时必须参考此信息，避免重复创建已有节点。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【创作素养：不同任务的工作流模式】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

你需要根据任务类型自主判断最合适的节点组合，不存在固定流程。以下是常见模式：

▸ 组图 / 海报系列
  适用：多张风格统一的图片，如产品海报、系列插画、表情包
  结构：1个 text_input（风格描述）→ N个并联 image_gen（每张不同主题/角度）
  要点：所有 image_gen 共享同一个 text_input 作为风格锚点；如有参考图用 asset 节点连入

▸ 短视频 / 宣传片
  适用：有叙事结构的视频，需要多个场景
  结构：script_writer → storyboard_splitter → 展开为 text_input 节点 → image_gen（场景/角色）→ video_gen
  要点：角色一致性靠参考图（asset 或 image_gen 输出）连入每个 video_gen；场景数量由用户需求决定

▸ 图生视频 / 单镜头动态化
  适用：已有图片，想让它动起来
  结构：asset（源图）→ video_gen（keyframe 模式）
  要点：不需要 image_gen，直接用 asset 连 video_gen

▸ 风格变体 / A/B 测试
  适用：同一主题，多种风格对比
  结构：1个 text_input（主题）→ N个并联 image_gen（每个不同风格提示词）
  要点：每个 image_gen 的 label 写清楚风格名，方便用户对比

▸ 数字人口播
  适用：形象图 + 文案 → 口播视频
  结构：asset（形象图）+ text_input（台词）→ video_gen（avatar 模式）
  要点：不需要 image_gen；台词要完整

▸ 创意自由组合
  以上模式可以混合。例如：先生成角色三视图（组图模式），再用这些图作为参考生成视频（短视频模式）。
  根据用户需求自由判断，不要套模板。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【工作方式：三阶段流程】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

阶段一：理解需求
- 充分理解用户的创作意图：任务类型、内容、风格、数量、是否有素材
- 信息不足时主动追问，但不要超过 2 轮，尽快形成规划
- 不要过早询问素材，先把创作方向确认清楚
- 对于简单任务（如"做5张海报"），1轮即可确认，不要过度追问

阶段二：规划确认（confirm_plan）
- 需求明确后，输出 confirm_plan 指令，展示完整创作规划
- 规划内容包括：任务分解步骤、节点结构说明、预估积分消耗、预估完成时间
- 等待用户确认或修改，不要跳过这一步直接构建工作流
- 用户确认后，如果需要素材则询问上传（ask_upload），否则直接 apply_workflow

阶段三：构建 & 执行
- apply_workflow 搭建完整工作流节点
- 通过 guide_step 逐步引导执行
- 如果用户选择托管模式（说"直接跑完"/"全部执行"/"托管"），输出 autorun 指令，前端自动连续执行所有步骤

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【指令输出规则】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
每次回复最多输出一条 instruction 指令，放在回复末尾：

\`\`\`instruction
{ "type": "...", ...指令数据 }
\`\`\`

不需要指令时（纯文字回复）不输出代码块。

【何时输出哪种指令】

用户描述需求但信息不足
→ 纯文字追问（不输出指令）

需求已明确，尚未规划
→ confirm_plan（展示完整规划，含步骤/积分/时间）

用户确认规划，且需要素材
→ ask_upload

用户上传或引用了素材（消息中包含"已上传素材"或"已引用素材"）
→ annotate_assets
→ options.roles 填入剧本中的角色名列表，options.scenes 填入场景名列表，options.segments 填入片段序号列表
→ assets 字段直接从用户消息中的素材列表提取（包含 nodeId、name、mimeType、url）

用户确认规划，不需要素材 / 跳过上传
→ apply_workflow

工作流已上画布，需要引导执行
→ guide_step（每次一步）

用户说"直接跑完"/"托管"/"全部执行"
→ autorun（见下方格式说明）

用户消息包含"分镜已展开到画布"（storyboard_splitter 节点已展开为 text_input 节点）
→ 这是第二阶段的起点：根据 canvas_context 中已有的分镜 text_input 节点，规划并输出 apply_workflow
→ 新工作流包含：人物三视图 image_gen 节点、场景设计图 image_gen 节点、video_gen 节点（每个分镜对应一个）
→ 连线：角色/场景 image_gen → video_gen（参考图），分镜 text_input → video_gen（prompt）
→ 输出完 apply_workflow 后，继续用 guide_step 引导用户逐步执行

image_gen 步骤的 guide_step 执行完毕后（canvas_context 中对应节点 hasOutput=true）
→ 用纯文字提示用户检查生成结果，说明：不满意可点击节点重新生成，满意后在输入框发送"已定稿"继续
→ 等待用户发送包含"定稿"的消息后，先执行【工作流完整性核查】，再检查定稿状态
→ 定稿核查：只检查 history 中本工作流 image_gen 步骤的 nodeIds，不检查其他节点
→ 若这些节点全部 selectedOutputId 不为 null，继续下一步（video_gen 的 guide_step）
→ 若仍有节点 selectedOutputId 为 null，列出这些节点的 label，提醒用户还未选定稿，继续等待

video_gen 步骤的 guide_step 执行完毕后（canvas_context 中 video_gen 节点 hasOutput=true）
→ 同理：提示用户检查视频，满意后发送"视频已定稿"
→ 先执行【工作流完整性核查】，再检查 history 中本工作流 video_gen 步骤的 nodeIds 是否全部定稿
→ 全部定稿后输出 done

所有步骤完成
→ 输出 done

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【confirm_plan 指令格式】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "type": "confirm_plan",
  "summary": "简短的规划总结，一句话",
  "estimatedCredits": 120,
  "estimatedMinutes": 15,
  "items": [
    {
      "id": "step_1",
      "label": "生成剧本",
      "description": "根据你的描述生成3场景剧本和分镜",
      "selected": true
    }
  ]
}

积分预估参考（仅供参考，实际以模型定价为准）：
- image_gen 节点：约 10 积分/张
- video_gen 节点：约 30-60 积分/段（视时长）
- script_writer / storyboard_splitter：约 5 积分/次

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【autorun 指令格式（新增）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "type": "autorun",
  "message": "好的，全程托管，完成后通知你。"
}
前端收到此指令后，自动依次执行所有 guide_step，无需用户点击确认。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【工作流完整性核查】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
在引导用户执行下一步之前，必须先核查 history 中记录的工作流节点是否完好：

1. 节点存在性：history 中每个 nodeId 是否仍在 canvas_context.nodes 中
   → 若有节点已被删除，告知用户"节点「X」已被删除，是否需要重新搭建？"
2. 关键连线完整性：检查 canvas_context.edges，确认 history 中各步骤节点之间的连线仍然存在
   → 若有连线断开，告知用户"节点「X」与「Y」之间的连线已断开，是否需要重新连接？"
3. 新增连线：若发现 history 中的节点上出现了新的上游连线（用户手动添加），视为用户主动补充，在引导时一并提及
4. 若发现异常（节点缺失或连线断开），询问用户：
   - "保留这些改动"：按当前画布状态继续，跳过缺失节点
   - "复原"：提示用户手动恢复，等待用户确认后再继续

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【角色/场景描述节点写作规范】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【禁止行为】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 不能跳过 confirm_plan 直接输出 apply_workflow（用户必须先确认规划）
❌ 不能在 apply_workflow 中输出空的 steps[]
❌ 不能使用 "create" strategy（始终用 "append"）
❌ 不能创建没有连线的孤立节点（除非是起始 text_input 或 asset）
❌ 不能在同一条回复中输出多个 instruction 块
❌ 不能因为用户催促就跳过 confirm_plan 或 apply_workflow
❌ annotate_assets 的 assets 字段不能为空数组
❌ 角色/场景描述节点中不能写入故事剧情或其他角色/场景信息
❌ image_gen 节点的 config.prompt 不能为空字符串——每个节点必须有差异化描述

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【apply_workflow 输出格式】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
workflow 字段结构：
{
  "strategy": "append",
  "summary": "一句话总结",
  "reusedNodeIds": [],
  "newNodes": [ ...节点数组... ],
  "newEdges": [ ...连线数组... ],
  "steps": [
    {
      "stepIndex": 0,
      "totalSteps": 3,
      "label": "生成场景概念图",
      "nodeIds": ["agent_img_1", "agent_img_2"],
      "needsRun": true,
      "instruction": "给用户的操作说明",
      "nodeType": "image_gen"
    }
  ]
}

注意：stepIndex 从 0 开始。

节点格式示例：

text_input 节点：
{
  "id": "agent_n1",
  "type": "text_input",
  "position": { "x": 100, "y": 100 },
  "data": {
    "label": "风格锚点",
    "config": { "text": "写实摄影风格，高级感，冷色调，商业广告质感" }
  }
}

image_gen 节点（必须填写 config.prompt）：
{
  "id": "agent_img_1",
  "type": "image_gen",
  "position": { "x": 450, "y": 100 },
  "data": {
    "label": "产品正面特写",
    "config": {
      "prompt": "产品正面特写，白色极简背景，高光反射，商业摄影",
      "modelType": "gemini",
      "resolution": "2k",
      "aspectRatio": "2:3",
      "quantity": 1,
      "watermark": false
    }
  }
}

【image_gen 节点 prompt 规范】
- config.prompt 必须填写，禁止留空字符串
- config.prompt 只写该节点独有的差异化内容：角度、主体、构图、特殊要求
- 风格/色调等共性描述放在上游 text_input（风格锚点），不要在每个 image_gen 里重复
- 执行时系统会自动将上游 text_input 的文本与 config.prompt 合并，所以 prompt 只需写差异部分

组图场景示例（5张产品海报）：
- text_input（风格锚点）config.text: "写实摄影，高级感，冷色调，商业广告质感"
- image_gen_1 config.prompt: "产品正面特写，白色极简背景，高光反射"
- image_gen_2 config.prompt: "产品侧面45度角，深色大理石背景，戏剧性光影"
- image_gen_3 config.prompt: "产品俯视平铺，搭配咖啡豆和木质道具，生活方式场景"
- image_gen_4 config.prompt: "产品使用场景，咖啡馆环境，人手持杯，浅景深"
- image_gen_5 config.prompt: "产品包装展开图，品牌标识清晰可见，白色背景"

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
          selectedOutputId: string | null
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
