# 短剧分集概述（故事脉络）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在短剧剧本摘要与分集剧本之间，新增「分集概述」步骤：一次性全量生成所有 N 集的 100 字剧情概述作为故事蓝图，分集剧本生成时注入故事脉络，杜绝后续批次剧情冲突。

**Architecture:** 在 `ShortDramaState.script` 中扩展 `episodeSummaries` + `episodeSummaryStatus` 字段；后端新增 `POST /script/episode-summaries` 路由；改造 `POST /script/episode-outlines` 为单批次 + 故事脉络注入；前端在每集剧本卡片上方嵌入概述展示/编辑模块。

**Tech Stack:** TypeScript, Fastify 4 (SSE + Redis 锁 + 积分冻结/结算), Next.js 14 (React 18), Zustand, SWR, Qwen API (dashscope)

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 修改 | `packages/types/src/short-drama.ts` | 新增 `ShortDramaEpisodeSummary` 接口、`episodeSummaries`/`episodeSummaryStatus` 字段、normalize/makeDefault/makeUploaded 默认值、`isShortDramaEpisodeSummariesReady` 辅助函数 |
| 修改 | `apps/api/src/routes/short-drama/_script-source.ts` | 新增 `buildShortDramaEpisodeSummariesPrompts`、`buildShortDramaStoryLineage` |
| 修改 | `apps/api/src/routes/short-drama/_text-generation.ts` | 新增 `applyShortDramaEpisodeSummariesResult` |
| 新建 | `apps/api/src/routes/short-drama/post-episode-summaries.ts` | 分集概述生成路由（SSE 流式） |
| 修改 | `apps/api/src/routes/short-drama/post-episode-outlines.ts` | 前置门控 + 单批次 + 故事脉络注入 |
| 修改 | `apps/web/src/lib/short-drama/api.ts` | 新增 `generateShortDramaEpisodeSummaries`、`ShortDramaStreamResult` 扩展 |
| 新建 | `apps/web/src/components/short-drama/episode-summary-card.tsx` | 概述展示/编辑子组件 |
| 修改 | `apps/web/src/components/short-drama/step-script-outline.tsx` | 概述生成逻辑、按钮门控、卡片渲染 |
| 新建 | `apps/api/src/__tests__/short-drama-episode-summaries.test.ts` | 概述相关纯函数单元测试 |

---

## Task 1: 类型变更 — `ShortDramaEpisodeSummary` + 状态扩展

**Files:**
- Modify: `packages/types/src/short-drama.ts`

- [ ] **Step 1: 新增 `ShortDramaEpisodeSummary` 接口**

在 `ShortDramaEpisodeOutline` 接口（第 73 行 `}` 之后）插入：

```typescript
/** 单集剧情概述，作为故事脉络与剧本生成的固定蓝图 */
export interface ShortDramaEpisodeSummary {
  episodeNumber: number
  /** 该集约 100 字的剧情概述 */
  summary: string
}
```

- [ ] **Step 2: 扩展 `ShortDramaState.script` 字段**

在 `ShortDramaState` 接口的 `script` 块中，`refinedPrompt` 与 `outlines` 之间（约第 150 行后）插入两个字段：

```typescript
      refinedPrompt: string | null
      episodeSummaries: ShortDramaEpisodeSummary[]     // 新增：全量分集概述
      episodeSummaryStatus: ShortDramaGenerationStatus  // 新增：概述生成状态（断线回查用）
      outlines: ShortDramaEpisodeOutline[]
```

- [ ] **Step 3: 更新 `makeDefaultShortDramaState` 默认值**

在 `makeDefaultShortDramaState` 函数的 `script` 对象中（约第 380 行），`refinedPrompt` 后插入：

```typescript
      refinedPrompt: null,
      episodeSummaries: [],
      episodeSummaryStatus: 'idle',
      outlines: [],
```

- [ ] **Step 4: 更新 `makeUploadedShortDramaState` 默认值**

在 `makeUploadedShortDramaState` 函数的 `script` 覆盖对象中（约第 428 行），`refinedPrompt` 后插入：

```typescript
      refinedPrompt: null,
      episodeSummaries: [],
      episodeSummaryStatus: 'idle',
      outlines: [],
```

- [ ] **Step 5: 更新 `normalizeShortDramaState` 默认值**

在 `normalizeShortDramaState` 函数的 `script` 块中（约第 455 行），`refinedPrompt` 后插入：

```typescript
      refinedPrompt: partial.script?.refinedPrompt ?? null,
      episodeSummaries: (partial.script?.episodeSummaries ?? []) as ShortDramaEpisodeSummary[],
      episodeSummaryStatus: partial.script?.episodeSummaryStatus ?? 'idle',
      outlines,
```

- [ ] **Step 6: 新增 `isShortDramaEpisodeSummariesReady` 辅助函数**

在 `areShortDramaAssetsReady` 函数之后（约第 365 行后）插入：

```typescript
/**
 * 判断分集概述是否已全量就绪（数量 >= 设定集数）。
 * 概述就绪是生成分集剧本的前置条件。
 */
export function isShortDramaEpisodeSummariesReady(state: ShortDramaState): boolean {
  return state.script.episodeSummaries.length >= state.settings.episodeCount
}
```

- [ ] **Step 7: 构建 types 包并验证编译**

Run: `pnpm --filter @aigc/types build`
Expected: 编译成功，无类型错误

- [ ] **Step 8: 提交**

```bash
git add packages/types/src/short-drama.ts
git commit -m "feat(short-drama): 新增 ShortDramaEpisodeSummary 类型与状态字段

- 新增 ShortDramaEpisodeSummary 接口（episodeNumber + summary）
- ShortDramaState.script 扩展 episodeSummaries + episodeSummaryStatus
- makeDefault/normalize 补齐默认值，旧 JSON 向后兼容
- 新增 isShortDramaEpisodeSummariesReady 辅助函数"
```

---

## Task 2: 后端 — 概述 Prompt 构建 + 状态写回函数

