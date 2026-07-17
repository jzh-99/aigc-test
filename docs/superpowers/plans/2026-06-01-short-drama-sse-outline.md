# Short Drama SSE Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将短剧摘要/大纲生成改为 SSE 流式输出，大纲按每 10 集分批生成，单次超时提高到 240 秒，并在 A豆余额不足时保留已完成批次并明确提醒用户。

**Architecture:** 后端新增短剧文本流式工具函数，摘要接口和大纲接口改为 `text/event-stream`；大纲接口按缺失集数分批冻结积分、流式生成、逐批保存。前端新增短剧 SSE 消费器，制作页展示实时文本、批次进度和余额不足警告，完成后刷新项目状态。

**Tech Stack:** Fastify 4、Node Fetch、OpenAI-compatible SSE、Kysely、Next.js 14、React 18、TypeScript、pnpm。

---

## File Structure

- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`
  - 负责短剧文本模型调用、SSE 工具、分批大纲 helper、状态写回 helper。
- Modify: `apps/api/src/routes/short-drama/post-script-summary.ts`
  - 将摘要生成接口改为 SSE 流式响应。
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts`
  - 将大纲生成接口改为 SSE + 每 10 集分批 + 余额不足部分完成。
- Modify: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`
  - 增加批次范围、部分状态写回、SSE 流解析 helper 的回归测试。
- Modify: `apps/web/src/lib/short-drama/api.ts`
  - 新增短剧 SSE 消费函数和摘要/大纲流式 API 参数。
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`
  - 增加生成流式文本、当前批次进度、余额不足提示和部分完成文案。
- Created: `docs/superpowers/specs/2026-06-01-short-drama-sse-outline-design.md`
  - 已写入设计文档，不在本计划重复修改。

---

### Task 1: Add backend pure helper tests

**Files:**
- Modify: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`
- Modify later: `apps/api/src/routes/short-drama/_text-generation.ts`

- [ ] **Step 1: Write failing tests for batching and partial state**

Append the following code before the final `console.log('\n✅ 短剧文本生成状态写回测试通过！')` in `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`:

```ts
import {
  applyShortDramaEpisodeOutlinesBatchResult,
  buildShortDramaOutlineBatches,
  extractDoubaoStreamDeltaText,
} from '../routes/short-drama/_text-generation.js'

console.log('\n测试短剧大纲分批与部分完成状态...')

assert.deepEqual(buildShortDramaOutlineBatches(1, 5, 10), [
  { from: 1, to: 5 },
])
assert.deepEqual(buildShortDramaOutlineBatches(1, 25, 10), [
  { from: 1, to: 10 },
  { from: 11, to: 20 },
  { from: 21, to: 25 },
])
assert.deepEqual(buildShortDramaOutlineBatches(11, 25, 10), [
  { from: 11, to: 20 },
  { from: 21, to: 25 },
])
console.log('✓ 可以按每 10 集构建大纲批次')

const partialState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
partialState.script.refinedPrompt = '一个普通外卖员意外获得超能力。'

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
  { episodeNumber: 2, title: '救援', summary: '主角救下邻居。' },
])

assert.equal(partialState.script.outlines.length, 2)
assert.equal(partialState.episodes.items.length, 2)
assert.equal(partialState.script.status, 'generating')
assert.equal(partialState.episodes.items[0]?.episodeNumber, 1)
assert.equal(partialState.episodes.items[1]?.episodeNumber, 2)
console.log('✓ 部分批次会保留已生成大纲，但不标记 completed')

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 3, title: '守护', summary: '主角守护街区。' },
])

assert.equal(partialState.script.outlines.length, 3)
assert.equal(partialState.episodes.items.length, 3)
assert.equal(partialState.script.status, 'completed')
assert.equal(partialState.episodes.status, 'idle')
console.log('✓ 全部集数生成完成后标记 script.completed')

