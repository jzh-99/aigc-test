# 分镜节点 Qwen 重构设计文档

**日期**：2026-05-20  
**状态**：已批准

---

## 背景与目标

当前 `storyboard-split` 接口使用 `NANO_BANANA` 模型，返回简单的 `{id, label, content}` 三字段结构，节点卡片仅显示"N 个分镜已就绪"文字。

目标：
1. 切换到 Qwen 模型并开启 thinking，提升分镜质量
2. 返回结构化的 17 字段分镜数组，支持前端表格展示
3. 节点卡片展示分镜摘要列表，支持全屏表格查看

---

## 架构概览

```
post-storyboard-split.ts  →  QWEN API (enable_thinking: true)
        ↓
  ShotItem[] (17字段)
        ↓
canvas_node_outputs.params_snapshot (jsonb)  ← 无需迁移
        ↓
storyboard-splitter-node.tsx  →  摘要列表 + 全屏按钮
storyboard-table-dialog.tsx   →  全屏横向滚动表格
storyboard-splitter-panel.tsx →  面板展示 sceneDescription
```

---

## 第一节：后端改造

**文件**：`apps/api/src/routes/canvas-agent/post-storyboard-split.ts`

### 环境变量切换

| 旧变量 | 新变量 |
|---|---|
| `NANO_BANANA_API_URL` | `QWEN_API_URL` |
| `NANO_BANANA_API_KEY` | `QWEN_API_KEY` |
| `NANO_BANANA_MODEL` | `QWEN_MODEL` |

复用 `post-text-gen.ts` 已有的 Qwen 配置，无需新增环境变量。

### 请求参数变更

```typescript
Body: { script: string; shotCount: number }  // 不变
```

### LLM 调用变更

```typescript
{
  model: QWEN_MODEL,
  messages: [...],
  stream: false,
  enable_thinking: true,   // 开启 thinking（原为 false）
  max_tokens: 16000,       // 从 8000 提升（thinking 占用额外 token）
}
```

超时从 90s 提升到 120s。

### System Prompt 要求

`AI_PROMPT_CANVAS_STORYBOARD_SPLIT` 环境变量需更新，要求 AI 输出纯 JSON 数组格式：

```
输出格式：纯 JSON 数组，不包裹在对象中，不加 markdown 代码块。
每个元素包含以下字段（必填字段不可省略）：
shotNumber, duration, sceneDescription, character1, characterDesc1,
character2, characterDesc2, reference, shotType, characterAction,
emotion, sceneTags, lightAtmosphere, soundEffect, dialogue,
compositionPrompt, cameraMotionPrompt
```

### 解析逻辑变更

```typescript
// 旧：匹配对象
const jsonMatch = raw.match(/\{[\s\S]*\}/)
const parsed = JSON.parse(jsonMatch[0]) as { shots?: [...] }
const shots = parsed.shots ?? []

// 新：匹配数组（同时兼容 thinking 模式下 <think>...</think> 标签）
const cleanRaw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
const jsonMatch = cleanRaw.match(/\[[\s\S]*\]/)
const shots = JSON.parse(jsonMatch[0]) as ShotItem[]
```

### 接口响应变更

```typescript
// 旧
{ success: true, shots: Array<{ id: string; label: string; content: string }> }

// 新
{ success: true, shots: ShotItem[] }
```

---

## 第二节：数据结构

### ShotItem 类型

定义位置：`apps/web/src/lib/canvas/types.ts`

```typescript
export interface ShotItem {
  shotNumber: number         // 镜头序号，正整数
  duration: number           // 单镜头时长（秒）
  sceneDescription: string   // 画面整体描述（场景+剧情）
  character1: string         // 主角色名
  characterDesc1: string     // 主角色详细设定
  character2: string         // 次角色名（无则空字符串）
  characterDesc2: string     // 次角色设定（无则空字符串）
  reference: string          // 参考图/镜头ID（无则空字符串）
  shotType: string           // 景别：全景/中景/近景/特写/远景
  characterAction: string    // 角色具体动作
  emotion: string            // 镜头情绪氛围
  sceneTags: string[]        // 场景标签
  lightAtmosphere: string    // 光影、色调、氛围描述
  soundEffect: string        // 环境音、音效
  dialogue: string           // 角色台词（无则"无"）
  compositionPrompt: string  // AI绘画/分镜构图提示词
  cameraMotionPrompt: string // 镜头运动+关键动作提示
}
```

