# 画布 Agent 详细设计方案

---

## 一、核心架构理念：LLM 驱动流程

### 问题

固定状态机（`intro → collecting → building → guiding`）只能处理预设的需求类型。用户需求是灵活的——视频、套图、漫画分镜、风格迁移——每加一种就要改前端代码，完全不可扩展。

### 解法：前端只渲染，LLM 决策流程

**流程控制权交给 LLM**。LLM 每次回复除文字外，附带一条结构化"指令"，告诉前端下一步渲染什么 UI。前端是纯粹的指令解释器，不包含任何业务判断逻辑。

```
用户输入
  │
  ▼
前端构建消息（含 @引用节点的多模态内容 + 画布上下文）
  │
  ▼
POST /api/v1/canvas-agent/chat  →  SSE 流式返回
  │
  ▼
前端解析响应：
  ├─ 文字部分 → 流式渲染到消息气泡
  └─ 指令部分（```instruction 代码块）→ 渲染对应 UI 组件
```

### 前端状态机（极简）

```typescript
type AgentPhase =
  | 'idle'           // 等待用户输入
  | 'waiting_llm'    // 请求中，流式输出
  | 'waiting_user'   // LLM 给出指令，等待用户操作
  | 'running'        // 批量执行节点中
  | 'done'           // 本轮完成
```

不再有 `intro`、`collecting`、`building` 等业务阶段。业务逻辑全部在 system prompt 里，改需求只改 prompt，不动前端代码。

---

## 二、LLM 指令系统

LLM 每次回复可以在末尾附带一个 `instruction` 代码块，前端根据 `type` 渲染对应 UI：

```typescript
type AgentInstruction =
  | { type: 'ask_upload'; assetTypes: AssetTypeHint[] }
  // → 渲染上传区域，提示用户上传哪类素材

  | { type: 'annotate_assets'; assets: UploadedFile[]; options: AnnotationOptions }
  // → 渲染素材标注表单

  | { type: 'confirm_plan'; items: PlanItem[] }
  // → 渲染方案确认卡片（如9种风格列表）

  | { type: 'apply_workflow'; workflow: AgentWorkflow }
  // → 直接写入画布，无需用户确认

  | { type: 'guide_step'; step: GuideStep }
  // → 渲染引导步骤卡片，含参数选择和积分预估

  | { type: 'done' }
  // → 渲染完成卡片，恢复自由对话
```

### 指令数据结构

```typescript
interface AssetTypeHint {
  key: 'character' | 'scene' | 'bgm' | 'voice' | 'reference'
  label: string        // 如"角色设计图"
  optional: boolean
}

interface PlanItem {
  id: string
  label: string        // 如"水墨国画风"
  description: string  // 简短说明
  selected: boolean    // 默认是否勾选
}

interface AgentWorkflow {
  strategy: 'create' | 'append'
  // create：清空画布重建；append：保留已有节点，只追加
  summary: string
  reusedNodeIds: string[]   // append 时复用的已有节点 id
  newNodes: AppNode[]
  newEdges: AppEdge[]
}

interface GuideStep {
  stepIndex: number
  totalSteps: number
  label: string             // 如"生成人物三视图"
  nodeIds: string[]         // 本步骤涉及的节点 id（含复用节点）
  needsRun: boolean         // false = 文本节点，无需执行，直接下一步
  instruction: string       // 给用户的说明文字
  nodeType: 'image_gen' | 'video_gen' | 'text_input' | 'mixed'
  // 用于决定参数选择表单展示哪些字段
}
```

---

## 三、@节点引用与多模态传递

### 输入框交互

用户在输入框输入 `@` 时，弹出画布节点选择 popover，列出当前画布所有节点：

```
@  ┌──────────────────────────┐
   │ 🖼 风景图（image_gen）    │
   │ 📝 主题文案（text_input） │
   │ 🎬 片段1（video_gen）    │
   └──────────────────────────┘
