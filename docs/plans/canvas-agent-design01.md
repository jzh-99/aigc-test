# 画布 Agent 详细设计方案

## 一、核心设计理念

Agent 分三个阶段工作：

**阶段一：素材收集**
介绍创作流程 → 引导用户提供剧本 → 询问是否有现成素材 → 批量上传 + 即时标注

**阶段二：一次性搭建**
根据收集到的剧本和素材，一次性规划完整工作流，直接写入画布（无需用户确认，不满意可 Undo 或给出修改指令）。整个 Agent 操作作为单个 undo 快照，Ctrl+Z 一次性撤销。

**阶段三：分步引导执行**
工作流上画后切换为向导模式，每步展示参数选择 + 积分预估，用户确认后自动批量 run 该步骤的所有节点。

---

## 二、对话流程设计

### 完整流程图

```
用户描述需求
      │
      ▼
Agent 介绍流程，询问是否有剧本
      │
      ├─ 有剧本 ──→ 用户粘贴/输入剧本
      │
      └─ 没有 ────→ Agent 帮助生成剧本文本（写入 text_input 节点）
      │
      ▼
Agent 询问是否有现成素材
      │
      ├─ 有 ──→ 用户批量拖拽上传
      │          │
      │          ▼
      │         即时标注表单（下拉选项来自剧本内容）
      │          │
      │          ▼
      │         用户确认标注
      │
      └─ 没有 → 跳过
      │
      ▼
Agent 一次性搭建完整工作流（直接写入画布）
      │
      ▼
分步引导执行
  每步：展示参数选择 + 积分预估 → 用户确认 → 自动批量 run
      │
      ▼
全部完成，恢复自由对话
```

### 素材标注表单

用户批量上传后，助手面板展示标注表单，下拉选项由 Agent 从剧本中提取：

```
┌──────────────────────────────────────────────┐
│ 已上传 4 个文件，请告诉我它们的用途：           │
│                                              │
│ 🖼 xiaoming_front.jpg  [角色设计 ▼] [小明  ▼] │
│ 🖼 forest_scene.jpg    [场景设计 ▼] [森林  ▼] │
│ 🎵 bgm_opening.mp3     [配乐    ▼] [片头  ▼] │
│ 🎤 voice_ch1.mp3       [配音    ▼] [第1段 ▼] │
│                                              │
│                          [确认，开始搭建]     │
└──────────────────────────────────────────────┘
```

- 左侧下拉：素材类型（角色设计 / 场景设计 / 配音 / 配乐）
- 右侧下拉：具体归属（从剧本提取的角色名、场景名、片段序号）
- 标注结果存入对应 asset 节点的 `data.config.role`（角色名/场景名/片段）
- 如果用户上传时还没有剧本，右侧改为文本输入框

---

## 三、两套视频创作流程

### 默认视频流程（multiref 模式）

| 步骤 | 内容 | 节点类型 | 是否需要 run |
|------|------|---------|------------|
| 1 | 确定剧本 | text_input | 否（文本节点，自动作为下游输入） |
| 2 | 生成人物设计三视图 | image_gen × N（每个角色3张）或 asset（用户上传） | 是 |
| 3 | 生成场景设计图 | image_gen × N（每个场景1张）或 asset（用户上传） | 是 |
| 4 | 根据剧本生成片段提示词 | text_input × N（每个10s片段一个） | 否 |
| 5 | 生成视频片段 | video_gen × N（multiref 模式，引用人物+场景+提示词） | 是 |

### 首尾帧视频流程（keyframe 模式）

| 步骤 | 内容 | 节点类型 | 是否需要 run |
|------|------|---------|------------|
| 1 | 确定剧本 | text_input | 否 |
| 2 | 生成人物设计三视图 | image_gen × N 或 asset | 是 |
| 3 | 生成场景设计图 | image_gen × N 或 asset | 是 |
| 4 | 根据剧本生成片段提示词 | text_input × N | 否 |
| 5 | 生成所有关键帧图片 | image_gen × N（每个片段首帧+尾帧） | 是 |
| 6 | 使用首尾帧模式生成片段 | video_gen × N（keyframe 模式） | 是 |

