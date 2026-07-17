# 分镜节点 Qwen 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分镜拆分接口切换到 Qwen 模型并开启 thinking，返回 17 字段结构化分镜数组，节点卡片展示摘要列表并支持全屏表格查看。

**Architecture:** 后端 `post-storyboard-split.ts` 切换 Qwen 环境变量、开启 `enable_thinking`、更新 prompt 和解析逻辑；前端新增 `ShotItem` 类型，节点卡片展示前3条摘要+全屏按钮，新建 `storyboard-table-dialog.tsx` 全屏表格，面板适配新数据结构。

**Tech Stack:** Fastify 4、Next.js 14 App Router、ReactFlow、Radix UI Dialog/Tooltip、Tailwind CSS、TypeScript

---

## 文件变更清单

| 文件 | 操作 |
|---|---|
| `apps/api/src/routes/canvas-agent/post-storyboard-split.ts` | 修改 |
| `apps/web/src/lib/canvas/types.ts` | 修改（新增 `ShotItem`） |
| `apps/web/src/lib/canvas/canvas-api.ts` | 修改（更新返回类型） |
| `apps/web/src/components/canvas/nodes/storyboard-splitter-node.tsx` | 修改 |
| `apps/web/src/components/canvas/nodes/storyboard-table-dialog.tsx` | 新建 |
| `apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx` | 修改 |

---

## Task 1: 后端切换 Qwen + 开启 thinking + 更新解析逻辑

**Files:**
- Modify: `apps/api/src/routes/canvas-agent/post-storyboard-split.ts`

- [ ] **Step 1: 用以下内容完整替换文件**