```

选中后插入引用标记：`@[节点标签|nodeId]`

### 隐式引用（选中节点自动关联）

用户在画布上点击选中节点时，Agent 输入框上方出现关联标签，LLM 请求时自动带入该节点上下文，无需手动输入 `@`：

```
┌─────────────────────────────┐
│ 已关联：🖼 风景图  ✕         │  ← 点 ✕ 取消关联
├─────────────────────────────┤
│ 输入框...          [发送 ↑] │
└─────────────────────────────┘
```

- 选中节点变化时自动更新关联标签（只保留最后一个选中节点）
- 发送时将关联节点的内容以相同的多模态规则注入到消息末尾
- 关联节点信息在消息气泡中以蓝色标签显示，与手动 `@` 视觉一致

### 多模态支持矩阵（已验证）

通过对 Comfly/Gemini 代理的实测，各媒体类型的传递方式如下：

| 媒体类型 | 传递方式 | 说明 |
|---------|---------|------|
| 图片 | `image_url` + 公网 URL | 统一用 proxy URL，不用 base64 |
| 视频 | `image_url` + 公网 URL | 必须公网 URL，base64 无效 |
| 音频 | `image_url` + 公网 URL | 必须公网 URL，base64 无效 |
| 文本 | 内联文本 | 直接拼入 text part |

**统一策略：图片、视频、音频全部用 `image_url` + 公网 proxy URL**。上传后返回的 proxy URL（`/api/v1/canvases/asset-upload` 返回的 `url` 字段）满足此要求。`image_gen` 节点的定稿输出同样是公网可访问的 storage URL，直接使用。

### 发送前的多模态内容构建

```typescript
// 将 rawText 按 @[label|nodeId] 拆分，在每个 @ 位置插入对应媒体 part
// 例：「参考 @[风景图|node-1] 生成一张夜景」
// → [text:"参考 "] [image_url:...] [text:"[图片节点「风景图」] 生成一张夜景"]
function buildUserContent(
  rawText: string,
  mentionedNodeIds: string[]
): string | ContentPart[] {
  if (mentionedNodeIds.length === 0) return rawText

  const nodes = useCanvasStructureStore.getState().nodes
  const execNodes = useCanvasExecutionStore.getState().nodes

  // 按 @ 标记位置拆分文本
  const TOKEN_RE = /@\[([^\]|]+)\|([^\]]+)\]/g
  const parts: ContentPart[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_RE.exec(rawText)) !== null) {
    // 插入 @ 之前的文字
    const before = rawText.slice(lastIndex, match.index)
    if (before) parts.push({ type: 'text', text: before })
    lastIndex = TOKEN_RE.lastIndex

    const nodeId = match[2]
    const node = nodes.find(n => n.id === nodeId)
    if (!node) continue

    if (node.type === 'image_gen') {
      const execState = execNodes[nodeId]
      const output = execState?.outputs.find(o => o.id === execState.selectedOutputId)
      if (output?.url) {
        parts.push({ type: 'image_url', image_url: { url: output.url } })
        parts.push({ type: 'text', text: `[图片节点「${node.data.label}」]` })
      }
    } else if (node.type === 'asset' && isAssetConfig(node.data.config)) {
      const { url, mimeType, name } = node.data.config
      if (url) {
        // 图片/视频/音频统一用 image_url + 公网 proxy URL
        parts.push({ type: 'image_url', image_url: { url } })
        const mediaLabel = mimeType?.startsWith('video') ? '视频' : mimeType?.startsWith('audio') ? '音频' : '图片'
        parts.push({ type: 'text', text: `[${mediaLabel}素材「${name ?? node.data.label}」]` })
      }
    } else if (node.type === 'text_input') {
      parts.push({ type: 'text', text: `[文本节点「${node.data.label}」：${node.data.config.text}]` })
    }
    // video_gen 节点暂不支持引用输出，@ 时静默跳过
  }

  // 插入末尾剩余文字
  const tail = rawText.slice(lastIndex)
  if (tail) parts.push({ type: 'text', text: tail })

  return parts.length > 0 ? parts : rawText
}
```

### canvasContext 构建

每次请求携带当前画布摘要，让 LLM 知道画布现状：

```typescript
function buildCanvasContext() {
  const { nodes, edges } = useCanvasStructureStore.getState()
  const execState = useCanvasExecutionStore.getState().nodes

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      label: n.data.label,
      configSummary: summarizeConfig(n.type, n.data.config),
      hasOutput: (execState[n.id]?.outputs.length ?? 0) > 0,
    })),
    edges: edges.map(e => ({ source: e.source, target: e.target })),
  }
}