> 首尾帧流程拆为 6 步，避免步骤 4 职责混乱（步骤 5 的关键帧图片必须先 run 完，步骤 6 的 video_gen 才有首尾帧可用）。

---

## 四、Agent 状态机

```typescript
type AgentPhase =
  | 'idle'           // 初始，等待用户输入
  | 'intro'          // 介绍流程，询问剧本
  | 'collecting'     // 收集剧本内容 / 素材上传标注
  | 'building'       // LLM 规划中，直接写入画布
  | 'guiding'        // 分步引导执行
  | 'done'           // 本轮完成，恢复自由对话
```

任意阶段用户输入新指令 → 重置回 `idle`，重新开始。

---

## 五、UI 设计

### 入口与侧栏互斥

`editor/[id]/page.tsx` header 右上角，"助手"与"记录"按钮互斥控制同一侧栏：

```
header 右上角：[✦ 助手]  [📋 记录]
```

```typescript
type SidePanel = 'agent' | 'history' | null
const [sidePanel, setSidePanel] = useState<SidePanel>('agent')  // 进入画布默认展开
```

### 面板整体结构

宽度 360px，三区域固定布局：

```
┌─────────────────────────────┐
│  ✦ 画布助手              [×] │  ← 固定 header
├─────────────────────────────┤
│                             │
│       消息列表（可滚动）      │  ← flex-1，新消息自动滚到底部
│                             │
├─────────────────────────────┤
│  输入框 + 发送按钮            │  ← 固定底部
│  引导执行中时 placeholder 变为│
│  "也可以直接输入新需求..."    │
└─────────────────────────────┘
```

### 消息类型

**用户消息** — 右对齐气泡

**助手文字消息** — 左对齐，流式渲染

**素材标注表单** — 上传后渲染，见第二节

**引导步骤卡片** — 每步一张，含参数选择和积分预估：

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

同一步骤内所有节点共用一套参数（用户如需精细调整可手动点节点修改）。

**引导完成卡片**

```
┌────────────────────────────────────┐
│ ✓ 工作流已全部完成                  │
│                                    │
│ 你可以点击任意节点查看输出，         │
│ 或继续描述需求扩展流程。             │
└────────────────────────────────────┘
```

---

## 六、积分预估计算

引导步骤卡片中的积分预估在前端本地计算，无需请求后端：

```typescript
function estimateStepCredits(
  step: AgentStep,
  params: { modelType: ImageModelType; resolution: ImageResolution } |
          { model: string; duration: number }
): number {
  const nodes = step.nodeIds.map(id => getNodeById(id))

  return nodes.reduce((total, node) => {
    if (node.type === 'image_gen') {
      // IMAGE_MODEL_CREDITS 来自现有 /lib/credits.ts
      const credits = IMAGE_MODEL_CREDITS[params.modelType] ?? 5
      return total + credits * node.data.config.quantity
    }
    if (node.type === 'video_gen') {
      // VIDEO_CREDITS_PER_SEC 来自现有 panel-constants.ts
      const perSec = VIDEO_CREDITS_PER_SEC[params.model] ?? 5
      return total + perSec * params.duration
    }
    return total
  }, 0)
}
```

---

## 七、后端 API 设计

### `POST /api/v1/canvas-agent/chat`

复用 `ai-assistant.ts` 的 Gemini 调用逻辑，独立注册路由。

**Request Body：**

```typescript
{
  message: string
  phase: AgentPhase                  // 当前阶段，影响 system prompt 行为
  canvasContext: {
    nodes: Array<{
      id: string
      type: string
      label: string
      configSummary: string          // 如 "prompt: 一只狐狸, model: gemini"
    }>
    edges: Array<{ source: string; target: string }>
  }
  history: Array<{
    role: 'user' | 'assistant'
    content: string                  // assistant 消息只传文字部分，不含 workflow JSON
  }>
}
```