assert.equal(
  extractDoubaoStreamDeltaText('data: {"choices":[{"delta":{"content":"你好"}}]}'),
  '你好'
)
assert.equal(extractDoubaoStreamDeltaText('data: [DONE]'), '')
assert.equal(extractDoubaoStreamDeltaText(': ping'), '')
console.log('✓ 可以从 OpenAI 兼容 SSE 行提取文本增量')
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
& "D:\haobai\aigc-test\node_modules\.pnpm\node_modules\.bin\tsx.cmd" "D:\haobai\aigc-test\apps\api\src\__tests__\short-drama-text-generation-state.test.ts"
```

Expected: FAIL with missing exports similar to:

```text
SyntaxError: The requested module '../routes/short-drama/_text-generation.js' does not provide an export named 'applyShortDramaEpisodeOutlinesBatchResult'
```

- [ ] **Step 3: Do not fix test assertions in this task**

The failure proves the new behavior is not implemented yet. Continue to Task 2.

---

### Task 2: Implement backend text stream and outline helper primitives

**Files:**
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`
- Test: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`

- [ ] **Step 1: Add constants and callback types**

In `apps/api/src/routes/short-drama/_text-generation.ts`, below `TEXT_CREDITS_PER_THOUSAND_CHARS`, add:

```ts
const DOUBAO_TEXT_TIMEOUT_MS = 240_000
export const SHORT_DRAMA_OUTLINE_BATCH_SIZE = 10

export interface ShortDramaTextStreamCallbacks {
  onChunk?: (text: string) => void
  onPing?: () => void
}

export interface ShortDramaOutlineBatch {
  from: number
  to: number
}
```

- [ ] **Step 2: Update non-stream timeout to 240 seconds**

In `callDoubaoForText`, replace:

```ts
const timer = setTimeout(() => controller.abort(), 120_000) // 2 分钟超时
```

with:

```ts
const timer = setTimeout(() => controller.abort(), DOUBAO_TEXT_TIMEOUT_MS)
```

- [ ] **Step 3: Add SSE delta extraction helper**

Add below `callDoubaoForText`:

```ts
export function extractDoubaoStreamDeltaText(line: string): string {
  if (!line.startsWith('data: ')) return ''

  const data = line.slice(6).trim()
  if (!data || data === '[DONE]') return ''

  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    return json.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Add stream model caller**

Add below `extractDoubaoStreamDeltaText`:

```ts
export async function callDoubaoForTextStream(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  callbacks: ShortDramaTextStreamCallbacks = {}
): Promise<string> {
  if (!DOUBAO_API_KEY) {
    throw new Error('DOUBAO_API_KEY 未配置，无法调用 AI 生成')
  }

  const chatEndpoint = `${DOUBAO_API_URL}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOUBAO_TEXT_TIMEOUT_MS)

  try {
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`AI 调用失败 (HTTP ${response.status})`)
    }

    if (!response.body) {
      throw new Error('AI 返回流为空')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const text = extractDoubaoStreamDeltaText(line.trim())
        if (!text) {
          callbacks.onPing?.()
          continue
        }
        fullText += text
        callbacks.onChunk?.(text)
      }
    }

    if (buffer.trim()) {
      const text = extractDoubaoStreamDeltaText(buffer.trim())
      if (text) {
        fullText += text
        callbacks.onChunk?.(text)
      }
    }

    if (!fullText.trim()) {
      throw new Error('AI 返回内容为空')
    }

    return fullText
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 5: Add outline batching helper**

Add below `calculateTextGenerationCredits`:

```ts
export function buildShortDramaOutlineBatches(
  startEpisode: number,
  totalEpisodeCount: number,
  batchSize = SHORT_DRAMA_OUTLINE_BATCH_SIZE
): ShortDramaOutlineBatch[] {
  const batches: ShortDramaOutlineBatch[] = []
  for (let from = startEpisode; from <= totalEpisodeCount; from += batchSize) {
    batches.push({
      from,
      to: Math.min(from + batchSize - 1, totalEpisodeCount),
    })
  }
  return batches
}
```

- [ ] **Step 6: Add partial outline state writer**

Replace existing `applyShortDramaEpisodeOutlinesResult` body with a call to a new batch helper:

