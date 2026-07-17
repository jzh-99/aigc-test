# 分镜拆分改为 SSE 流式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分镜拆分接口从同步 HTTP（30s 超时导致失败）改为 SSE 流式，彻底解决超时问题，用户体验与文本节点一致（生成中动画 → 完成后渲染表格）。

**Architecture:** 后端 `post-storyboard-split.ts` 改为 `stream: true`，直接透传 Qwen SSE 流给客户端（与 `post-text-gen.ts` 完全一致）；JSON 解析逻辑（剥离 `<think>` 标签、提取数组、字段归一化）从后端移到前端 `canvas-api.ts` 的新函数 `executeStoryboardSplitterNodeStream`；3 处调用方统一改用新函数。

**Tech Stack:** Fastify 4 SSE 透传、Web Streams API（ReadableStream + getReader）、TypeScript

---

## 文件改动清单

| 文件 | 操作 |
|------|------|
| `apps/api/src/routes/canvas-agent/post-storyboard-split.ts` | 修改：stream 透传，移除 JSON 解析 |
| `apps/web/src/lib/canvas/canvas-api.ts` | 修改：新增 `executeStoryboardSplitterNodeStream`，删除旧函数 |
| `apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx` | 修改：改用新函数 |
| `apps/web/src/hooks/canvas/use-canvas-agent.ts` | 修改：改用新函数 |
| `apps/web/src/components/canvas/steps/step-storyboard.tsx` | 修改：改用新函数 |

---

### Task 1: 后端改为 SSE 流式透传

**Files:**
- Modify: `apps/api/src/routes/canvas-agent/post-storyboard-split.ts`

- [ ] **Step 1: 替换整个路由文件内容**

将文件内容替换为以下代码（与 `post-text-gen.ts` 结构完全一致，只是参数和路径不同）：

```typescript
import type { FastifyPluginAsync } from 'fastify'

// POST /canvas-agent/storyboard-split — AI 分镜拆分（Qwen SSE 流式）
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
            stream: true,
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

      // 设置 SSE 响应头，透传 Qwen 的流
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const reader = res.body!.getReader()
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
}

export default route
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/routes/canvas-agent/post-storyboard-split.ts
git commit -m "feat: 分镜拆分后端改为 SSE 流式透传，解决 30s 超时"
```

---

### Task 2: 前端 canvas-api.ts 新增流式函数，删除旧函数

**Files:**
- Modify: `apps/web/src/lib/canvas/canvas-api.ts`

背景：当前文件在约第 526 行有 `executeStoryboardSplitterNode`（同步版本）。需要：
1. 删除旧的同步函数
2. 新增 `executeStoryboardSplitterNodeStream`，读取 SSE 流，累积全文，流结束后解析 JSON

- [ ] **Step 1: 找到旧函数位置**

旧函数从 `export async function executeStoryboardSplitterNode` 开始，到 `return await res.json()` 结束（约 15 行）。

- [ ] **Step 2: 用新函数替换旧函数**

将旧的 `executeStoryboardSplitterNode` 函数整体替换为：

```typescript
// ── Storyboard splitter（SSE 流式）────────────────────────────────────────────

/**
 * 流式调用分镜拆分接口，SSE 透传 Qwen 输出
 * 流结束后解析完整 JSON，返回 ShotItem 数组
 * @param onProgress 可选进度回调，参数为 0-99 的数字（流式中），完成后由调用方设为 100
 */
export async function executeStoryboardSplitterNodeStream(
  params: { script: string; shotCount: number },
  onProgress?: (percent: number) => void,
  token?: string,
): Promise<{ shots: ShotItem[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/v1/canvas-agent/storyboard-split', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw toCanvasApiError('分镜拆分失败', res.status, error)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  // 用于模拟进度：每收到 token 递增，最大到 99，完成后调用方设 100
  let progressTick = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') break
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string; thinking_content?: string } }>
        }
        // thinking_content 是思考过程，不计入正文
        const delta = json.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          fullText += delta
          // 每 50 个 token 推进一次进度，最大 99
          progressTick++
          if (onProgress && progressTick % 5 === 0) {
            onProgress(Math.min(99, Math.floor(progressTick / 2)))
          }
        }
      } catch {
        // 跳过非 JSON 行
      }
    }
  }

  // 剥离 <think>...</think> 思考标签，提取 JSON 数组
  const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw toCanvasApiError('分镜拆分失败', 502, { error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
  }

  let parsed: Array<Record<string, unknown>>
  try {
    parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>
  } catch {
    throw toCanvasApiError('分镜拆分失败', 502, { error: { code: 'PARSE_ERROR', message: 'AI返回格式错误，请重试' } })
  }

  const shots: ShotItem[] = parsed.map((s, i) => ({
    shotNumber: (s.shotNumber as number) ?? i + 1,
    duration: (s.duration as number) ?? 4,
    sceneDescription: (s.sceneDescription as string) ?? '',
    character1: (s.character1 as string) ?? '',
    characterDesc1: (s.characterDesc1 as string) ?? '',
    character2: (s.character2 as string) ?? '',
    characterDesc2: (s.characterDesc2 as string) ?? '',
    reference: (s.reference as string) ?? '',
    shotType: (s.shotType as string) ?? '',
    characterAction: (s.characterAction as string) ?? '',
    emotion: (s.emotion as string) ?? '',
    sceneTags: Array.isArray(s.sceneTags) ? (s.sceneTags as string[]) : [],
    lightAtmosphere: (s.lightAtmosphere as string) ?? '',
    soundEffect: (s.soundEffect as string) ?? '',
    dialogue: (s.dialogue as string) ?? '无',
    compositionPrompt: (s.compositionPrompt as string) ?? '',
    cameraMotionPrompt: (s.cameraMotionPrompt as string) ?? '',
  }))

  return { shots }
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/canvas/canvas-api.ts
git commit -m "feat: 新增 executeStoryboardSplitterNodeStream，移除旧同步版本"
```