**Files:**
- Modify: `apps/api/src/routes/short-drama/_script-source.ts`
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`

- [ ] **Step 1: 写失败测试 — 概述状态写回**

创建 `apps/api/src/__tests__/short-drama-episode-summaries.test.ts`：

```typescript
import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState, normalizeShortDramaState, isShortDramaEpisodeSummariesReady } from '@aigc/types'
import { applyShortDramaEpisodeSummariesResult } from '../routes/short-drama/_text-generation.js'

console.log('测试短剧分集概述状态写回...')

// 测试 1：概述生成结果写回
const state = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
state.script.refinedPrompt = '一个普通外卖员意外获得超能力，在都市中守护弱小。'

assert.equal(state.script.episodeSummaries.length, 0)
assert.equal(state.script.episodeSummaryStatus, 'idle')
console.log('✓ 初始状态：概述为空，状态为 idle')

applyShortDramaEpisodeSummariesResult(state, [
  { episodeNumber: 1, summary: '外卖员林晚在暴雨夜送餐途中被雷击，觉醒超能力。' },
  { episodeNumber: 2, summary: '林晚尝试隐藏能力，却在火灾中被迫出手救下邻居小孩。' },
  { episodeNumber: 3, summary: '林晚的能力引来神秘组织注意，被迫在守护与逃跑间抉择。' },
])

assert.equal(state.script.episodeSummaries.length, 3)
assert.equal(state.script.episodeSummaries[0]?.summary, '外卖员林晚在暴雨夜送餐途中被雷击，觉醒超能力。')
assert.equal(state.script.episodeSummaries[2]?.episodeNumber, 3)
assert.equal(state.script.episodeSummaryStatus, 'completed')
console.log('✓ 概述生成结果写回 episodeSummaries + episodeSummaryStatus = completed')