function summarizeConfig(type: string, config: any): string {
  if (type === 'text_input') return `"${config.text?.slice(0, 60) ?? ''}"`
  if (type === 'image_gen') return `model:${config.modelType}, prompt:"${config.prompt?.slice(0, 40) ?? ''}"`
  if (type === 'video_gen') return `model:${config.model}, mode:${config.videoMode}`
  if (type === 'asset') return `file:${config.name ?? config.url?.split('/').pop() ?? ''}`
  return ''
}
```

---

## 四、UI 设计

### 入口与侧栏互斥

`editor/[id]/page.tsx` header 右上角，"助手"与"记录"按钮互斥控制同一侧栏：

```
[✦ 助手]  [📋 记录]
```

```typescript
type SidePanel = 'agent' | 'history' | null
// 进入画布默认展开助手
const [sidePanel, setSidePanel] = useState<SidePanel>('agent')
```

### 面板整体结构

宽度 360px，固定三区域：

```
┌─────────────────────────────┐
│  ✦ 画布助手              [×] │  ← 固定 header
├─────────────────────────────┤
│                             │
│       消息列表（可滚动）      │  ← flex-1，新消息自动滚底
│                             │
├─────────────────────────────┤
│  @ 输入框          [发送 ↑] │  ← 固定底部，任何阶段均可输入
└─────────────────────────────┘
```

底部输入框任何阶段都可用。用户在引导执行中途输入新指令，Agent 中断当前引导，重新规划。

### 消息气泡

**用户消息** — 右对齐，@引用节点显示为蓝色标签

**助手文字** — 左对齐，流式渲染

**指令 UI 组件** — 跟在助手文字消息下方，根据 `instruction.type` 渲染：

---

### 指令 UI：ask_upload（上传引导）

```
┌────────────────────────────────────┐
│ 在开始之前，你是否已有以下素材？     │
│                                    │
│  □ 角色设计图（可选）               │
│  □ 场景设计图（可选）               │
│  □ 配音音频（可选）                 │
│  □ 配乐音频（可选）                 │
│                                    │
│  [拖拽或点击上传]                   │
│                                    │
│              [没有，直接开始 →]     │
└────────────────────────────────────┘
```

### 指令 UI：annotate_assets（素材标注）

```
┌──────────────────────────────────────────┐
│ 已上传 4 个文件，请告诉我它们的用途：      │
│                                          │
│ 🖼 xiaoming.jpg   [角色设计 ▼] [小明  ▼] │
│ 🖼 forest.jpg     [场景设计 ▼] [森林  ▼] │
│ 🎵 bgm.mp3        [配乐    ▼] [片头  ▼] │
│ 🎤 voice1.mp3     [配音    ▼] [第1段 ▼] │
│                                          │
│                    [确认，开始搭建 →]     │
└──────────────────────────────────────────┘
```

- 左侧下拉：素材类型
- 右侧下拉：归属（从剧本提取的角色名/场景名/片段序号；无剧本时为文本输入框）
- 标注结果存入对应 asset 节点的 `data.config`，Agent 搭建时直接读取

### 指令 UI：confirm_plan（方案确认）

```
┌──────────────────────────────────────┐
│ 我为你设计了以下 9 种风格，可以修改：  │
│                                      │
│ ✓ 1. 水墨国画风                      │
│ ✓ 2. 赛博朋克霓虹风                  │
│ ✓ 3. 吉卜力动画风                    │
│   ...                                │
│                                      │
│ [修改风格]          [确认，选参数 →]  │
└──────────────────────────────────────┘
```

用户点"修改风格"后可以直接在输入框描述修改意图，Agent 重新输出方案。

### 指令 UI：apply_workflow（直接上画布）

无 UI 弹窗，直接写入画布。面板显示一条简短的操作反馈消息：

```
✓ 已在画布上搭建 9 个节点，可 Ctrl+Z 撤销
```

整个 `applyAgentWorkflow` 操作作为单个 undo 快照，Ctrl+Z 一次性撤销所有 Agent 新增内容。

写入画布后自动进入**执行聚焦模式**：当前步骤涉及的节点显示流光边框动效（复用 `setHighlightedNodes`），其余节点降低透明度，引导用户视线聚焦到当前任务。

### 指令 UI：guide_step（引导步骤）

```
┌────────────────────────────────────┐
│ Step 2 / 6  生成人物三视图           │
│ ──────────────────────────────     │
│ 本步骤将执行 3 个生图节点            │
│ （小明正面、侧面、背面）             │
│                                    │
│ 模型    [全能图片2      ▼]          │
│ 分辨率  [2K             ▼]         │
│ 比例    [1:1            ▼]         │
│                                    │
│ 预计消耗  ● 15 积分                 │
│                                    │
│              [确认并批量执行 →]     │
└────────────────────────────────────┘
```

- 同步骤内所有节点共用一套参数
- 积分预估本地计算，复用现有 `IMAGE_MODEL_CREDITS` 和 `VIDEO_CREDITS_PER_SEC` 常量
- `needsRun=false` 的步骤（文本节点）跳过参数选择，只展示说明 + "下一步"按钮
- 当前步骤的目标节点在画布上高亮（复用 `setHighlightedNodes`）

### 指令 UI：done（完成）

```
┌────────────────────────────────────┐
│ ✓ 工作流已全部完成                  │
│                                    │
│ 你可以点击任意节点查看输出，         │
│ 或继续描述需求扩展流程。             │
└────────────────────────────────────┘
```

---

## 五、后端 API 设计

### `POST /api/v1/canvas-agent/chat`

复用 `ai-assistant.ts` 的 Gemini 调用逻辑，独立注册路由。

**Request Body：**

```typescript
{
  // 用户消息，可能是纯文字或多模态数组（含 @引用节点的图片）
  content: string | ContentPart[]

  // 当前画布摘要
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

  // 最近 6 条对话历史（assistant 消息只传文字，不含 instruction JSON）
  history: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}