```ts
export function applyShortDramaEpisodeOutlinesBatchResult(
  state: ShortDramaState,
  outlines: ShortDramaEpisodeOutline[]
): void {
  const now = new Date().toISOString()
  const outlineMap = new Map<number, ShortDramaEpisodeOutline>()

  for (const outline of state.script.outlines) {
    outlineMap.set(outline.episodeNumber, outline)
  }
  for (const outline of outlines) {
    outlineMap.set(outline.episodeNumber, outline)
  }

  const mergedOutlines = Array.from(outlineMap.values()).sort(
    (a, b) => a.episodeNumber - b.episodeNumber
  )

  state.script.outlines = mergedOutlines
  state.script.status =
    mergedOutlines.length >= state.settings.episodeCount ? 'completed' : 'generating'
  state.episodes.items = mergedOutlines.map((outline) => {
    const existing = state.episodes.items.find(
      (episode) => episode.episodeNumber === outline.episodeNumber
    )

    return {
      episodeNumber: outline.episodeNumber,
      title: outline.title,
      summary: outline.summary,
      segments: existing?.segments ?? [],
      status: existing?.status ?? 'idle',
      videoUrl: existing?.videoUrl ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  })
  state.episodes.status = 'idle'
}

export function applyShortDramaEpisodeOutlinesResult(
  state: ShortDramaState,
  outlines: ShortDramaEpisodeOutline[]
): void {
  applyShortDramaEpisodeOutlinesBatchResult(state, outlines)
}
```

- [ ] **Step 7: Run helper tests and verify pass**

Run:

```powershell
& "D:\haobai\aigc-test\node_modules\.pnpm\node_modules\.bin\tsx.cmd" "D:\haobai\aigc-test\apps\api\src\__tests__\short-drama-text-generation-state.test.ts"
```

Expected: PASS with lines:

```text
✓ 可以按每 10 集构建大纲批次
✓ 部分批次会保留已生成大纲，但不标记 completed
✓ 全部集数生成完成后标记 script.completed
✓ 可以从 OpenAI 兼容 SSE 行提取文本增量
```

- [ ] **Step 8: Commit**

Only commit if the user has explicitly authorized commits in this session. If authorized:

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts
git commit -m "test: cover short drama text streaming helpers"
```

---

### Task 3: Convert script summary endpoint to SSE

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-script-summary.ts`
- Uses: `apps/api/src/routes/short-drama/_text-generation.ts`

- [ ] **Step 1: Update imports**

Replace `callDoubaoForText` import with `callDoubaoForTextStream`:

```ts
import {
  callDoubaoForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  applyShortDramaScriptSummaryResult,
} from './_text-generation.js'
```

- [ ] **Step 2: Add SSE response setup after validation and credit freeze**

After credit freeze succeeds and before model call, add:

```ts
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
})
reply.hijack()
reply.raw.write(': connected\n\n')

const sendEvent = (event: string, data: unknown): void => {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const sendPing = (): void => {
  reply.raw.write(': ping\n\n')
}
```

- [ ] **Step 3: Replace blocking model call with streaming flow**

Replace the current `let aiResponse` through final `return { ... }` logic with:

```ts
try {
  sendEvent('progress', { message: '正在生成剧本摘要' })

  const aiResponse = await callDoubaoForTextStream(REDACTED, userPrompt, 4000, {
    onChunk: (text) => sendEvent('chunk', { text }),
    onPing: sendPing,
  })

  const parsed = parseAndValidateJson(aiResponse, ['title', 'summary'])
  if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
    throw new Error('AI 返回的 title 或 summary 格式错误')
  }

  const actualCredits = calculateTextGenerationCredits(aiResponse)
  applyShortDramaScriptSummaryResult(state, {
    title: parsed.title,
    summary: parsed.summary,
  })

  const settledCredits = (await saveShortDramaStateAndSettleCredits({
    projectId,
    state,
    actualCredits,
    estimatedCredits: ESTIMATED_CREDITS,
    creditAccountId,
    userId,
    teamId,
    status: 'summary_ready',
    title: parsed.title,
  })).settledCredits

  sendEvent('done', {
    success: true,
    title: parsed.title,
    summary: parsed.summary,
    credits: settledCredits,
    state,
  })
} catch (error) {
  await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '摘要生成失败')
  app.log.error({ error, projectId }, '短剧摘要流式生成失败')
  sendEvent('error', {
    code: 'AI_ERROR',
    message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
  })
} finally {
  reply.raw.end()
}
```

- [ ] **Step 4: Verify pre-SSE errors still return JSON**

Do not move permission validation, existing-summary validation, missing-prompt validation, or credit-freeze validation after `reply.hijack()`. These errors should still return normal JSON status codes because the SSE stream has not started yet.

- [ ] **Step 5: Build API**

Run:

```powershell
pnpm --filter @aigc/api build
```

Expected: exit code 0 with:

```text
> @aigc/api@0.0.1 build ...
> tsc
```