**Response：** SSE 流，格式与现有 ai-assistant 完全一致。

### System Prompt 结构

System prompt 根据 `phase` 动态拼接，分为固定部分和阶段专属部分：

**固定部分（节点类型、连线规则、布局规则）**

```
你是画布工作流规划师。画布支持以下节点类型：

- text_input：文本节点，输出文字 prompt，无输入引脚
- image_gen：AI 生图节点，可接收文本（prompt）和图片（参考图）
- video_gen：AI 视频节点，支持 multiref（多参考图）和 keyframe（首尾帧）两种模式
- asset：素材节点，持有已上传文件，只有输出引脚，不能执行生成

连线规则：
- text_input → image_gen（文本作为 prompt）
- image_gen → image_gen（图片作为参考）
- image_gen → video_gen（图片作为参考帧）
- asset → image_gen / video_gen（素材作为参考）

布局规则：
- 起始节点 x=100，每向右一层 x+=350
- 同层多个节点 y 方向间距 300
- append 时新节点在已有节点右侧或下方延伸，避免重叠

当前画布状态：{canvasContext}
```

**building 阶段专属部分（workflow JSON 输出规范）**

```
用户已提供剧本和素材信息，请一次性规划完整工作流。

先用 1-3 句话说明规划思路，然后输出 workflow 代码块：

\`\`\`workflow
{
  "strategy": "create" | "append",
  "summary": "一句话总结",
  "reusedNodeIds": [],
  "newNodes": [ ...AppNode 数组... ],
  "newEdges": [ ...AppEdge 数组... ],
  "steps": [
    {
      "stepIndex": 1,
      "label": "确定剧本",
      "nodeIds": ["agent_n1"],
      "needsRun": false,
      "instruction": "给用户的操作说明"
    },
    {
      "stepIndex": 2,
      "label": "生成人物三视图",
      "nodeIds": ["agent_n2", "agent_n3", "agent_n4"],
      "needsRun": true,
      "instruction": "点击确认后将自动执行这 3 个节点"
    }
  ]
}
\`\`\`

约束：
- 新节点 id 必须以 "agent_" 前缀开头
- strategy 为 append 时，reusedNodeIds 填入复用的已有节点 id
- 复用节点不出现在 newNodes，但可出现在 newEdges 和 steps 的 nodeIds 中
- needsRun=false 的步骤（如文本节点）跳过参数选择，直接展示说明后进入下一步
```

---

## 八、前端数据结构

### AgentWorkflow

```typescript
interface AgentWorkflow {
  strategy: 'create' | 'append'
  summary: string
  reusedNodeIds: string[]
  newNodes: AppNode[]
  newEdges: AppEdge[]
  steps: AgentStep[]
}

interface AgentStep {
  stepIndex: number
  label: string
  nodeIds: string[]        // 本步骤涉及的所有节点 id（可含复用节点）
  needsRun: boolean        // false = 文本节点等无需执行，直接展示说明
  instruction: string      // 给用户的说明文字
}
```

### AgentMessage

```typescript
interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  workflow?: AgentWorkflow   // 流结束后解析，building 阶段才有
  assetAnnotation?: AssetAnnotationData  // 素材标注表单数据
  status: 'streaming' | 'done' | 'error'
}
```

### use-canvas-agent 完整状态

```typescript
interface CanvasAgentState {
  phase: AgentPhase
  messages: AgentMessage[]
  screenplay: string | null          // 已确认的剧本内容
  uploadedAssets: AnnotatedAsset[]   // 已标注的素材列表
  activeWorkflow: AgentWorkflow | null
  currentStepIndex: number
  // 当前步骤用户选择的参数（批量应用到该步骤所有节点）
  stepParams: Record<number, StepParams>
}

interface AnnotatedAsset {
  nodeId: string           // 已创建的 asset 节点 id
  assetType: 'character' | 'scene' | 'bgm' | 'voice'
  role: string             // 角色名 / 场景名 / 片段序号
}

interface StepParams {
  // image_gen 步骤
  modelType?: ImageModelType
  resolution?: ImageResolution
  aspectRatio?: string
  // video_gen 步骤
  videoModel?: string
  duration?: number
  aspectRatio?: string
}
```