```typescript
import type { FastifyPluginAsync } from 'fastify'
import type { ShotItem } from '@aigc/types'

// POST /canvas-agent/storyboard-split — AI 分镜拆分（Qwen + thinking）
const route: FastifyPluginAsync = async (app) => {
  const API_URL = process.env.QWEN_API_URL ?? ''
  const API_KEY = process.env.QWEN_API_KEY ?? ''
  const MODEL = process.env.QWEN_MODEL ?? 'qwen3-6b-plus'
  const SYSTEM_PROMPT = process.env.AI_PROMPT_CANVAS_STORYBOARD_SPLIT ?? ''

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
      if (!API_URL || !API_KEY) {
        return reply.status(503).send({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Qwen 服务未配置' } })
      }

      const { script, shotCount } = request.body
      const countInstruction = shotCount > 0
        ? `分割成 ${shotCount} 个分镜`
        : '根据剧本内容自动决定分镜数量（每个分镜约10秒）'

      const userPrompt = `请将以下剧本${countInstruction}：\n\n${script}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120_000)

      let res: Response
      try {
        res = await fetch(`${API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            enable_thinking: true,
            max_tokens: 16000,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const errText = await res.text()
        app.log.error({ status: res.status, body: errText }, 'Storyboard splitter Qwen error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      // thinking 模式下 content 可能包含 <think>...</think> 标签，需先剔除
      const raw = (data.choices?.[0]?.message?.content ?? '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim()

      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error('no JSON array')
        const shots = JSON.parse(jsonMatch[0]) as ShotItem[]
        // 防御性填充：确保必填字段存在
        const normalized = shots.map((s, i) => ({
          shotNumber: s.shotNumber ?? i + 1,
          duration: s.duration ?? 4,
          sceneDescription: s.sceneDescription ?? '',
          character1: s.character1 ?? '',
          characterDesc1: s.characterDesc1 ?? '',
          character2: s.character2 ?? '',
          characterDesc2: s.characterDesc2 ?? '',
          reference: s.reference ?? '',
          shotType: s.shotType ?? '',
          characterAction: s.characterAction ?? '',
          emotion: s.emotion ?? '',
          sceneTags: Array.isArray(s.sceneTags) ? s.sceneTags : [],
          lightAtmosphere: s.lightAtmosphere ?? '',
          soundEffect: s.soundEffect ?? '',
          dialogue: s.dialogue ?? '无',
          compositionPrompt: s.compositionPrompt ?? '',
          cameraMotionPrompt: s.cameraMotionPrompt ?? '',
        }))
        return reply.send({ success: true, shots: normalized })
      } catch {
        app.log.error({ raw }, 'Storyboard splitter parse error')
        return reply.status(502).send({ success: false, error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
      }
    },
  )
}

export default route
```

注意：`ShotItem` 类型在 Task 2 中定义，此处先用 `import type { ShotItem } from '@aigc/types'`，若 types 包暂未导出则改为本地 `import type { ShotItem } from '../../lib/canvas/types'`（根据实际路径调整）。

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/routes/canvas-agent/post-storyboard-split.ts
git commit -m "feat: 分镜拆分切换 Qwen + 开启 thinking，返回 ShotItem 数组"
```

---

## Task 2: 新增 ShotItem 类型 + 更新 canvas-api 返回类型

**Files:**
- Modify: `apps/web/src/lib/canvas/types.ts`
- Modify: `apps/web/src/lib/canvas/canvas-api.ts`

- [ ] **Step 1: 在 `apps/web/src/lib/canvas/types.ts` 的 `StoryboardSplitterConfig` 接口之后插入 `ShotItem` 接口**

在文件第 59-61 行（`StoryboardSplitterConfig` 定义）之后，插入：

```typescript
export interface ShotItem {
  shotNumber: number
  duration: number
  sceneDescription: string
  character1: string
  characterDesc1: string
  character2: string
  characterDesc2: string
  reference: string
  shotType: string
  characterAction: string
  emotion: string
  sceneTags: string[]
  lightAtmosphere: string
  soundEffect: string
  dialogue: string
  compositionPrompt: string
  cameraMotionPrompt: string
}
```

- [ ] **Step 2: 更新 `apps/web/src/lib/canvas/canvas-api.ts` 中 `executeStoryboardSplitterNode` 的返回类型**

找到该函数（约第 525 行），将返回类型从：
```typescript
Promise<{ shots: Array<{ id: string; label: string; content: string }> }>
```
改为：
```typescript
Promise<{ shots: ShotItem[] }>
```

同时在文件顶部 import 中加入 `ShotItem`：
```typescript
import type { ..., ShotItem } from './types'
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/canvas/types.ts apps/web/src/lib/canvas/canvas-api.ts
git commit -m "feat: 新增 ShotItem 类型，更新 executeStoryboardSplitterNode 返回类型"
```

---

## Task 3: 新建全屏表格 Dialog 组件

**Files:**
- Create: `apps/web/src/components/canvas/nodes/storyboard-table-dialog.tsx`

- [ ] **Step 1: 创建文件，写入以下完整内容**

```typescript
'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ShotItem } from '@/lib/canvas/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shots: ShotItem[]
  title?: string
}

// 长文本截断 + tooltip 展示
function TruncatedCell({ text, maxW = 'max-w-[200px]' }: { text: string; maxW?: string }) {
  if (!text) return <span className="text-muted-foreground/40">—</span>
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={`block truncate cursor-default ${maxW}`}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

const COLUMNS = [
  { key: 'shotNumber', label: '镜头', width: 'w-[52px]' },
  { key: 'duration', label: '时长', width: 'w-[52px]' },
  { key: 'shotType', label: '景别', width: 'w-[72px]' },
  { key: 'sceneDescription', label: '场景描述', width: 'w-[200px]' },
  { key: 'character1', label: '角色1', width: 'w-[80px]' },
  { key: 'character2', label: '角色2', width: 'w-[80px]' },
  { key: 'emotion', label: '情绪', width: 'w-[100px]' },
  { key: 'dialogue', label: '台词', width: 'w-[120px]' },
  { key: 'compositionPrompt', label: '构图提示词', width: 'w-[200px]' },
  { key: 'cameraMotionPrompt', label: '运镜提示词', width: 'w-[160px]' },
] as const

export function StoryboardTableDialog({ open, onOpenChange, shots, title = '分镜表' }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-sm font-medium">
            {title}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              共 {shots.length} 个镜头
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-auto flex-1">
          <table className="w-max min-w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} px-3 py-2 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shots.map((shot, idx) => (
                <tr
                  key={shot.shotNumber}
                  className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                >
                  <td className="px-3 py-2 border-b border-border/50 text-center font-medium text-violet-600">
                    {shot.shotNumber}
                  </td>
                  <td className="px-3 py-2 border-b border-border/50 text-center text-muted-foreground">
                    {shot.duration}s
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 whitespace-nowrap">
                      {shot.shotType}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.sceneDescription} maxW="max-w-[200px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.character1} maxW="max-w-[80px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.character2} maxW="max-w-[80px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.emotion} maxW="max-w-[100px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.dialogue} maxW="max-w-[120px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.compositionPrompt} maxW="max-w-[200px]" />
                  </td>
                  <td className="px-3 py-2 border-b border-border/50">
                    <TruncatedCell text={shot.cameraMotionPrompt} maxW="max-w-[160px]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/canvas/nodes/storyboard-table-dialog.tsx
git commit -m "feat: 新建分镜全屏表格 Dialog 组件"
```

---

## Task 4: 更新节点卡片展示分镜摘要 + 全屏按钮

**Files:**
- Modify: `apps/web/src/components/canvas/nodes/storyboard-splitter-node.tsx`

- [ ] **Step 1: 用以下内容完整替换文件**

```typescript
'use client'

import { memo, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeExecutionState, useNodeHighlighted } from '@/stores/canvas/execution-store'
import { X, Clapperboard, Loader2, CheckCircle2, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData, StoryboardSplitterConfig, ShotItem } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'
import { StoryboardTableDialog } from './storyboard-table-dialog'

export const StoryboardSplitterNode = memo(function StoryboardSplitterNode({
  id,
  data,
}: {
  id: string
  data: CanvasNodeData<StoryboardSplitterConfig>
}) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const { isGenerating, submissionStatus, outputs } = useNodeExecutionState(id)
  const isUpstream = useNodeHighlighted(id)
  const [tableOpen, setTableOpen] = useState(false)

  const shots = (outputs[0]?.paramsSnapshot as { shots?: ShotItem[] } | undefined)?.shots ?? []
  const isDone = submissionStatus === 'completed'
  const previewShots = shots.slice(0, 3)
  const remaining = shots.length - previewShots.length

  return (
    <>
      <div
        className={cn(
          'group relative flex flex-col rounded-xl shadow-md border transition-shadow duration-150',
          'bg-card',
          'border-border hover:border-border/60 hover:shadow-lg',
          isGenerating && 'ring-1 ring-violet-400 shadow-violet-100',
          isUpstream && !isGenerating && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
          '[transform:translateZ(0)] [backface-visibility:hidden]',
          '[contain:layout_style] [will-change:transform]',
        )}
        style={{ width: 280 }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
          className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-card text-muted-foreground hover:text-red-500 border-border"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={11} />
        </button>

        <div className="px-3 py-1.5 border-b border-border rounded-t-xl bg-violet-50 dark:bg-violet-950/30 flex items-center gap-1.5">
          <Clapperboard size={12} className="text-violet-500 shrink-0" />
          <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} />
          {isDone && shots.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setTableOpen(true) }}
              onMouseDown={(e) => e.stopPropagation()}
              className="ml-auto p-0.5 rounded hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-400 hover:text-violet-600 transition-colors"
              title="全屏查看分镜表"
            >
              <Maximize2 size={11} />
            </button>
          )}
        </div>

        <div className="p-2.5 flex-1 min-h-[60px] flex flex-col justify-center">
          {isGenerating && (
            <div className="flex items-center gap-1.5 text-xs text-violet-500">
              <Loader2 size={12} className="animate-spin" />
              <span>拆分分镜中…</span>
            </div>
          )}

          {!isGenerating && isDone && shots.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 mb-1.5">
                <CheckCircle2 size={11} className="text-violet-500 shrink-0" />
                <span className="text-[10px] text-violet-600 font-medium">
                  {shots.length} 个分镜已就绪
                </span>
              </div>
              {previewShots.map((shot) => (
                <div key={shot.shotNumber} className="flex items-start gap-1.5 text-[10px] leading-relaxed">
                  <span className="shrink-0 font-medium text-violet-500 w-8">
                    镜头{shot.shotNumber}
                  </span>
                  <span className="shrink-0 text-muted-foreground w-5">{shot.duration}s</span>
                  <span className="shrink-0 text-muted-foreground w-8 truncate">{shot.shotType.slice(0, 2)}</span>
                  <span className="text-foreground/70 truncate flex-1">{shot.sceneDescription}</span>
                </div>
              ))}
              {remaining > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setTableOpen(true) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-[10px] text-violet-500 hover:text-violet-700 hover:underline transition-colors"
                >
                  +{remaining} 个镜头，点击全屏查看
                </button>
              )}
            </div>
          )}

          {!isGenerating && !isDone && (
            <p className="text-[11px] text-muted-foreground">
              连接剧本节点后执行，自动拆分为分镜节点
            </p>
          )}
        </div>

        <Handle type="target" position={Position.Left} id="any-in"
          className="!w-2 !h-2 !bg-border !border !border-border/80 !-left-1 hover:!bg-violet-400 transition-colors" />
        <Handle type="source" position={Position.Right} id="text-out"
          className="!w-2 !h-2 !bg-border !border !border-border/80 !-right-1 hover:!bg-violet-400 transition-colors" />
      </div>

      <StoryboardTableDialog
        open={tableOpen}
        onOpenChange={setTableOpen}
        shots={shots}
        title={data.label}
      />
    </>
  )
})
StoryboardSplitterNode.displayName = 'StoryboardSplitterNode'
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/canvas/nodes/storyboard-splitter-node.tsx
git commit -m "feat: 节点卡片展示分镜摘要列表，新增全屏查看按钮"
```

---

## Task 5: 更新面板适配 ShotItem 结构

**Files:**
- Modify: `apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx`

- [ ] **Step 1: 更新 `Shot` 接口和相关读取逻辑**

将文件顶部的 `Shot` 接口（第 14-18 行）替换为：

```typescript
// 面板内部使用 ShotItem，兼容旧格式（无 shotNumber 字段时降级）
import type { ShotItem } from '@/lib/canvas/types'
```

删除原有的 `interface Shot { id, label, content }` 定义。

- [ ] **Step 2: 更新 rawShots 读取**

将第 40 行：
```typescript
const rawShots = (execState?.outputs[0]?.paramsSnapshot as { shots?: Shot[] } | undefined)?.shots ?? []
```
改为：
```typescript
const rawShots = (execState?.outputs[0]?.paramsSnapshot as { shots?: ShotItem[] } | undefined)?.shots ?? []
```

- [ ] **Step 3: 更新 editedShots 类型**

将 `useState<Shot[]>([])` 改为 `useState<ShotItem[]>([])`。

- [ ] **Step 4: 更新 updateShot 函数**

将 `updateShot` 函数改为更新 `sceneDescription` 字段：

```typescript
const updateShot = (shotNumber: number, sceneDescription: string) => {
  const base = editedShots.length > 0 ? editedShots : rawShots
  setEditedShots(base.map((s) => s.shotNumber === shotNumber ? { ...s, sceneDescription } : s))
}
```

- [ ] **Step 5: 更新 handleExpandToCanvas**

将展开逻辑中的节点内容从 `shot.content` 改为 `shot.compositionPrompt`，label 从 `shot.label` 改为 `镜头${shot.shotNumber}`：

```typescript
const newNodes: AppNode[] = shots.map((shot, i) => ({
  id: `shot_${nodeId}_${i}`,
  type: 'text_input' as const,
  position: { x: baseX, y: baseY + i * 220 },
  data: { label: `镜头${shot.shotNumber}`, config: { text: shot.compositionPrompt } },
}))
```

- [ ] **Step 6: 更新面板 UI 中的 textarea 展示**

将 `shotsToShow.map` 中的展示内容从 `shot.content` 改为 `shot.sceneDescription`，key 从 `shot.id` 改为 `shot.shotNumber`，label 从 `shot.label` 改为 `镜头${shot.shotNumber}`：

```tsx
{shotsToShow.map((shot) => (
  <div key={shot.shotNumber} className="space-y-0.5">
    <span className="text-[10px] font-medium text-muted-foreground">
      镜头{shot.shotNumber} · {shot.duration}s · {shot.shotType}
    </span>
    <textarea
      value={shot.sceneDescription}
      onChange={(e) => updateShot(shot.shotNumber, e.target.value)}
      rows={3}
      className="w-full text-[11px] bg-background border border-border rounded px-2 py-1.5 resize-y outline-none focus:border-primary/50 transition-colors"
    />
  </div>
))}
```

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx
git commit -m "feat: 面板适配 ShotItem 结构，展开节点使用 compositionPrompt"
```