---

### Task 4: Convert episode outlines endpoint to SSE batches with balance stop

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts`
- Uses: `apps/api/src/routes/short-drama/_text-generation.ts`
- Uses: `apps/api/src/services/credit.ts`

- [ ] **Step 1: Update imports**

Use these imports at the top of `post-episode-outlines.ts`:

```ts
import type { ShortDramaEpisodeOutline } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callDoubaoForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  applyShortDramaEpisodeOutlinesBatchResult,
  buildShortDramaOutlineBatches,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
```

- [ ] **Step 2: Change already-generated validation to allow continuation**

Replace:

```ts
if (state.script.outlines.length > 0) {
  return reply.status(400).send({
    error: { code: 'ALREADY_GENERATED', message: '分集梗概已生成' },
  })
}
```

with:

```ts
if (state.script.outlines.length >= state.settings.episodeCount) {
  return reply.status(400).send({
    error: { code: 'ALREADY_GENERATED', message: '分集梗概已生成' },
  })
}
```

- [ ] **Step 3: Add local outline parser for one batch**

Inside the route file, above `const route`, add:

```ts
function parseEpisodeOutlineBatch(
  aiResponse: string,
  from: number,
  to: number
): ShortDramaEpisodeOutline[] {
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('未找到有效的 JSON')
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown
  let episodes: unknown

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const maybeEpisodes = (parsed as { episodes?: unknown }).episodes
    if (Array.isArray(maybeEpisodes)) {
      episodes = maybeEpisodes
    } else {
      throw new Error('未找到 episodes 数组')
    }
  } else if (Array.isArray(parsed)) {
    episodes = parsed
  } else {
    throw new Error('未找到有效的数组')
  }

  const expectedCount = to - from + 1
  if (!Array.isArray(episodes) || episodes.length !== expectedCount) {
    throw new Error(`AI 返回的分集数量不正确，期望第 ${from}-${to} 集共 ${expectedCount} 集`)
  }

  return episodes.map((item, index) => {
    const ep = item as Record<string, unknown>
    if (
      typeof ep.episodeNumber !== 'number' ||
      typeof ep.title !== 'string' ||
      typeof ep.logline !== 'string' ||
      typeof ep.synopsis !== 'string' ||
      !Array.isArray(ep.characters) ||
      !Array.isArray(ep.scenes) ||
      typeof ep.hook !== 'string'
    ) {
      throw new Error(`第 ${from + index} 集的字段格式错误或缺少必需字段`)
    }

    return {
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      summary: ep.synopsis,
    }
  })
}
```

- [ ] **Step 4: Add SSE setup after validations**

After `const episodeCount = state.settings.episodeCount`, add:

```ts
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
})
reply.hijack()
reply.raw.write(': connected\n\n')