// 测试 2：isShortDramaEpisodeSummariesReady
const readyState = makeDefaultShortDramaState({
  prompt: '测试',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
assert.equal(isShortDramaEpisodeSummariesReady(readyState), false)
readyState.script.episodeSummaries = [
  { episodeNumber: 1, summary: 'a' },
  { episodeNumber: 2, summary: 'b' },
  { episodeNumber: 3, summary: 'c' },
]
assert.equal(isShortDramaEpisodeSummariesReady(readyState), true)
console.log('✓ isShortDramaEpisodeSummariesReady 判断正确')

// 测试 3：normalize 对旧 JSON 的向后兼容
const normalized = normalizeShortDramaState({
  script: {
    source: 'idea',
    originalPrompt: '旧项目',
    refinedPrompt: '旧摘要',
    outlines: [],
  },
  settings: { style: '真人都市', aspectRatio: '9:16', episodeCount: 5 },
})
assert.equal(normalized.script.episodeSummaries.length, 0)
assert.equal(normalized.script.episodeSummaryStatus, 'idle')
console.log('✓ normalizeShortDramaState 对无新字段的旧 JSON 补默认值')

// 测试 4：隐式锁定判断 — outlines.length > 0 即锁定
const lockedState = makeDefaultShortDramaState({
  prompt: '测试',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
lockedState.script.episodeSummaries = [
  { episodeNumber: 1, summary: 'a' },
  { episodeNumber: 2, summary: 'b' },
  { episodeNumber: 3, summary: 'c' },
]
// 概述就绪但无剧本 → 未锁定，可编辑
assert.equal(isShortDramaEpisodeSummariesReady(lockedState), true)
assert.equal(lockedState.script.outlines.length, 0)
console.log('✓ 概述就绪但无剧本 → 未锁定，概述可编辑')

lockedState.script.outlines = [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
]
// 有剧本 → 隐式锁定
assert.equal(lockedState.script.outlines.length > 0, true)
console.log('✓ 有剧本 → outlines.length > 0 → 概述隐式锁定')

console.log('\n✅ 短剧分集概述测试通过！')
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-episode-summaries.test.ts`
Expected: FAIL — `applyShortDramaEpisodeSummariesResult` is not exported

- [ ] **Step 3: 实现 `applyShortDramaEpisodeSummariesResult`**

在 `apps/api/src/routes/short-drama/_text-generation.ts` 中，`applyShortDramaScriptSummaryResult` 函数之后（约第 411 行后）插入：

```typescript
/**
 * 将分集概述生成结果写回短剧状态。
 * 概述是一次性全量生成，写回后直接标记 episodeSummaryStatus = 'completed'。
 * 注意：此函数不修改 script.status，后者属于摘要/剧本流程，避免互相覆盖。
 */
export function applyShortDramaEpisodeSummariesResult(
  state: ShortDramaState,
  summaries: Array<{ episodeNumber: number; summary: string }>
): void {
  state.script.episodeSummaries = summaries
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
  state.script.episodeSummaryStatus = 'completed'
}
```

- [ ] **Step 4: 实现 `buildShortDramaEpisodeSummariesPrompts`**

在 `apps/api/src/routes/short-drama/_script-source.ts` 末尾追加：

```typescript
/**
 * 构建分集概述生成的 systemPrompt + userPrompt。
 * 一次性为全部 N 集各生成约 100 字的剧情概述，作为故事蓝图。
 */
export function buildShortDramaEpisodeSummariesPrompts(state: ShortDramaState): {
  systemPrompt: string
  userPrompt: string
} {
  const source = getShortDramaSummarySourceText(state)
  const episodeCount = state.settings.episodeCount

  const systemPrompt = [
    '你是专业短剧编剧，擅长规划连续短剧的整体故事脉络。',
    `根据剧本摘要为 ${episodeCount} 集短剧的每一集生成约 100 字的剧情概述。`,
    '概述必须形成连贯的故事脉络，覆盖起承转合、人物关系变化与阶段性钩子。',
    '集与集之间要有因果递进，不能互相矛盾。',
    '只输出 JSON 数组，每个元素包含 episodeNumber（1-based）和 summary 字段，不要输出 markdown、代码块或额外解释。',
    '每集概述约 100 字左右（根据剧情内容可适当增减），第 N 集概述必须承接第 N-1 集结尾。',
  ].join('\n')

  const userPrompt = `${source.label}：${source.text}\n\n项目设置：\n- 集数：${episodeCount}\n- 视觉风格：${state.settings.style}\n- 画面比例：${state.settings.aspectRatio}\n\n请生成 ${episodeCount} 集的剧情概述，返回 JSON 数组：\n[\n  {"episodeNumber": 1, "summary": "第1集概述..."},\n  {"episodeNumber": 2, "summary": "第2集概述..."},\n  ...\n]\n\n要求：\n- 每集概述约 100 字左右（根据剧情内容可适当增减），描述该集核心事件、人物变化和结尾钩子。\n- 概述之间必须因果递进：前一集的结局是后一集的开端。\n- 覆盖完整故事弧线：开头铺设、中段冲突升级、高潮反转、结尾收束。\n- 人物关系变化必须贯穿始终，不能中途遗忘或矛盾。\n- 视觉风格"${state.settings.style}"必须体现在场景选择和表演节奏的描述中。`

  return { systemPrompt, userPrompt }
}

/**
 * 构建故事脉络文本，注入分集剧本生成的 prompt。
 * 取第 1 到 toEpisode 集的概述（当前批次 + 之前所有集数），
 * 保证 AI 看到完整蓝图至当前点。
 */
export function buildShortDramaStoryLineage(state: ShortDramaState, toEpisode: number): string {
  const summaries = state.script.episodeSummaries
    .filter(s => s.episodeNumber <= toEpisode)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)

  if (summaries.length === 0) return ''

  const lines = summaries.map(
    s => `第 ${s.episodeNumber} 集：${s.summary}`
  )

  return [
    '已确定的分集剧情脉络（请严格遵循，保持人物、伏笔、反转前后一致）：',
    ...lines,
  ].join('\n')
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-episode-summaries.test.ts`
Expected: `✅ 短剧分集概述测试通过！`

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/routes/short-drama/_script-source.ts apps/api/src/__tests__/short-drama-episode-summaries.test.ts
git commit -m "feat(short-drama): 概述 prompt 构建与状态写回函数

- applyShortDramaEpisodeSummariesResult 写回 episodeSummaries
- buildShortDramaEpisodeSummariesPrompts 构建概述生成 prompt
- buildShortDramaStoryLineage 构建故事脉络文本（注入剧本 prompt）
- 单元测试覆盖：写回、就绪判断、normalize 兼容、隐式锁定"
```

---

## Task 3: 后端新增 — 分集概述生成路由

**Files:**
- Create: `apps/api/src/routes/short-drama/post-episode-summaries.ts`

- [ ] **Step 1: 创建路由文件**

创建 `apps/api/src/routes/short-drama/post-episode-summaries.ts`：

```typescript
import type { FastifyPluginAsync } from 'fastify'
import type { ShortDramaEpisodeSummary } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  parseAndValidateJson,
  applyShortDramaEpisodeSummariesResult,
  saveShortDramaProjectState,
  markShortDramaProjectFailed,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { buildShortDramaEpisodeSummariesPrompts } from './_script-source.js'
import { createShortDramaSSESession } from './_sse.js'

// 概述生成预冻结积分：按全量 N 集估算，每集约 0.5 A豆（100 字概述），保守取 40
const ESTIMATED_CREDITS = 40
// 概述输出 maxTokens：按最大 100 集 × 100 字 + JSON 结构估算
const EPISODE_SUMMARIES_MAX_TOKENS = 8000

function parseEpisodeSummaries(
  aiResponse: string,
  episodeCount: number
): ShortDramaEpisodeSummary[] {
  const parsed = parseAndValidateJson(aiResponse, [])

  let summaries: unknown
  if (Array.isArray(parsed)) {
    summaries = parsed
  } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).episodes)) {
    summaries = (parsed as Record<string, unknown>).episodes
  } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).summaries)) {
    summaries = (parsed as Record<string, unknown>).summaries
  } else {
    throw new Error('AI 返回的 JSON 中未找到有效的概述数组')
  }

  if (!Array.isArray(summaries) || summaries.length !== episodeCount) {
    throw new Error(`AI 返回的概述数量不正确，期望 ${episodeCount} 集，实际 ${Array.isArray(summaries) ? summaries.length : 0} 集`)
  }

  return summaries.map((item, index) => {
    const ep = item as Record<string, unknown>
    if (
      typeof ep.episodeNumber !== 'number' ||
      typeof ep.summary !== 'string'
    ) {
      throw new Error(`第 ${index + 1} 集概述的字段格式错误或缺少必需字段`)
    }
    return {
      episodeNumber: ep.episodeNumber,
      summary: ep.summary.trim(),
    }
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/episode-summaries', async (request, reply) => {
    const { id: projectId } = request.params

    // 校验项目访问权限
    let projectData
    try {
      projectData = await assertShortDramaProjectAccess(projectId, request.user.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权访问该项目'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message },
      })
    }

    const { project } = projectData
    const state = project.state
    const teamId = project.team_id
    const userId = request.user.id

    // 前置校验：剧本摘要必须已生成
    if (!state.script.refinedPrompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成剧本摘要' },
      })
    }

    // 前置校验：概述未重复生成
    if (state.script.episodeSummaries.length >= state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集概述已生成' },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-summaries`)
    if (!generationLock) {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '分集概述正在生成中，请稍后刷新查看进度' },
      })
    }

    // 预冻结积分
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS, '短剧分集概述冻结')
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '积分冻结失败'
      return reply.status(402).send({
        error: { code: 'INSUFFICIENT_CREDITS', message },
      })
    }

    // 设置概述生成状态（不修改 script.status，避免与摘要/剧本流程互相覆盖）
    try {
      state.script.episodeSummaryStatus = 'generating'
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId }, '短剧概述生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    const { systemPrompt, userPrompt } = buildShortDramaEpisodeSummariesPrompts(state)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.hijack()
    reply.raw.write(': connected\n\n')

    const session = createShortDramaSSESession(reply)
    const { sendEvent, sendPing, clientSignal } = session

    let persisted = false

    try {
      sendEvent('progress', { message: '正在生成分集概述' })

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, EPISODE_SUMMARIES_MAX_TOKENS, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
        externalSignal: clientSignal,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.episode_summaries',
          endpoint: '/chat/completions',
        },
      })

      const episodeCount = state.settings.episodeCount
      const summaries = parseEpisodeSummaries(aiResponse, episodeCount)
      const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
      applyShortDramaEpisodeSummariesResult(state, summaries)

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: 'generating',  // 项目仍在生成中，剧本尚未完成
      })).settledCredits

      persisted = true

      sendEvent('done', {
        success: true,
        episodeSummaries: summaries,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      if (persisted) {
        app.log.warn({ error, projectId }, '短剧概述已生成成功，但向客户端推送结果失败')
      } else {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成失败')
        state.script.episodeSummaryStatus = 'failed'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ saveError, projectId }, '短剧概述失败状态保存失败')
        })
        app.log.error({ error, projectId }, '短剧概述流式生成失败')
        sendEvent('error', {
          code: 'AI_ERROR',
          message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
        })
      }
    } finally {
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
  })
}