```

**Response：** SSE 流，格式与现有 ai-assistant 完全一致。

### SSE 响应解析

流结束后，对完整 assistant 消息做一次解析，分离文字和指令：

```typescript
function parseAgentResponse(raw: string): {
  text: string
  instruction: AgentInstruction | null
} {
  const match = raw.match(/```instruction\n([\s\S]*?)\n```/)
  if (!match) return { text: raw, instruction: null }

  const text = raw.replace(/```instruction[\s\S]*?```/, '').trim()
  try {
    const parsed = JSON.parse(match[1])
    const instruction = fillInstructionDefaults(parsed)
    return { text, instruction }
  } catch {
    // 解析失败：静默降级，只显示文字，不渲染损坏的 UI 组件
    return { text: raw, instruction: null }
  }
}

// 对缺失字段填充默认值，防止 LLM 输出不完整时 UI 崩溃
function fillInstructionDefaults(raw: any): AgentInstruction | null {
  if (!raw?.type) return null
  switch (raw.type) {
    case 'ask_upload':
      return { type: 'ask_upload', assetTypes: raw.assetTypes ?? [] }
    case 'annotate_assets':
      return { type: 'annotate_assets', assets: raw.assets ?? [], options: raw.options ?? {} }
    case 'confirm_plan':
      return { type: 'confirm_plan', items: (raw.items ?? []).map((item: any) => ({
        id: item.id ?? crypto.randomUUID(),
        label: item.label ?? '',
        description: item.description ?? '',
        selected: item.selected ?? true,
      }))}
    case 'apply_workflow':
      if (!raw.workflow) return null
      return { type: 'apply_workflow', workflow: {
        strategy: raw.workflow.strategy ?? 'append',
        summary: raw.workflow.summary ?? '',
        reusedNodeIds: raw.workflow.reusedNodeIds ?? [],
        newNodes: raw.workflow.newNodes ?? [],
        newEdges: raw.workflow.newEdges ?? [],
        steps: raw.workflow.steps ?? [],
      }}
    case 'guide_step':
      if (!raw.step) return null
      return { type: 'guide_step', step: {
        stepIndex: raw.step.stepIndex ?? 0,
        totalSteps: raw.step.totalSteps ?? 1,
        label: raw.step.label ?? '',
        nodeIds: raw.step.nodeIds ?? [],
        needsRun: raw.step.needsRun ?? true,
        instruction: raw.step.instruction ?? '',
        nodeType: raw.step.nodeType ?? 'mixed',
      }}
    case 'done':
      return { type: 'done' }
    default:
      return null
  }
}
```

---

## 六、System Prompt 设计

### 固定部分（节点能力、连线规则、画布状态）

```
你是画布工作流规划师。用户在使用一个 AI 内容生产画布。