const sendEvent = (event: string, data: unknown): void => {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const sendPing = (): void => {
  reply.raw.write(': ping\n\n')
}
```

- [ ] **Step 5: Replace single freeze and single model call with batch loop**

Replace the old one-shot freeze/model/parse/save block with this batch loop:

```ts
const startEpisode = state.script.outlines.length + 1
const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
let completedCount = state.script.outlines.length
let totalCredits = 0
let stoppedByBalance = false
let warningMessage: string | null = null

try {
  for (const batch of batches) {
    let creditAccountId: string

    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS)
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      stoppedByBalance = true
      warningMessage = 'A豆余额不足，已停止生成后续大纲。已保存已完成的分集大纲，请充值后点击「继续生成大纲」生成剩余集数。'
      sendEvent('warning', {
        message: warningMessage,
        completedCount,
        totalCount: episodeCount,
        remainingCount: episodeCount - completedCount,
      })
      break
    }

    sendEvent('progress', {
      message: `开始生成第 ${batch.from}-${batch.to} 集大纲`,
      from: batch.from,
      to: batch.to,
      completedCount,
      totalCount: episodeCount,
    })

    const systemPrompt = `你是专业短剧编剧。请根据剧本摘要生成第 ${batch.from}-${batch.to} 集的分集梗概。只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown。`
    const userPrompt = `剧本摘要：${state.script.refinedPrompt}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数（${batch.from}-${batch.to}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 详细剧情梗概（100-200字）\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）`

    try {
      const aiResponse = await callDoubaoForTextStream(systemPrompt, userPrompt, 4000, {
        onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
        onPing: sendPing,
      })

      const outlines = parseEpisodeOutlineBatch(aiResponse, batch.from, batch.to)
      const actualCredits = calculateTextGenerationCredits(aiResponse)
      applyShortDramaEpisodeOutlinesBatchResult(state, outlines)

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: state.script.status === 'completed' ? 'outline_ready' : 'generating',
      })).settledCredits

      totalCredits += settledCredits
      completedCount = state.script.outlines.length

      sendEvent('progress', {
        message: `第 ${batch.from}-${batch.to} 集大纲生成完成`,
        from: batch.from,
        to: batch.to,
        completedCount,
        totalCount: episodeCount,
      })
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集大纲生成失败`)
      app.log.error({ error, projectId, batch }, '短剧分集大纲批次生成失败')

      if (completedCount > 0) {
        await saveShortDramaProjectState(projectId, state, 0)
      }

      sendEvent('error', {
        code: 'AI_ERROR',
        message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
        completedCount,
        totalCount: episodeCount,
      })
      return
    }
  }

  const partial = stoppedByBalance || state.script.outlines.length < episodeCount
  if (partial && warningMessage) {
    sendEvent('done', {
      success: true,
      partial: true,
      warning: warningMessage,
      completedCount,
      totalCount: episodeCount,
      remainingCount: episodeCount - completedCount,
      credits: totalCredits,
      state,
    })
  } else {
    sendEvent('done', {
      success: true,
      partial: false,
      outlines: state.script.outlines,
      credits: totalCredits,
      state,
    })
  }
} finally {
  reply.raw.end()
}
```

- [ ] **Step 6: Ensure partial save behavior is intentional**

Confirm the route no longer uses a single `creditAccountId` before all batches. Each batch freezes and settles independently. This ensures completed batches remain saved and charged; later balance failure does not roll back previous work.

- [ ] **Step 7: Build API**

Run:

```powershell
pnpm --filter @aigc/api build
```

Expected: exit code 0.

---

### Task 5: Add frontend short drama SSE consumer

**Files:**
- Modify: `apps/web/src/lib/short-drama/api.ts`

- [ ] **Step 1: Add auth store import**

At the top of `apps/web/src/lib/short-drama/api.ts`, add:

```ts
import { useAuthStore } from '@/stores/auth-store'
```

Keep existing imports sorted by project style.

- [ ] **Step 2: Add SSE event types**

Below `ShortDramaProjectDetail`, add:

```ts
export interface ShortDramaStreamProgress {
  message: string
  from?: number
  to?: number
  completedCount?: number
  totalCount?: number
}

export interface ShortDramaStreamWarning {
  message: string
  completedCount?: number
  totalCount?: number
  remainingCount?: number
}

export interface ShortDramaStreamResult {
  success: boolean
  partial?: boolean
  warning?: string
  title?: string
  summary?: string
  outlines?: ShortDramaState['script']['outlines']
  credits?: number
  completedCount?: number
  totalCount?: number
  remainingCount?: number
  state: ShortDramaState
}

export interface ShortDramaStreamOptions {
  onChunk?: (text: string) => void
  onProgress?: (progress: ShortDramaStreamProgress) => void
  onWarning?: (warning: ShortDramaStreamWarning) => void
}
```

- [ ] **Step 3: Add SSE consumer helper**

Below type declarations and before API functions, add:

```ts
const API_BASE = '/api/v1'

async function consumeShortDramaSSE<T>(
  res: Response,
  options: ShortDramaStreamOptions = {}
): Promise<T> {
  if (!res.body) {
    throw new Error('服务端未返回流式响应')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let result: T | null = null
  let currentEvent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      if (!line || line.startsWith(':')) continue

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (!line.startsWith('data: ')) continue

      const data = line.slice(6).trim()
      if (!data) continue

      const json = JSON.parse(data) as unknown
      if (currentEvent === 'chunk') {
        const payload = json as { text?: string }
        if (payload.text) options.onChunk?.(payload.text)
      } else if (currentEvent === 'progress') {
        options.onProgress?.(json as ShortDramaStreamProgress)
      } else if (currentEvent === 'warning') {
        options.onWarning?.(json as ShortDramaStreamWarning)
      } else if (currentEvent === 'done') {
        result = json as T
      } else if (currentEvent === 'error') {
        const payload = json as { message?: string }
        throw new Error(payload.message ?? '操作失败')
      }

      currentEvent = ''
    }
  }

  if (!result) {
    throw new Error('未收到完成事件')
  }

  return result
}
```