### 数据库

无需迁移。`canvas_node_outputs.params_snapshot (jsonb)` 天然支持新结构。

存储格式从 `{ shots: [{id, label, content}] }` 变为 `{ shots: ShotItem[] }`。

旧数据兼容处理：读取时检查 `shotNumber` 字段是否存在，若不存在则视为旧格式，在 UI 层降级展示（仅显示 `content` 字段）。

### 面板展开到画布

`handleExpandToCanvas` 中每个 shot 展开为 `text_input` 节点：
- 节点 label：`镜头${shot.shotNumber}`
- 节点内容（`config.text`）：`shot.compositionPrompt`（构图提示词，直接用于后续图片生成）

---

## 第三节：前端节点 UI

### 节点卡片（`storyboard-splitter-node.tsx`）

宽度从 240 扩展到 280。

生成完成后，body 区域展示前 3 个分镜的紧凑摘要行：

```
镜头1  4s  全景  清晨的翡翠森林，斑斑与妈妈…
镜头2  3s  近景  斑斑抬头，眼神好奇地望向…
镜头3  5s  特写  水面倒影中，斑斑的脸庞…
+12 个镜头
```

右上角新增 `Maximize2` 图标按钮，点击打开全屏 Dialog。

样式遵循项目现有主题（`bg-card`、`text-muted-foreground`、`border-border`），紫色系高亮与现有节点保持一致。

### 全屏表格 Dialog（新建 `storyboard-table-dialog.tsx`）

使用 `@/components/ui/dialog`，`max-w-[90vw] max-h-[85vh]`。

表格列（横向滚动）：

| 列 | 宽度 | 说明 |
|---|---|---|
| 镜头号 | 60px | `shotNumber` |
| 时长 | 60px | `duration`s |
| 景别 | 80px | `shotType` |
| 场景描述 | 200px | `sceneDescription`，截断+tooltip |
| 角色1 | 80px | `character1` |
| 角色2 | 80px | `character2` |
| 情绪 | 100px | `emotion` |
| 台词 | 120px | `dialogue` |
| 构图提示词 | 200px | `compositionPrompt`，截断+tooltip |
| 运镜提示词 | 160px | `cameraMotionPrompt`，截断+tooltip |

其余字段（`characterDesc1/2`、`sceneTags`、`lightAtmosphere`、`soundEffect`、`reference`）通过行展开或 tooltip 展示，不单独占列，避免表格过宽。

### 面板（`storyboard-splitter-panel.tsx`）

分镜草稿编辑区：
- 旧：展示 `shot.content`
- 新：展示 `shot.sceneDescription`（场景描述）作为预览，保留 textarea 可编辑
- "确认展开"按钮逻辑不变，展开内容改为 `compositionPrompt`

### canvas-api.ts

`executeStoryboardSplitterNode` 返回类型从 `{ shots: Array<{id, label, content}> }` 改为 `{ shots: ShotItem[] }`。

---

## 文件变更清单

| 文件 | 变更类型 |
|---|---|
| `apps/api/src/routes/canvas-agent/post-storyboard-split.ts` | 修改：切换 Qwen，开启 thinking，更新解析逻辑 |
| `apps/web/src/lib/canvas/types.ts` | 修改：新增 `ShotItem` 接口 |
| `apps/web/src/lib/canvas/canvas-api.ts` | 修改：更新 `executeStoryboardSplitterNode` 返回类型 |
| `apps/web/src/components/canvas/nodes/storyboard-splitter-node.tsx` | 修改：展示分镜摘要列表，新增全屏按钮 |
| `apps/web/src/components/canvas/nodes/storyboard-table-dialog.tsx` | 新建：全屏表格 Dialog |
| `apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx` | 修改：适配 ShotItem 结构 |

---

## 验证方案

1. 启动 API 服务，调用 `POST /canvas-agent/storyboard-split`，传入剧本文本，确认返回 `ShotItem[]` 数组且字段完整
2. 在画布中连接剧本节点 → 分镜节点，执行分镜拆分，确认节点卡片显示摘要列表
3. 点击全屏按钮，确认 Dialog 打开，表格数据正确，横向滚动正常
4. 点击"确认展开"，确认生成的 `text_input` 节点内容为 `compositionPrompt`
5. 检查旧格式数据（无 `shotNumber` 字段）在 UI 层是否正常降级展示