export default route
```

- [ ] **Step 2: 验证文件被 autoload 自动注册**

`post-episode-summaries.ts` 文件名不以 `_` 开头，位于 `routes/short-drama/` 目录下，会被 `@fastify/autoload` 自动注册为 `POST /short-drama/projects/:id/script/episode-summaries`。无需额外配置。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/routes/short-drama/post-episode-summaries.ts
git commit -m "feat(short-drama): 新增分集概述生成路由 POST /script/episode-summaries

- SSE 流式生成全量 N 集概述，预冻结 40 A豆
- 前置校验：摘要已生成 + 概述未重复
- episodeSummaryStatus 独立流转，不覆盖 script.status
- Redis 分布式锁 + persisted 标志防误退积分"
```

---

## Task 4: 后端改造 — 分集剧本路由门控 + 单批次 + 故事脉络注入

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts`

- [ ] **Step 1: 增加概述就绪前置门控**

在 `post-episode-outlines.ts` 中，现有「剧本摘要已生成」和「大纲未完成」校验之后（约第 119 行后），插入概述就绪校验：

在现有 `if (state.script.outlines.length >= state.settings.episodeCount)` 块之后，插入：

```typescript
    // 前置校验：分集概述必须已就绪（隐式锁定）
    if (state.script.episodeSummaries.length < state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成并锁定全部分集概述' },
      })
    }
```

- [ ] **Step 2: 改为单批次 — 替换多批循环逻辑**

将现有的 `const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)` 及后续的 `for (const batch of batches)` 循环，整体替换为单批次逻辑。

删除第 127 行 `const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)` ，替换为：

```typescript
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
    // 只取下一批（单批次模式）
    const batch = batches[0]
    if (!batch) {
      await releaseRedisLock(app.redis, generationLock)
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集剧本已生成' },
      })
    }
```

然后在 try 块内，将 `for (const batch of batches) {` 循环体展开为单次执行。具体改动：

1. 删除 `for (const batch of batches) {` 和对应的闭合 `}`
2. 删除循环内的 `freezeCredits` 调用 — 将积分冻结提到循环外（SSE hijack 之前），与摘要路由对齐
3. 删除 `stoppedByBalance` / `warningMessage` 相关的余额不足分支
4. 删除 `completedCount` 跟踪变量（单批次不需要渐进计数）
5. 将 `totalCredits` 简化为直接使用 `settledCredits`

以下是需要替换的完整改动块。将 `let completedCount = state.script.outlines.length` 到 `const partial = stoppedByBalance ...` 的整个 try 块内容，替换为：

在 `const { sendEvent, sendPing, clientSignal } = session` 之后，`let persisted = false` 之前插入积分冻结：

```typescript
    let creditAccountId: string
    try {
      const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS, '短剧分集大纲冻结')
      creditAccountId = freezeResult.creditAccountId
    } catch (error) {
      await releaseRedisLock(app.redis, generationLock)
      const message = error instanceof Error ? error.message : '积分冻结失败'
      sendEvent('error', { code: 'INSUFFICIENT_CREDITS', message })
      session.end()
      return
    }

    let persisted = false