【节点类型】
- text_input：文本节点，输出文字 prompt，无输入引脚
- image_gen：AI 生图节点，接收文本（prompt）和图片（参考图）
- video_gen：AI 视频节点，支持 multiref（多参考图）和 keyframe（首尾帧）两种模式
- asset：素材节点，持有已上传文件，只有输出引脚，不能执行生成

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
{canvasContext}
```

### 行为规则部分

```
【你的工作方式】

1. 理解用户意图，判断需要哪些信息才能搭建工作流
2. 通过 instruction 指令逐步收集信息（上传素材、确认方案等）
3. 信息充足后，输出 apply_workflow 指令直接搭建工作流
4. 搭建完成后，通过 guide_step 指令逐步引导用户执行

【指令输出规则】

每次回复最多输出一条 instruction 指令，放在回复末尾：

\`\`\`instruction
{ "type": "...", ...指令数据 }
\`\`\`

不需要指令时（纯文字回复）不输出代码块。

【何时输出哪种指令】

- 用户描述了视频创作需求，且画布为空或无相关内容
  → 先输出 ask_upload，询问是否有现成素材

- 用户上传了素材文件
  → 输出 annotate_assets，让用户标注素材用途

- 用户描述了需要多个方案选择的需求（如"生成9种风格"）
  → 先输出 confirm_plan，让用户确认方案列表

- 信息已充足，可以搭建工作流
  → 输出 apply_workflow，直接写入画布

- 工作流已上画布，需要引导执行
  → 依次输出 guide_step，每次一步

- 所有步骤完成
  → 输出 done

【视频创作的标准流程】

默认视频流程（multiref 模式）：
  Step 1：确定剧本（text_input，needsRun=false）
  Step 2：生成人物三视图（image_gen × 角色数 × 3，needsRun=true）
  Step 3：生成场景设计图（image_gen × 场景数，needsRun=true）
  Step 4：生成片段提示词（text_input × 片段数，needsRun=false）
  Step 5：生成视频片段（video_gen × 片段数，multiref 模式，needsRun=true）

首尾帧视频流程（keyframe 模式）：
  Step 1：确定剧本（text_input，needsRun=false）
  Step 2：生成人物三视图（image_gen，needsRun=true）
  Step 3：生成场景设计图（image_gen，needsRun=true）
  Step 4：生成片段提示词（text_input，needsRun=false）
  Step 5：生成关键帧图片（image_gen × 片段数 × 2，needsRun=true）
  Step 6：生成视频片段（video_gen，keyframe 模式，needsRun=true）

用户上传了角色/场景素材时，对应步骤改用 asset 节点替代 image_gen 节点。

【append 策略】

画布已有内容时：
- 分析已有节点是否与用户需求相关
- 相关节点直接复用（填入 reusedNodeIds），不重新创建
- 只追加缺失的节点和连线
- 不修改任何已有节点的参数
```

---

## 七、前端核心实现

### use-canvas-agent.ts 状态

```typescript
interface CanvasAgentState {
  phase: AgentPhase
  messages: AgentMessage[]
  pendingInstruction: AgentInstruction | null  // 当前等待用户响应的指令
  activeWorkflow: AgentWorkflow | null          // 已应用的工作流
  currentStepIndex: number                      // 引导模式当前步骤
  stepParams: Record<number, StepParams>        // 每步用户选择的参数
}

interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string                    // 文字部分（流式追加）
  instruction?: AgentInstruction     // 流结束后解析
  status: 'streaming' | 'done' | 'error'
}

interface StepParams {
  modelType?: ImageModelType
  resolution?: ImageResolution
  aspectRatio?: string
  videoModel?: string
  duration?: number
}
```

### 应用工作流（单 undo 快照）

```typescript
// structure-store.ts 新增 action
applyAgentWorkflow(workflow: AgentWorkflow) {
  // 执行前先 flush 待提交的历史快照，确保 Agent 操作独占一个 undo 条目
  // 这样 Ctrl+Z 能精准撤回"Agent 生成的所有内容"，不会与之前的操作合并
  useCanvasStructureStore.temporal.getState().pause()
  if (workflow.strategy === 'create') {
    set({ nodes: workflow.newNodes, edges: workflow.newEdges })
  } else {
    set(s => ({
      nodes: [...s.nodes, ...workflow.newNodes],
      edges: [...s.edges, ...workflow.newEdges],
    }))
  }
  useCanvasStructureStore.temporal.getState().resume()
}
```