---

### Task 3: 更新 storyboard-splitter-panel.tsx

**Files:**
- Modify: `apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx`

- [ ] **Step 1: 更新 import**

将第 9 行：
```typescript
import { CanvasApiError, executeStoryboardSplitterNode } from '@/lib/canvas/canvas-api'
```
改为：
```typescript
import { CanvasApiError, executeStoryboardSplitterNodeStream } from '@/lib/canvas/canvas-api'
```

- [ ] **Step 2: 更新 handleExecute 中的调用**

找到 `handleExecute` 中调用 `executeStoryboardSplitterNode` 的代码段：

```typescript
const result = await executeStoryboardSplitterNode(
  { script, shotCount: config.shotCount },
  token ?? undefined,
)
```

替换为：

```typescript
const result = await executeStoryboardSplitterNodeStream(
  { script, shotCount: config.shotCount },
  (percent) => setNodeStatus(nodeId, 'pending', { progress: percent }),
  token ?? undefined,
)
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/canvas/panels/storyboard-splitter-panel.tsx
git commit -m "feat: 面板改用 SSE 流式分镜拆分，支持进度回调"
```

---

### Task 4: 更新 use-canvas-agent.ts

**Files:**
- Modify: `apps/web/src/hooks/canvas/use-canvas-agent.ts`

- [ ] **Step 1: 更新 import**

找到文件中 import `executeStoryboardSplitterNode` 的行（约第 38 行）：
```typescript
  executeStoryboardSplitterNode,
```
改为：
```typescript
  executeStoryboardSplitterNodeStream,
```

- [ ] **Step 2: 更新调用**

找到约第 341 行的调用：
```typescript
const result = await executeStoryboardSplitterNode(
  { script, shotCount: cfg.shotCount },
  token ?? undefined,
)
```
替换为：
```typescript
const result = await executeStoryboardSplitterNodeStream(
  { script, shotCount: cfg.shotCount },
  (percent) => execStore.setNodeStatus(nodeId, 'processing', { progress: percent }),
  token ?? undefined,
)
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/canvas/use-canvas-agent.ts
git commit -m "feat: use-canvas-agent 改用 SSE 流式分镜拆分"
```

---

### Task 5: 更新 step-storyboard.tsx

**Files:**
- Modify: `apps/web/src/components/canvas/steps/step-storyboard.tsx`

- [ ] **Step 1: 更新 import**

找到：
```typescript
import { executeStoryboardSplitterNode } from '@/lib/canvas/canvas-api'
```
改为：
```typescript
import { executeStoryboardSplitterNodeStream } from '@/lib/canvas/canvas-api'
```

- [ ] **Step 2: 更新调用**

找到：
```typescript
const res = await executeStoryboardSplitterNode({ script, shotCount }, token ?? undefined)
```
替换为：
```typescript
const res = await executeStoryboardSplitterNodeStream({ script, shotCount }, undefined, token ?? undefined)
```

（step-storyboard 没有节点状态管理，不需要进度回调，传 `undefined`）

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/canvas/steps/step-storyboard.tsx
git commit -m "feat: step-storyboard 改用 SSE 流式分镜拆分"
```

---

### Task 6: TypeScript 类型检查验证

**Files:** 无新文件，验证所有改动

- [ ] **Step 1: 运行类型检查**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -50
```

预期：无错误输出（或只有与本次改动无关的已有错误）

- [ ] **Step 2: 如有类型错误，修复**

常见问题：
- `executeStoryboardSplitterNode` 仍被某处引用 → 全局搜索替换
- `onProgress` 参数类型不匹配 → 确认传入的是 `(percent: number) => void` 或 `undefined`

```bash
grep -rn "executeStoryboardSplitterNode[^S]" apps/web/src
```

预期：无输出（所有调用已改为 `executeStoryboardSplitterNodeStream`）

- [ ] **Step 3: 最终提交（如有修复）**

```bash
git add -p
git commit -m "fix: 修复 SSE 流式分镜拆分类型错误"
```