- [ ] **Step 4: Add authenticated SSE POST helper**

Add below `consumeShortDramaSSE`:

```ts
async function postShortDramaSSE<T>(
  path: string,
  options: ShortDramaStreamOptions = {}
): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? '生成失败')
  }

  return consumeShortDramaSSE<T>(res, options)
}
```

- [ ] **Step 5: Change summary and outline functions to SSE**

Replace summary function with:

```ts
export function generateShortDramaScriptSummary(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/summary`,
    options
  )
}
```

Replace outline function with:

```ts
export function generateShortDramaEpisodeOutlines(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-outlines`,
    options
  )
}
```

- [ ] **Step 6: Build web type check through Next build if feasible**

Run:

```powershell
pnpm --filter @aigc/web build
```

Expected: exit code 0. If this is slow or blocked by unrelated existing issues, capture the exact output and continue to Task 6 with the type errors relevant to changed files fixed.

---

### Task 6: Update StepScriptOutline streaming UI

**Files:**
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`

- [ ] **Step 1: Add stream state**

Inside `StepScriptOutline`, after existing state hooks, add:

```tsx
const [summaryStreamText, setSummaryStreamText] = useState('')
const [outlineStreamText, setOutlineStreamText] = useState('')
const [outlineProgressMessage, setOutlineProgressMessage] = useState('')
const [streamWarningMessage, setStreamWarningMessage] = useState('')
```

- [ ] **Step 2: Update summary generation handler**

Replace `handleGenerateSummary` with:

```tsx
const handleGenerateSummary = async () => {
  setGeneratingSummary(true)
  setSummaryStreamText('')
  setStreamWarningMessage('')
  try {
    await generateShortDramaScriptSummary(projectId, {
      onChunk: (text) => setSummaryStreamText((prev) => `${prev}${text}`),
      onProgress: (progress) => setSummaryStreamText((prev) => prev || progress.message),
    })
    onStateChange()
    toast.success('摘要生成完成')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '生成失败')
  } finally {
    setGeneratingSummary(false)
  }
}
```

- [ ] **Step 3: Update outline generation handler**

Replace `handleGenerateOutlines` with:

```tsx
const handleGenerateOutlines = async () => {
  setGeneratingOutlines(true)
  setOutlineStreamText('')
  setOutlineProgressMessage('')
  setStreamWarningMessage('')
  try {
    const result = await generateShortDramaEpisodeOutlines(projectId, {
      onChunk: (text) => setOutlineStreamText((prev) => `${prev}${text}`),
      onProgress: (progress) => setOutlineProgressMessage(progress.message),
      onWarning: (warning) => {
        setStreamWarningMessage(warning.message)
        toast.warning(warning.message)
      },
    })
    onStateChange()
    if (result.partial) {
      toast.warning(result.warning ?? '大纲已部分生成，请补充 A豆后继续生成')
    } else {
      toast.success('大纲生成完成')
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '生成失败')
  } finally {
    setGeneratingOutlines(false)
  }
}
```

- [ ] **Step 4: Change outline button text for continuation**

Replace button label expression:

```tsx
{state.script.outlines.length > 0 ? '重新生成' : '生成大纲'}
```

with:

```tsx
{state.script.outlines.length > 0 && state.script.outlines.length < state.settings.episodeCount
  ? '继续生成大纲'
  : state.script.outlines.length > 0
    ? '重新生成'
    : '生成大纲'}
```

- [ ] **Step 5: Render warning and streaming text**

After summary display block:

```tsx
{state.script.refinedPrompt && (
  <p className="text-sm bg-muted/50 p-3 rounded-lg">{state.script.refinedPrompt}</p>
)}
```

add:

```tsx
{generatingSummary && summaryStreamText && (
  <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-slate-700 whitespace-pre-wrap">
    {summaryStreamText}
  </div>
)}
```

After the outline header block and before existing outline list, add:

```tsx
{streamWarningMessage && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
    <div className="font-medium">生成已暂停</div>
    <p className="mt-1">{streamWarningMessage}</p>
    <p className="mt-1 text-xs">
      已生成 {state.script.outlines.length} / {state.settings.episodeCount} 集，可补充 A豆后继续生成剩余集数。
    </p>
  </div>
)}