### 引导执行：批量 run

```typescript
async function confirmAndRunStep(stepIndex: number, params: StepParams) {
  const step = activeWorkflow.steps[stepIndex]

  if (!step.needsRun) {
    advanceStep()
    return
  }

  // 批量写入参数到该步骤所有节点
  for (const nodeId of step.nodeIds) {
    updateNodeConfig(nodeId, params)
  }

  // 高亮当前步骤节点
  setHighlightedNodes(new Set(step.nodeIds))

  // p-limit 控制并发，复用现有 executeNode 逻辑
  const limit = pLimit(3)
  await Promise.all(
    step.nodeIds.map(id => limit(() => executeNode(id, canvasId, token)))
  )

  // kickPoll 触发轮询，监听执行进度
  kickPoll()

  advanceStep()
}

function advanceStep() {
  const next = currentStepIndex + 1
  if (next >= activeWorkflow.steps.length) {
    setPhase('done')
    setHighlightedNodes(new Set())
    // 发送 done 指令触发完成卡片
  } else {
    setCurrentStepIndex(next)
    // 请求下一步的 guide_step 指令
    callAgentForNextStep(next)
  }
}
```

### 积分预估（本地计算）

```typescript
function estimateStepCredits(
  nodeIds: string[],
  params: StepParams
): number {
  const nodes = useCanvasStructureStore.getState().nodes
  return nodeIds.reduce((total, id) => {
    const node = nodes.find(n => n.id === id)
    if (!node) return total
    if (node.type === 'image_gen') {
      const credits = IMAGE_MODEL_CREDITS[params.modelType ?? 'gemini'] ?? 5
      return total + credits * (node.data.config.quantity ?? 1)
    }
    if (node.type === 'video_gen') {
      const perSec = VIDEO_CREDITS_PER_SEC[params.videoModel ?? 'seedance-2.0'] ?? 5
      return total + perSec * (params.duration ?? 5)
    }
    return total
  }, 0)
}
```

---

## 八、新增文件清单

```
apps/web/src/
├── components/canvas/
│   ├── canvas-agent-panel.tsx          # 面板主组件（消息列表 + 输入框）
│   └── agent-instructions/
│       ├── ask-upload-card.tsx         # 上传引导卡片
│       ├── annotate-assets-card.tsx    # 素材标注表单
│       ├── confirm-plan-card.tsx       # 方案确认卡片
│       ├── guide-step-card.tsx         # 引导步骤卡片（含参数选择 + 积分预估）
│       └── done-card.tsx               # 完成卡片
├── hooks/canvas/
│   └── use-canvas-agent.ts             # 状态机 + SSE 解析 + 步骤推进
└── lib/canvas/
    └── agent-api.ts                    # POST /canvas-agent/chat 调用封装

apps/api/src/routes/
└── canvas-agent.ts                     # 后端路由，复用 Gemini 调用逻辑
```

---

## 九、改动现有文件清单

| 文件 | 改动内容 |
|------|---------|
| `editor/[id]/page.tsx` | 侧栏状态改为 `'agent' \| 'history' \| null`，默认 `'agent'`，header 加"助手"按钮 |
| `stores/canvas/structure-store.ts` | 新增 `applyAgentWorkflow` action |
| `apps/api/src/app.ts` | 注册 canvas-agent 路由 |

---

## 十、不做的事（边界）

- Agent 不自动执行节点，执行权在用户手中（点确认后才 run）
- Agent 不修改已有节点的任何参数（append 模式严格只追加）
- 不做对话历史持久化（刷新后清空，用户重新描述需求即可）
- 不做引导进度持久化（刷新后 Agent 状态重置，不尝试恢复到第 N 步）
- 不引入新的 LLM 服务，完全复用现有 Comfly/Gemini 接口
- 素材标注不做文件名解析，全部通过面板内下拉选择完成
- 引导步骤不自动检测节点执行完成，由用户主动点击"确认"推进
- 不对视频/音频资产额外截取首帧，LLM 通过 URL 直接访问（Comfly 代理层处理）