---

## 九、"应用到画布"逻辑

`CanvasStructureStore` 新增 `applyAgentWorkflow` action，整个操作作为单个 undo 快照：

```typescript
applyAgentWorkflow(workflow: AgentWorkflow) {
  // zundo 的 temporal store 会将这次 set 作为一个快照
  // 用户 Ctrl+Z 一次性撤销所有 Agent 新增的节点和连线
  if (workflow.strategy === 'create') {
    set({ nodes: workflow.newNodes, edges: workflow.newEdges })
  } else {
    set((s) => ({
      nodes: [...s.nodes, ...workflow.newNodes],
      edges: [...s.edges, ...workflow.newEdges],
    }))
  }
}
```

---

## 十、引导执行：节点高亮 + 批量 run

```typescript
// 每次步骤切换，高亮当前步骤的目标节点
useEffect(() => {
  if (phase !== 'guiding' || !activeWorkflow) return
  const step = activeWorkflow.steps[currentStepIndex]
  setHighlightedNodes(step ? new Set(step.nodeIds) : new Set())
}, [phase, currentStepIndex, activeWorkflow])

// 用户点击"确认并批量执行"
async function confirmAndRunStep(stepParams: StepParams) {
  const step = activeWorkflow.steps[currentStepIndex]
  if (!step.needsRun) {
    advanceStep()
    return
  }

  // 将用户选择的参数批量写入该步骤所有节点的 config
  for (const nodeId of step.nodeIds) {
    updateNodeConfig(nodeId, stepParams)
  }

  // 通过现有 executeNode 逻辑批量触发，p-limit 控制并发
  const limit = pLimit(3)
  await Promise.all(step.nodeIds.map(id => limit(() => executeNode(id, canvasId))))

  advanceStep()
}

function advanceStep() {
  const next = currentStepIndex + 1
  if (next >= activeWorkflow.steps.length) {
    setPhase('done')
    setHighlightedNodes(new Set())
  } else {
    setCurrentStepIndex(next)
  }
}
```

---

## 十一、改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `apps/web/src/app/(dashboard)/canvas/editor/[id]/page.tsx` | 修改 | 侧栏状态改为 `'agent' \| 'history' \| null`，默认 `'agent'`，header 加"助手"按钮 |
| `apps/web/src/stores/canvas/structure-store.ts` | 修改 | 新增 `applyAgentWorkflow` action（单 undo 快照） |
| `apps/web/src/components/canvas/canvas-agent-panel.tsx` | 新建 | 面板 UI：消息列表、素材标注表单、引导步骤卡片 |
| `apps/web/src/hooks/canvas/use-canvas-agent.ts` | 新建 | 状态机 + SSE 流处理 + 步骤推进 + 批量执行 |
| `apps/web/src/lib/canvas/agent-api.ts` | 新建 | `POST /canvas-agent/chat` 调用封装 |
| `apps/api/src/routes/canvas-agent.ts` | 新建 | 后端路由，复用 Gemini 调用逻辑，动态拼接 system prompt |
| `apps/api/src/app.ts` | 修改 | 注册新路由 |

---

## 十二、不做的事（边界）

- Agent 不自动执行节点，执行权在用户手中（点击确认后才 run）
- Agent 不修改已有节点的任何参数（append 模式严格只追加）
- 不做对话历史持久化（刷新后清空）
- 不引入新的 LLM 服务，完全复用现有 Comfly/Gemini 接口
- 引导步骤不自动检测节点是否执行完成，由用户主动点击"确认"推进
- 素材标注不做文件名解析，全部通过面板内下拉选择完成