---

## Task 6: 更新 prompts.env 中的 System Prompt

**Files:**
- Modify: `prompts.env`（本地环境文件，不提交）

- [ ] **Step 1: 在 `prompts.env` 中更新 `AI_PROMPT_CANVAS_STORYBOARD_SPLIT` 变量**

将该变量的值替换为以下 prompt（单行，换行用 `\n` 转义）：

```
AI_PROMPT_CANVAS_STORYBOARD_SPLIT=你是专业的影视分镜师。请将用户提供的剧本拆分为分镜列表，严格按照以下 JSON 数组格式输出，不要包裹在对象中，不要加 markdown 代码块，不要有任何额外说明文字。\n\n每个分镜元素必须包含以下字段：\n- shotNumber: 镜头序号（正整数，从1开始）\n- duration: 单镜头时长（秒，整数，建议3-8秒）\n- sceneDescription: 画面整体描述（场景+剧情，20-50字）\n- character1: 镜头主要角色名（无角色则传空字符串）\n- characterDesc1: 角色1详细外貌设定（无则传空字符串）\n- character2: 次要角色名（无则传空字符串）\n- characterDesc2: 角色2详细外貌设定（无则传空字符串）\n- reference: 参考图或参考镜头ID（无则传空字符串）\n- shotType: 景别，从以下选择：全景/中景/近景/特写/远景\n- characterAction: 角色具体动作描述\n- emotion: 镜头情绪氛围（如：宁静、紧张、温馨）\n- sceneTags: 场景标签数组（如：["清晨","森林","溪流"]）\n- lightAtmosphere: 光影、色调、氛围描述\n- soundEffect: 环境音和音效描述\n- dialogue: 角色台词（无台词则传"无"）\n- compositionPrompt: AI绘画构图提示词（英文或中文均可，描述画面构图）\n- cameraMotionPrompt: 镜头运动和关键动作提示\n\n输出示例：\n[{"shotNumber":1,"duration":4,"sceneDescription":"清晨的翡翠森林，斑斑与妈妈在溪边宁静地喝水","character1":"小鹿斑斑","characterDesc1":"年幼梅花鹿，背部白色梅花斑点，大眼睛","character2":"鹿妈妈","characterDesc2":"成年雌性梅花鹿，体态优雅","reference":"","shotType":"全景","characterAction":"母子俩低头在溪水边饮水","emotion":"宁静、温馨","sceneTags":["清晨","森林","溪流"],"lightAtmosphere":"柔和晨光，丁达尔光效","soundEffect":"流水声，鸟鸣","dialogue":"无","compositionPrompt":"wide shot, two deer drinking water by stream, morning forest","cameraMotionPrompt":"缓慢向前推进，水面泛起涟漪"}]
```