{generatingOutlines && outlineProgressMessage && (
  <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
    {outlineProgressMessage}
  </div>
)}

{generatingOutlines && outlineStreamText && (
  <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
    {outlineStreamText}
  </div>
)}
```

- [ ] **Step 6: Prevent confirm when partial outlines exist**

Replace:

```tsx
{!isLocked && state.script.outlines.length > 0 && (
```

with:

```tsx
{!isLocked && state.script.outlines.length === state.settings.episodeCount && (
```

- [ ] **Step 7: Build web**

Run:

```powershell
pnpm --filter @aigc/web build
```

Expected: exit code 0, or unrelated existing build failures documented with changed-file type errors fixed.

---

### Task 7: Full verification and regression checks

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run backend helper regression test**

Run:

```powershell
& "D:\haobai\aigc-test\node_modules\.pnpm\node_modules\.bin\tsx.cmd" "D:\haobai\aigc-test\apps\api\src\__tests__\short-drama-text-generation-state.test.ts"
```

Expected: all short drama helper tests pass.

- [ ] **Step 2: Run API build**

Run:

```powershell
pnpm --filter @aigc/api build
```

Expected: exit code 0.

- [ ] **Step 3: Run web build**

Run:

```powershell
pnpm --filter @aigc/web build
```

Expected: exit code 0. If it fails for an unrelated existing reason, save the full output and identify whether any failure points to `apps/web/src/lib/short-drama/api.ts` or `apps/web/src/components/short-drama/step-script-outline.tsx`.

- [ ] **Step 4: Manual smoke test in local app**

Start services if not already running:

```powershell
pnpm --filter @aigc/api dev
pnpm --filter @aigc/web dev
```

Manual steps:

1. Open `/toby-studio/short-drama`.
2. Create a short drama project with 12 or more episodes.
3. Click `生成摘要`.
4. Confirm a streaming text area appears before final completion.
5. Confirm final summary appears after completion.
6. Click `生成大纲`.
7. Confirm progress shows `第 1-10 集` and then remaining batch.
8. Confirm final outline count equals project episode count if balance is enough.
9. If balance is insufficient, confirm warning text appears and completed outlines remain visible.
10. Confirm `确认剧本，进入素材` only appears when outline count equals configured episode count.

- [ ] **Step 5: Review git diff**

Run:

```powershell
git diff -- apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/routes/short-drama/post-script-summary.ts apps/api/src/routes/short-drama/post-episode-outlines.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts apps/web/src/lib/short-drama/api.ts apps/web/src/components/short-drama/step-script-outline.tsx docs/superpowers/specs/2026-06-01-short-drama-sse-outline-design.md docs/superpowers/plans/2026-06-01-short-drama-sse-outline.md
```

Check:

- No `any` added unless existing surrounding code already used it and no safer type is practical.
- No `console.log` in production files.
- No `TODO` or placeholder comments.
- SSE routes call `reply.raw.end()` in `finally` after stream starts.
- Balance failure sends warning and done partial, not error.

- [ ] **Step 6: Commit only with explicit user authorization**

If and only if the user explicitly asks to commit:

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/routes/short-drama/post-script-summary.ts apps/api/src/routes/short-drama/post-episode-outlines.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts apps/web/src/lib/short-drama/api.ts apps/web/src/components/short-drama/step-script-outline.tsx docs/superpowers/specs/2026-06-01-short-drama-sse-outline-design.md docs/superpowers/plans/2026-06-01-short-drama-sse-outline.md
git commit -m "feat: stream short drama text generation"
```

Commit message body must end with:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Self-Review

- Spec coverage: The plan covers SSE for summary/outlines, 240-second timeout, 10-episode batches, balance stop with partial preservation, warning copy, frontend stream display, and verification.
- Placeholder scan: No TBD/TODO placeholders remain. Steps include concrete file paths, code snippets, commands, and expected outputs.
- Type consistency: Shared frontend types are `ShortDramaStreamProgress`, `ShortDramaStreamWarning`, `ShortDramaStreamResult`, and `ShortDramaStreamOptions`; backend helper names match imports used by route tasks.
- Scope check: This plan is focused on text-generation SSE and does not alter image/video/export queues or DB schema.