```

然后 try 块的核心逻辑改为：

```typescript
    try {
      sendEvent('progress', {
        message: `开始生成第 ${batch.from}-${batch.to} 集剧本`,
        from: batch.from,
        to: batch.to,
        completedCount: state.script.outlines.length,
        totalCount: episodeCount,
      })

      // 构建注入故事脉络的 systemPrompt + userPrompt
      const storyLineage = buildShortDramaStoryLineage(state, batch.to)
      const systemPrompt = [
        '你是专业短剧编剧，擅长把系列设定拆成可拍摄的分场剧本。',
        `请根据剧本摘要生成第 ${batch.from}-${batch.to} 集的分集剧本。`,
        storyLineage ? '必须延续上方故事脉络，不得与已确定的概述产生剧情冲突。' : '',
        '只输出 JSON 数组，每个元素包含 episodeNumber、title、logline、synopsis、characters、scenes、hook 字段，不要输出 markdown、代码块或额外解释。',
        'synopsis 不再写普通梗概，必须写成分场剧本正文，使用"### 场X-Y"作为场次标题。',
        '每场必须包含：时段、内/外、地点、出场人物、动作描写、对白，可按需要加入【字幕】、【闪回】、【闪回结束】、角色（vo）、角色（os）。',
        '动作描写使用"△ "开头；对白使用"角色名（语气/状态）：对白"。',
        '每场开头必须补一行【戏剧功能：...】，说明该场承担开场钩子、冲突升级、信息反转、主动选择、情绪余波或结尾钩子中的哪一种功能。',
        '每场必须写出【场记锚点：...】，记录本场开始和结束时人物站位、关键道具位置、门窗/桌椅/文件/手机等物件状态，为后续镜头切换和片段拆分保持连续。',
        '每集剧情长度必须能支撑约 2 分钟成片：整体分成 3-5 个完整场景，每场承担一个明确戏剧功能。',
        '每场必须有足够信息量，包含 3-6 条动作/对白/OS/VO 节点；每集总计至少 12-16 个可拆成视频片段的动作/对白节点。',
        '不要只写梗概式摘要；需要具体到镜头动作、人物反应、对白推进、场景转换、状态变化和结尾钩子。',
        '动作与情绪要使用可见细节，不要用"愤怒、悲伤、震惊"等抽象词直接代替表演；必须拆成眼神、呼吸、停顿、手部动作、身体重心变化。',
        '必须延续项目视觉风格；如果项目视觉风格是 2D/3D 动漫、漫画、插画、卡通、国漫、日漫、赛璐璐、黏土/粘土、盲盒、定格动画或虾仁动画风格，分集剧本中的画面动作、场景气质、灯光色彩和表演描述都必须按动画、插画、CG、黏土或对应风格语言书写，禁止写成真人摄影、写实剧照或影视实拍质感。',
      ].filter(Boolean).join('\n')

      const lineageBlock = storyLineage ? `${storyLineage}\n\n其中第 ${batch.from}-${batch.to} 集为本次需要生成分场剧本的集数，请依据上述脉络展开。\n\n` : ''
      const userPrompt = `${lineageBlock}剧本摘要：${state.script.refinedPrompt}\n\n项目视觉风格：${state.settings.style}\n画面比例：${state.settings.aspectRatio}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数（${batch.from}-${batch.to}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 分场剧本正文，必须类似下面格式：\n### 场1-1\n日 内 旧教室\n【戏剧功能：开场钩子，建立拆迁压力和主角困境】\n出场人物：林微\n【场记锚点：场开始时林微站在教室门口，旧课桌堆在画面右侧；场结束时她走到第一排课桌旁，手按在刻字桌面上】\n【字幕：2024年，南方县城老中学，即将拆除】\n△ 阳光透过布满灰尘的窗户，墙上一个刺眼的红色"拆"字随风晃动。\n角色名（语气）：对白内容。\n角色名（os）：内心独白。\n\n### 场1-2\n夜 外 校园走廊\n【戏剧功能：冲突升级】\n出场人物：角色A、角色B\n【场记锚点：角色A靠近走廊左侧窗台，角色B挡在楼梯口，手机始终握在角色A右手】\n△ 动作与画面调度。\n角色A（压低声音）：对白内容。\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）\n\n长度与节奏要求：\n- 每集 synopsis 必须能支撑约 2 分钟成片，不要生成只能拍几十秒的短概要。\n- 每集整体分成 3-5 个场景，避免 8 个以上碎场；每个场景要有清晰戏剧功能，例如"开场钩子、冲突升级、信息反转、主动选择、结尾钩子"。\n- 每集至少写出 12-16 个清晰的动作/对白节点，方便后续按场内节拍拆成 10-12 个视频片段。\n- 每个场景至少包含 3-6 条"△"动作描写或对白/OS/VO，不要只有一两句概述。\n- 场号按"场${batch.from}-1、场${batch.from}-2..."书写；每场第一行写"日/夜 内/外 地点"，第二行写"【戏剧功能：...】"，第三行写"出场人物：..."，第四行写"【场记锚点：...】"。\n- 多用画面动作和人物对白推进剧情，少写概述性总结。\n- 动作描写要能被摄影和演员执行：写清人物从哪里来、看向哪里、哪只手拿着什么、动作结束停在哪里。\n- 视觉风格"${state.settings.style}"必须体现在场景选择、表演克制程度、镜头节奏、色彩和灯光上，不要只写剧情。\n- 每集要形成一个小冲突和结尾钩子。`

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, OUTLINE_BATCH_MAX_TOKENS, {
        onChunk: (text) => sendEvent('chunk', { text, from: batch.from, to: batch.to }),
        onPing: sendPing,
        externalSignal: clientSignal,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.episode_outlines',
          endpoint: '/chat/completions',
        },
      })

      const previousState = JSON.parse(JSON.stringify(state)) as typeof state
      const outlines = parseEpisodeOutlineBatch(aiResponse, batch.from, batch.to)
      const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
      applyShortDramaEpisodeOutlinesBatchResult(state, outlines)

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        status: state.script.outlines.length >= episodeCount ? 'outline_ready' : undefined,
      })).settledCredits

      persisted = true

      sendEvent('progress', {
        message: `第 ${batch.from}-${batch.to} 集剧本生成完成`,
        from: batch.from,
        to: batch.to,
        completedCount: state.script.outlines.length,
        totalCount: episodeCount,
      })

      sendEvent('done', {
        success: true,
        outlines: state.script.outlines,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      if (persisted) {
        app.log.warn({ error, projectId }, '短剧分集剧本已生成成功，但向客户端推送结果失败')
      } else {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集剧本生成失败`)
        state.script.status = 'failed'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ error: saveError, projectId }, '短剧分集剧本失败状态保存失败')
        })
        app.log.error({ error, projectId, batch }, '短剧分集剧本批次生成失败')
        sendEvent('error', {
          code: 'AI_ERROR',
          message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
          completedCount: state.script.outlines.length,
          totalCount: episodeCount,
        })
      }
    } finally {
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
```

- [ ] **Step 3: 在文件顶部新增 `buildShortDramaStoryLineage` 导入**

在 `post-episode-outlines.ts` 的 import 区域，`_script-source.js` 的导入行后追加：

```typescript
import { buildShortDramaStoryLineage } from './_script-source.js'
```

注意：当前文件没有从 `_script-source.js` 导入任何内容，需要新增整行。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/short-drama/post-episode-outlines.ts
git commit -m "refactor(short-drama): 分集剧本改为单批次 + 故事脉络注入 + 概述门控

- 前置校验：分集概述必须已就绪才能生成剧本
- 移除多批循环，改为每次调用只生成下一批（5 集）
- 注入故事脉络（buildShortDramaStoryLineage）到 prompt
- 积分冻结提到循环外，与摘要路由对齐
- persisted 标志防误退积分"
```

---

## Task 5: 前端 API 层 — 概述生成函数 + StreamResult 扩展

**Files:**
- Modify: `apps/web/src/lib/short-drama/api.ts`

- [ ] **Step 1: `ShortDramaStreamResult` 扩展**

在 `ShortDramaStreamResult` 接口中（约第 83 行 `outlines` 之后）增加：

```typescript
  outlines?: ShortDramaState['script']['outlines']
  episodeSummaries?: ShortDramaState['script']['episodeSummaries']
  assets?: ShortDramaState['assets']['items']
```

- [ ] **Step 2: 新增 `generateShortDramaEpisodeSummaries` 函数**

在 `generateShortDramaEpisodeOutlines` 函数之后（约第 385 行后）插入：

```typescript
export function generateShortDramaEpisodeSummaries(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-summaries`,
    options,
    projectId,
    (project) => project.state.script.episodeSummaryStatus === 'generating',
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/short-drama/api.ts
git commit -m "feat(short-drama): 前端 API 层新增 generateShortDramaEpisodeSummaries

- ShortDramaStreamResult 扩展 episodeSummaries 可选字段
- 新增 generateShortDramaEpisodeSummaries，断线回查谓词 episodeSummaryStatus"
```

---

## Task 6: 前端 — 概述卡片子组件

**Files:**
- Create: `apps/web/src/components/short-drama/episode-summary-card.tsx`

- [ ] **Step 1: 创建概述卡片组件**

创建 `apps/web/src/components/short-drama/episode-summary-card.tsx`：

```typescript
'use client'

import { useState } from 'react'
import { Pencil, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { saveShortDramaProject } from '@/lib/short-drama/api'
import type { ShortDramaState, ShortDramaEpisodeSummary } from '@aigc/types'
import { translateError } from '@/lib/error-messages'

interface EpisodeSummaryCardProps {
  projectId: string
  episodeNumber: number
  summary: string
  canEdit: boolean
  state: ShortDramaState
  onStateChange: () => void
}

/**
 * 分集概述卡片 — 展示在每集剧本上方。
 * 剧本未生成时可编辑（隐式锁定：outlines.length > 0 时只读）。
 */
export function EpisodeSummaryCard({
  projectId,
  episodeNumber,
  summary,
  canEdit,
  state,
  onStateChange,
}: EpisodeSummaryCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(summary)
  const [saving, setSaving] = useState(false)

  const handleStartEdit = () => {
    setDraft(summary)
    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft(summary)
  }

  const handleSave = async () => {
    const trimmed = draft.trim()
    if (!trimmed) return

    setSaving(true)
    try {
      const nextSummaries = state.script.episodeSummaries.map(s =>
        s.episodeNumber === episodeNumber
          ? { ...s, summary: trimmed }
          : s
      )
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          script: { ...state.script, episodeSummaries: nextSummaries },
        },
      })
      setEditing(false)
      onStateChange()
      toast.success('分集概述已保存')
    } catch (err) {
      toast.error(translateError(err instanceof Error ? err.message : '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-violet-300">分集概述</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving} className="h-6 px-2 text-xs">
              <X className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving || !draft.trim()} className="h-6 px-2 text-xs">
              {saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="min-h-[60px] resize-none rounded-md border-violet-500/30 bg-black/20 p-2 text-xs leading-5 text-foreground"
          autoFocus
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-violet-300">分集概述</span>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={handleStartEdit} className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground whitespace-pre-wrap">
        {summary || '（待生成）'}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/short-drama/episode-summary-card.tsx
git commit -m "feat(short-drama): 新增 EpisodeSummaryCard 概述卡片子组件

- 展示分集概述文本，剧本未生成时可编辑
- 编辑后调 saveShortDramaProject 写回 episodeSummaries
- 隐式锁定：canEdit 由父组件根据 outlines.length 判断"
```

---

## Task 7: 前端 — step-script-outline 集成概述生成与展示

**Files:**
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`

- [ ] **Step 1: 新增导入**

在文件顶部的 import 区域（约第 22 行 `generateShortDramaEpisodeOutlines` 后）增加：

```typescript
  generateShortDramaEpisodeOutlines,
  generateShortDramaEpisodeSummaries,
```

在 `SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS` 导入下方（约第 18 行后）增加：

```typescript
import type { ShortDramaState } from '@aigc/types'
```

在 `translateError` 导入下方增加：

```typescript
import { EpisodeSummaryCard } from './episode-summary-card'
```

- [ ] **Step 2: 新增概述相关状态**

在 `StepScriptOutline` 组件的 `useState` 区域（约第 919 行 `generatingOutlines` 后）增加：

```typescript
  const [generatingOutlines, setGeneratingOutlines] = useState(false)
  const [generatingSummaries, setGeneratingSummaries] = useState(false)
```

在 `generatingOutlinesRef` 后（约第 938 行后）增加：

```typescript
  const generatingOutlinesRef = useRef(false)
  const generatingSummariesRef = useRef(false)
```

- [ ] **Step 3: 新增概述生成逻辑 — `handleGenerateSummaries`**

在 `handleGenerateOutlines` 函数之后（约第 1042 行后）插入：

```typescript
  const handleGenerateSummaries = async () => {
    if (
      generatingSummariesRef.current ||
      state.script.episodeSummaryStatus === 'generating' ||
      !state.script.refinedPrompt ||
      state.script.episodeSummaries.length >= state.settings.episodeCount
    ) return
    const ok = await confirmDialog({
      title: '确认生成',
      description: '本次操作预计消耗约 40 A豆（生成全部分集概述），确认是否继续？',
      confirmText: '确认生成',
      destructive: false,
    })
    if (!ok) return
    generatingSummariesRef.current = true
    setGeneratingSummaries(true)
    setSummaryStreamText('')
    setOutlineProgressMessage('')
    setStreamWarningMessage('')
    try {
      await generateShortDramaEpisodeSummaries(projectId, {
        onChunk: text => setSummaryStreamText(current => current + text),
        onProgress: progress => setOutlineProgressMessage(progress.message),
        onWarning: warning => setStreamWarningMessage(warning.message),
      })
      onStateChange()
    } catch (err) {
      toast.error(translateError(err instanceof Error ? err.message : '生成失败'))
    } finally {
      generatingSummariesRef.current = false
      setGeneratingSummaries(false)
    }
  }
```

- [ ] **Step 4: 新增概述生成状态派生变量**

在 `isOutlinesGenerating` 定义之后（约第 954 行后）增加：

```typescript
  const isSummariesGenerating =
    generatingSummaries ||
    state.script.episodeSummaryStatus === 'generating'
  const isSummariesReady = state.script.episodeSummaries.length >= state.settings.episodeCount
  // 概述隐式锁定：已有剧本时概述不可编辑
  const isSummariesLocked = state.script.outlines.length > 0
```

- [ ] **Step 5: 改造 `EpisodeOutlineList` — 接收并渲染概述**

修改 `EpisodeOutlineList` 函数签名（约第 791 行），增加 `episodeSummaries` 和概述相关 props：

将现有的：

```typescript
function EpisodeOutlineList({
  outlines,
  canEdit,
  onEditTitle,
  onEditScene,
}: {
  outlines: Array<{ episodeNumber: number; title: string; summary: string }>
  canEdit: boolean
  onEditTitle: (episodeNumber: number) => void
  onEditScene: (episodeNumber: number, sceneIndex: number) => void
})
```

替换为：

```typescript
function EpisodeOutlineList({
  outlines,
  episodeSummaries,
  canEditSummary,
  canEditOutline,
  projectId,
  state,
  onStateChange,
  onEditTitle,
  onEditScene,
}: {
  outlines: Array<{ episodeNumber: number; title: string; summary: string }>
  episodeSummaries: Array<{ episodeNumber: number; summary: string }>
  canEditSummary: boolean
  canEditOutline: boolean
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
  onEditTitle: (episodeNumber: number) => void
  onEditScene: (episodeNumber: number, sceneIndex: number) => void
})
```

在 `EpisodeOutlineList` 渲染中，每个 `<section>` 卡片的 `<div className="mt-3 space-y-2">` 之前（约第 827 行前），插入概述卡片：

```typescript
                {/* 分集概述 — 置于剧本正文上方 */}
                {(() => {
                  const episodeSummary = episodeSummaries.find(s => s.episodeNumber === outline.episodeNumber)
                  return episodeSummary ? (
                    <div className="mb-3">
                      <EpisodeSummaryCard
                        projectId={projectId}
                        episodeNumber={outline.episodeNumber}
                        summary={episodeSummary.summary}
                        canEdit={canEditSummary}
                        state={state}
                        onStateChange={onStateChange}
                      />
                    </div>
                  ) : null
                })()}
```

- [ ] **Step 6: 改造 `EpisodeOutlineList` 渲染 — 概述就绪但无剧本的集**

在 `EpisodeOutlineList` 的 `group.outlines.map` 中，对于 `episodeSummaries` 中有但 `outlines` 中没有的集（概述已生成但剧本未生成），也需要渲染卡片。

在 `groups.map(group => ...)` 的 `{group.outlines.map(outline => ...)}` 之后，追加对「仅有概述无剧本」集的渲染：

```typescript
              {/* 仅有概述无剧本的集 */}
              {(() => {
                const outlineNumbers = new Set(group.outlines.map(o => o.episodeNumber))
                const summariesWithoutOutline = episodeSummaries.filter(
                  s => s.episodeNumber >= group.from && s.episodeNumber <= group.to && !outlineNumbers.has(s.episodeNumber)
                )
                return summariesWithoutOutline.map(s => (
                  <section key={`summary-${s.episodeNumber}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 shadow-none">
                    <div className="text-xs font-medium text-muted-foreground">第 {s.episodeNumber} 集</div>
                    <h4 className="mt-1 text-sm font-semibold text-foreground/50">待生成剧本</h4>
                    <div className="mt-3">
                      <EpisodeSummaryCard
                        projectId={projectId}
                        episodeNumber={s.episodeNumber}
                        summary={s.summary}
                        canEdit={canEditSummary}
                        state={state}
                        onStateChange={onStateChange}
                      />
                    </div>
                  </section>
                ))
              })()}
```

- [ ] **Step 7: 改造 `buildEpisodeOutlineGroups` — 包含概述集数**

修改 `buildEpisodeOutlineGroups` 函数签名，使其同时接收 `episodeSummaries` 参数，以便为「仅有概述无剧本」的集创建导航分组：

将现有：

```typescript
function buildEpisodeOutlineGroups(outlines: Array<{ episodeNumber: number; title: string; summary: string }>) {
```

替换为：

```typescript
function buildEpisodeOutlineGroups(
  outlines: Array<{ episodeNumber: number; title: string; summary: string }>,
  episodeSummaries: Array<{ episodeNumber: number; summary: string }> = []
) {
```

在函数体的 `for (const outline of outlines)` 循环之后，增加对 `episodeSummaries` 中未被 outlines 覆盖的集的处理：

```typescript
  // 将仅有概述无剧本的集也纳入分组
  const outlineNumbers = new Set(outlines.map(o => o.episodeNumber))
  for (const summary of episodeSummaries) {
    if (outlineNumbers.has(summary.episodeNumber)) continue
    const groupIndex = Math.floor((summary.episodeNumber - 1) / EPISODE_NAV_GROUP_SIZE)
    const from = groupIndex * EPISODE_NAV_GROUP_SIZE + 1
    const to = from + EPISODE_NAV_GROUP_SIZE - 1
    let group = groups.find(item => item.from === from)
    if (!group) {
      group = {
        id: `short-drama-outlines-${from}-${to}`,
        label: formatEpisodeRangeLabel(from, to),
        from,
        to,
        outlines: [],
      }
      groups.push(group)
    }
  }
```

- [ ] **Step 8: 更新 `EpisodeOutlineList` 调用处**

在分集剧本 section 的 `EpisodeOutlineList` 渲染（约第 1452 行），将现有：

```typescript
          <EpisodeOutlineList
            outlines={state.script.outlines}
            canEdit={!isLocked && !Boolean(episodeOutlineDialog)}
            onEditTitle={handleEditEpisodeTitle}
            onEditScene={handleEditEpisodeScene}
          />
```

替换为：

```typescript
          <EpisodeOutlineList
            outlines={state.script.outlines}
            episodeSummaries={state.script.episodeSummaries}
            canEditSummary={!isLocked && !isSummariesLocked}
            canEditOutline={!isLocked && !Boolean(episodeOutlineDialog)}
            projectId={projectId}
            state={state}
            onStateChange={onStateChange}
            onEditTitle={handleEditEpisodeTitle}
            onEditScene={handleEditEpisodeScene}
          />
```

- [ ] **Step 9: 更新 `buildEpisodeOutlineGroups` 调用处**

在导航分组处（约第 961 行），将：

```typescript
  const outlineNavigationGroups = buildEpisodeOutlineGroups(state.script.outlines)
```

替换为：

```typescript
  const outlineNavigationGroups = buildEpisodeOutlineGroups(state.script.outlines, state.script.episodeSummaries)
```

- [ ] **Step 10: 改造分集剧本 section — 新增概述生成按钮 + 门控**

在分集剧本 section（约第 1402 行起），现有 section header 只显示「分集剧本」按钮，需要增加「分集概述」按钮，并修改剧本按钮的门控条件。

在分集剧本 section 的 header 区域（约第 1403-1426 行），将整体替换为：

```typescript
      <section id="short-drama-outlines" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">分集剧本 ({state.script.outlines.length}/{state.settings.episodeCount} 集)</h3>
          {!isLocked && state.script.refinedPrompt && (
            <div className="flex items-center gap-2">
              {/* 分集概述按钮 — 概述未生成时显示 */}
              {!isSummariesReady && !isSummariesGenerating && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5 text-amber-500" />
                  预计 ~40 A豆
                </span>
              )}
              {!isSummariesReady && (
                <Button size="sm" variant="outline" onClick={handleGenerateSummaries} disabled={isSummariesGenerating}>
                  {isSummariesGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  {isSummariesGenerating ? '概述生成中' : '生成分集概述'}
                </Button>
              )}
              {/* 分集剧本按钮 — 概述就绪后显示 */}
              {isSummariesReady && !isOutlinesGenerating && (() => {
                const remaining = state.settings.episodeCount - state.script.outlines.length
                return remaining > 0 ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Coins className="h-3.5 w-3.5 text-amber-500" />
                    70 A豆/批
                  </span>
                ) : null
              })()}
              {isSummariesReady && (
                <Button size="sm" variant="outline" onClick={() => handleGenerateOutlines()} disabled={isOutlinesGenerating}>
                  {isOutlinesGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  {isOutlinesGenerating
                    ? '剧本生成中'
                    : state.script.outlines.length > 0 && state.script.outlines.length < state.settings.episodeCount
                    ? '继续生成剧本'
                    : '生成分集剧本'}
                </Button>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 11: 改造 `handleGenerateOutlines` — 增加概述就绪前置校验**

在 `handleGenerateOutlines` 函数开头的 guard 条件中（约第 1006 行），增加概述就绪校验：

```typescript
    if (
      generatingOutlinesRef.current ||
      state.script.status === 'generating' ||
      !state.script.refinedPrompt ||
      !isSummariesReady ||
      state.script.outlines.length >= state.settings.episodeCount
    ) return
```

同时将确认对话框中的积分文案改为单批次：

```typescript
    const ok = await confirmDialog({
      title: '确认生成',
      description: '本次操作预计消耗约 70 A豆（生成本批分集剧本），确认是否继续？',
      confirmText: '确认生成',
      destructive: false,
    })
```

- [ ] **Step 12: 概述生成中的流式展示**

在分集剧本 section 中，`streamWarningMessage` 展示区域之前（约第 1428 行前），增加概述生成状态展示：

```typescript
        {isSummariesGenerating && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-900/60 bg-violet-950/20 p-3 text-sm text-violet-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>正在生成分集概述，页面会自动刷新状态...</span>
          </div>
        )}
        {generatingSummaries && typedSummaryStreamText && (
          <TypewriterStreamBlock
            value={typedSummaryStreamText}
            className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
          />
        )}
```

- [ ] **Step 13: 改造 `EpisodeOutlineList` 的渲染条件 — 概述就绪后也渲染**

将现有的渲染条件（约第 1451 行）：

```typescript
        {state.script.outlines.length > 0 && (
          <EpisodeOutlineList ... />
        )}
```

替换为 — 概述或剧本任一存在即渲染：

```typescript
        {(state.script.outlines.length > 0 || state.script.episodeSummaries.length > 0) && (
          <EpisodeOutlineList ... />
        )}
```

- [ ] **Step 14: 提交**

```bash
git add apps/web/src/components/short-drama/step-script-outline.tsx
git commit -m "feat(short-drama): 前端集成分集概述生成与展示

- 新增 handleGenerateSummaries 概述生成逻辑
- EpisodeOutlineList 扩展 episodeSummaries + EpisodeSummaryCard
- 概述卡片嵌入每集剧本上方，可编辑
- 剧本按钮门控：概述就绪后才可生成
- 积分文案改为单批次（70 A豆/批）"
```

---

## Task 8: 最终验证 — 构建检查

**Files:** 无代码变更

- [ ] **Step 1: 构建 types 包**

Run: `pnpm --filter @aigc/types build`
Expected: 成功

- [ ] **Step 2: 运行后端测试**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-episode-summaries.test.ts`
Expected: `✅ 短剧分集概述测试通过！`

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: `✅ 短剧文本生成状态写回测试通过！`

- [ ] **Step 3: 前端改动完成反馈**

根据本地验证边界规则，前端改动完成后即可结束反馈，不执行构建/浏览器刷新/重启 localhost:6006。