- [ ] **Step 2: 重启 API 服务使环境变量生效**

```bash
pnpm --filter @aigc/api dev
```

---

## Task 7: 端到端验证

- [ ] **Step 1: 启动服务**

```bash
pnpm --filter @aigc/api dev   # 端口 7001
pnpm --filter @aigc/web dev   # 端口 6006
```

- [ ] **Step 2: 直接调用 API 验证后端**

```bash
curl -X POST http://localhost:7001/api/v1/canvas-agent/storyboard-split \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"script":"一只小鹿在森林中探险，遇到了一只小兔子，两人成为了好朋友。","shotCount":3}'
```

预期：返回 `{ success: true, shots: [...] }`，shots 数组长度为 3，每个元素包含 `shotNumber`、`compositionPrompt` 等 17 个字段。

- [ ] **Step 3: 在画布中验证节点 UI**

1. 打开 `http://localhost:6006`，进入画布
2. 添加「剧本」节点（script_writer）和「分镜」节点（storyboard_splitter），连接两者
3. 执行剧本节点，再执行分镜节点
4. 确认分镜节点卡片显示前3条摘要行（镜头号 + 时长 + 景别 + 场景描述截断）
5. 点击右上角 `Maximize2` 图标，确认全屏表格 Dialog 打开，10列数据正确，横向滚动正常
6. 关闭 Dialog，点击面板中「确认展开」，确认生成的 `text_input` 节点内容为 `compositionPrompt`

- [ ] **Step 4: 验证旧格式兼容性**

在浏览器控制台手动注入旧格式数据（无 `shotNumber` 字段），确认 UI 不崩溃（面板 textarea 显示空内容，节点卡片显示"0 个分镜已就绪"）。

- [ ] **Step 5: 最终提交**

```bash
git add .
git commit -m "chore: 分镜节点 Qwen 重构完成，端到端验证通过"
```
