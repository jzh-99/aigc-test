# 短剧分集概述（故事脉络）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在短剧剧本步骤中新增「分集概述」生成流程，一次性全量产出所有 N 集的 ~100 字剧情概述作为故事蓝图，分集剧本生成时注入故事脉络杜绝剧情冲突。

**Architecture:** 类型层新增 `ShortDramaEpisodeRecap` 接口与 `episodeRecaps`/`episodeRecapStatus` 状态字段；后端新增概述生成路由 `post-episode-recaps.ts`，修改 `post-episode-outlines.ts` 加入门控和故事脉络注入；前端 API 层新增调用函数，`step-script-outline.tsx` 中每集剧本上方嵌入概述卡片。

**Tech Stack:** TypeScript, Fastify 4, Next.js 14, React 18, Kysely, BullMQ/Redis, Qwen API (dashscope)

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/types/src/short-drama.ts` | 新增 `ShortDramaEpisodeRecap` 接口、状态字段、normalize 默认值、辅助函数 |
| 修改 | `apps/api/src/routes/short-drama/_text-generation.ts` | 新增 `applyShortDramaEpisodeRecapsResult`、`parseEpisodeRecapBatch` |
| 修改 | `apps/api/src/routes/short-drama/_script-source.ts` | 新增 `buildShortDramaEpisodeRecapsPrompts`、`buildShortDramaStoryLineage` |
| 创建 | `apps/api/src/routes/short-drama/post-episode-recaps.ts` | 概述生成路由（SSE 流式） |
| 修改 | `apps/api/src/routes/short-drama/post-episode-outlines.ts` | 门控 + 单批次 + 故事脉络注入 |
| 修改 | `apps/api/src/__tests__/short-drama-text-generation-state.test.ts` | 概述相关单元测试 |
| 修改 | `apps/web/src/lib/short-drama/api.ts` | 新增 `generateShortDramaEpisodeRecaps` |
| 创建 | `apps/web/src/components/short-drama/episode-recap-card.tsx` | 概述卡片子组件 |
| 修改 | `apps/web/src/components/short-drama/step-script-outline.tsx` | 集成概述 UI、修改剧本生成逻辑 |

---

### Task 1: 类型层 — 新增 ShortDramaEpisodeRecap 接口与状态字段

**Files:**
- Modify: `packages/types/src/short-drama.ts`

- [ ] **Step 1: 在 `ShortDramaEpisodeOutline` 接口之后新增 `ShortDramaEpisodeRecap` 接口**

在 `short-drama.ts` 的 `ShortDramaEpisodeOutline` 接口之后（约第 73 行）添加：

```typescript
/** 单集剧情概述，作为故事脉络与剧本生成的固定蓝图 */
export interface ShortDramaEpisodeRecap {
  episodeNumber: number
  /** 该集约 100 字的剧情概述 */
  recap: string
}
```

- [ ] **Step 2: 在 `ShortDramaState.script` 中新增 `episodeRecaps` 和 `episodeRecapStatus` 字段**

在 `short-drama.ts` 的 `ShortDramaState` 接口 `script` 块中，`refinedPrompt` 之后、`outlines` 之前添加两个字段：

```typescript
  script: {
    source: ShortDramaScriptSource
    originalPrompt: string
    originalScript: string
    refinedPrompt: string | null
    episodeRecaps: ShortDramaEpisodeRecap[]       // 新增：全量分集概述
    episodeRecapStatus: ShortDramaGenerationStatus // 新增：概述生成状态
    outlines: ShortDramaEpisodeOutline[]
    status: ShortDramaGenerationStatus
  }
```

- [ ] **Step 3: 更新 `makeDefaultShortDramaState` — 添加新字段默认值**

在 `makeDefaultShortDramaState` 函数的 `script` 对象中，`refinedPrompt` 之后添加：

```typescript
    script: {
      source: 'idea',
      originalPrompt: params.prompt,
      originalScript: '',
      refinedPrompt: null,
      episodeRecaps: [],            // 新增
      episodeRecapStatus: 'idle',   // 新增
      outlines: [],
      status: 'idle',
    },
```

- [ ] **Step 4: 更新 `makeUploadedShortDramaState` — 添加新字段默认值**

在 `makeUploadedShortDramaState` 函数的 `script` 对象中，`refinedPrompt` 之后添加：

```typescript
    script: {
      source: 'upload',
      originalPrompt: '',
      originalScript: params.originalScript,
      refinedPrompt: null,
      episodeRecaps: [],            // 新增
      episodeRecapStatus: 'idle',   // 新增
      outlines: [],
      status: 'idle',
    },
```

- [ ] **Step 5: 更新 `normalizeShortDramaState` — 添加新字段默认值与向后兼容**

在 `normalizeShortDramaState` 函数的 `script` 块中，`refinedPrompt` 之后添加：

```typescript
    script: {
      source: partial.script?.source ?? 'idea',
      originalPrompt: partial.script?.originalPrompt ?? '',
      originalScript: partial.script?.originalScript ?? '',
      refinedPrompt: partial.script?.refinedPrompt ?? null,
      episodeRecaps: (partial.script?.episodeRecaps ?? []) as ShortDramaEpisodeRecap[],        // 新增
      episodeRecapStatus: partial.script?.episodeRecapStatus ?? 'idle' as ShortDramaGenerationStatus, // 新增
      outlines,
      status: partial.script?.status ?? 'idle',
    },
```

注意：旧项目 JSON 无 `episodeRecaps` / `episodeRecapStatus` 时，`normalize` 读出为 `[]` / `'idle'`，表现为「未生成概述」。

- [ ] **Step 6: 新增辅助函数 `isShortDramaEpisodeRecapsReady`**

在 `canEnterShortDramaStep` 函数之后添加：

```typescript
/**
 * 判断分集概述是否已就绪（数量 >= 设定集数）。
 * 概述就绪是生成分集剧本的前置条件。
 */
export function isShortDramaEpisodeRecapsReady(state: ShortDramaState): boolean {
  return state.script.episodeRecaps.length >= state.settings.episodeCount
}
```

- [ ] **Step 7: 构建 types 包**

Run: `pnpm --filter @aigc/types build`
Expected: 构建成功，无类型错误

- [ ] **Step 8: 提交**

```bash
git add packages/types/src/short-drama.ts
git commit -m "feat(short-drama): 新增 ShortDramaEpisodeRecap 接口与状态字段

- 新增 ShortDramaEpisodeRecap 接口（episodeNumber, recap）
- ShortDramaState.script 增加 episodeRecaps / episodeRecapStatus
- makeDefault / makeUploaded / normalize 补齐默认值
- 新增 isShortDramaEpisodeRecapsReady 辅助函数"
```

---

### Task 2: 测试 — applyShortDramaEpisodeRecapsResult 与 normalize 向后兼容

**Files:**
- Modify: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`

- [ ] **Step 1: 在测试文件中添加概述相关 import**

在文件顶部的 import 块中，从 `_text-generation.js` 的 import 中增加 `applyShortDramaEpisodeRecapsResult`：

```typescript
import {
  applyShortDramaAssetPromptsBatchResult,
  applyShortDramaEpisodeOutlinesBatchResult,
  applyShortDramaEpisodeOutlinesResult,
  applyShortDramaEpisodeRecapsResult,
  applyShortDramaScriptSummaryResult,
  buildShortDramaOutlineBatches,
  extractQwenStreamDeltaText,
} from '../routes/short-drama/_text-generation.js'
```

- [ ] **Step 2: 在测试文件末尾（`✅` 行之前）添加概述测试**

```typescript
console.log('\n测试分集概述生成状态写回...')

const recapState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
recapState.script.refinedPrompt = '一个普通外卖员意外获得超能力。'

applyShortDramaEpisodeRecapsResult(recapState, [
  { episodeNumber: 1, recap: '外卖员林晚在暴雨中送餐，被雷击中后觉醒念力。' },
  { episodeNumber: 2, recap: '林晚用念力救下被困电梯的邻居，被神秘组织盯上。' },
  { episodeNumber: 3, recap: '神秘组织设局试探林晚，他在危机中选择守护街区。' },
])

assert.equal(recapState.script.episodeRecaps.length, 3)
assert.equal(recapState.script.episodeRecapStatus, 'completed')
assert.equal(recapState.script.episodeRecaps[0]?.recap, '外卖员林晚在暴雨中送餐，被雷击中后觉醒念力。')
assert.equal(recapState.script.episodeRecaps[2]?.episodeNumber, 3)
// 概述生成不改 script.status
assert.equal(recapState.script.status, 'idle')
console.log('✓ 分集概述生成结果写回 episodeRecaps 和 episodeRecapStatus')

console.log('\n测试 normalize 对无新字段的旧 JSON 向后兼容...')

const oldJson = normalizeShortDramaState({
  script: {
    source: 'idea',
    refinedPrompt: '旧摘要',
    outlines: [],
    status: 'completed',
  },
  settings: { style: '真人都市', aspectRatio: '9:16', episodeCount: 5 },
})

assert.equal(oldJson.script.episodeRecaps.length, 0)
assert.equal(oldJson.script.episodeRecapStatus, 'idle')
console.log('✓ 旧 JSON 无 episodeRecaps/episodeRecapStatus 时 normalize 补默认值')
```

- [ ] **Step 3: 运行测试验证失败（函数尚未实现）**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: FAIL — `applyShortDramaEpisodeRecapsResult` is not exported

---

### Task 3: 实现 — applyShortDramaEpisodeRecapsResult

**Files:**
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`

- [ ] **Step 1: 在 `applyShortDramaScriptSummaryResult` 函数之后添加**

```typescript
/**
 * 将分集概述生成结果写回短剧状态。
 * 仅更新 episodeRecaps 和 episodeRecapStatus，不改 script.status（后者属摘要/剧本流程）。
 */
export function applyShortDramaEpisodeRecapsResult(
  state: ShortDramaState,
  recaps: Array<{ episodeNumber: number; recap: string }>
): void {
  state.script.episodeRecaps = recaps.sort(
    (a, b) => a.episodeNumber - b.episodeNumber
  )
  state.script.episodeRecapStatus = 'completed'
}
```

- [ ] **Step 2: 运行测试验证通过**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: PASS — 包括新增的概述测试和原有测试

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts
git commit -m "feat(short-drama): 实现 applyShortDramaEpisodeRecapsResult 与测试"
```

---

### Task 4: 测试 + 实现 — parseEpisodeRecapBatch

**Files:**
- Modify: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts`
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`

- [ ] **Step 1: 在测试文件中添加 parseEpisodeRecapBatch import**

在 import 块中增加 `parseEpisodeRecapBatch`：

```typescript
import {
  applyShortDramaAssetPromptsBatchResult,
  applyShortDramaEpisodeOutlinesBatchResult,
  applyShortDramaEpisodeOutlinesResult,
  applyShortDramaEpisodeRecapsResult,
  applyShortDramaScriptSummaryResult,
  buildShortDramaOutlineBatches,
  extractQwenStreamDeltaText,
  parseEpisodeRecapBatch,
} from '../routes/short-drama/_text-generation.js'
```

- [ ] **Step 2: 在概述测试之后添加解析测试**

```typescript
console.log('\n测试 parseEpisodeRecapBatch...')

const recapsFromAi = parseEpisodeRecapBatch(
  JSON.stringify([
    { episodeNumber: 1, recap: '第一集概述' },
    { episodeNumber: 2, recap: '第二集概述' },
    { episodeNumber: 3, recap: '第三集概述' },
  ]),
  3
)

assert.equal(recapsFromAi.length, 3)
assert.equal(recapsFromAi[0]?.episodeNumber, 1)
assert.equal(recapsFromAi[0]?.recap, '第一集概述')
assert.equal(recapsFromAi[2]?.recap, '第三集概述')
console.log('✓ 可以从 AI 返回的 JSON 数组解析分集概述')

const recapsFromObject = parseEpisodeRecapBatch(
  JSON.stringify({
    recaps: [
      { episodeNumber: 1, recap: '对象包裹的第一集' },
      { episodeNumber: 2, recap: '对象包裹的第二集' },
    ],
  }),
  2
)

assert.equal(recapsFromObject.length, 2)
assert.equal(recapsFromObject[0]?.recap, '对象包裹的第一集')
console.log('✓ 可以从 AI 返回的 JSON 对象（含 recaps 键）解析分集概述')

// 数量不匹配时抛错
try {
  parseEpisodeRecapBatch(
    JSON.stringify([{ episodeNumber: 1, recap: '只有一集' }]),
    3
  )
  assert.fail('应该抛错')
} catch (err) {
  assert.ok(err instanceof Error)
  assert.ok(err.message.includes('3'))
}
console.log('✓ 概述数量不匹配时抛错')
```

- [ ] **Step 3: 运行测试验证失败**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: FAIL — `parseEpisodeRecapBatch` is not exported

- [ ] **Step 4: 在 `_text-generation.ts` 中实现 `parseEpisodeRecapBatch`**

在 `parseAndValidateJson` 函数之后添加：

```typescript
/**
 * 从 AI 返回的文本中解析分集概述数组。
 * 支持两种格式：纯 JSON 数组，或包含 recaps/episodes 键的 JSON 对象。
 */
export function parseEpisodeRecapBatch(
  aiResponse: string,
  episodeCount: number
): Array<{ episodeNumber: number; recap: string }> {
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('未找到有效的 JSON')
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown
  let items: unknown

  if (Array.isArray(parsed)) {
    items = parsed
  } else if (typeof parsed === 'object' && parsed !== null) {
    const maybeItems = (parsed as { recaps?: unknown; episodes?: unknown }).recaps
      ?? (parsed as { recaps?: unknown; episodes?: unknown }).episodes
    if (Array.isArray(maybeItems)) {
      items = maybeItems
    } else {
      throw new Error('未找到 recaps 或 episodes 数组')
    }
  } else {
    throw new Error('未找到有效的数组')
  }

  if (!Array.isArray(items) || items.length !== episodeCount) {
    throw new Error(`AI 返回的概述数量不正确，期望 ${episodeCount} 集，实际 ${Array.isArray(items) ? items.length : 0} 集`)
  }

  return items.map((item, index) => {
    const ep = item as Record<string, unknown>
    if (typeof ep.episodeNumber !== 'number' || typeof ep.recap !== 'string') {
      throw new Error(`第 ${index + 1} 条概述的字段格式错误，需要 episodeNumber(number) 和 recap(string)`)
    }
    return {
      episodeNumber: ep.episodeNumber,
      recap: ep.recap,
    }
  })
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts
git commit -m "feat(short-drama): 实现 parseEpisodeRecapBatch 与测试"
```

---

### Task 5: 实现 — buildShortDramaEpisodeRecapsPrompts 与 buildShortDramaStoryLineage

**Files:**
- Modify: `apps/api/src/routes/short-drama/_script-source.ts`

- [ ] **Step 1: 在 `buildShortDramaScriptSummaryPrompts` 函数之后添加两个新函数**

```typescript
/**
 * 构建分集概述生成的 system/user prompt。
 * 一次性为全部 N 集各生成约 100 字的剧情概述，作为故事蓝图。
 */
export function buildShortDramaEpisodeRecapsPrompts(state: ShortDramaState): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = [
    '你是专业短剧编剧，擅长规划系列短剧的完整故事脉络。',
    `请根据剧本摘要为全部 ${state.settings.episodeCount} 集各生成一段约 100 字的剧情概述。`,
    '概述必须形成连贯的故事脉络，覆盖起承转合、人物关系变化与阶段性钩子。',
    '集与集之间要有因果递进，不能互相矛盾；前一集的结尾必须为后一集的开端提供动机或悬念。',
    '每集概述 80-120 字，必须包含：该集核心事件、人物关系推进、结尾钩子。',
    '只输出 JSON 数组，每个元素包含 episodeNumber 和 recap 字段，不要输出 markdown、代码块或额外解释。',
    `项目视觉风格是"${state.settings.style}"，概述中的场景和氛围应与此风格一致。`,
  ].join('\n')

  const userPrompt = [
    `剧本摘要：${state.script.refinedPrompt}`,
    '',
    `项目设置：`,
    `- 集数：${state.settings.episodeCount}`,
    `- 视觉风格：${state.settings.style}`,
    `- 画面比例：${state.settings.aspectRatio}`,
    '',
    `请为全部 ${state.settings.episodeCount} 集生成剧情概述，返回 JSON 数组：`,
    '[',
    '  { "episodeNumber": 1, "recap": "第1集约100字剧情概述..." },',
    '  { "episodeNumber": 2, "recap": "第2集约100字剧情概述..." },',
    '  ...',
    ']',
    '',
    '要求：',
    '- 每集概述 80-120 字，包含核心事件、人物关系推进和结尾钩子。',
    '- 第 N 集概述必须承接第 N-1 集结尾，形成因果递进。',
    `- 共 ${state.settings.episodeCount} 集，episodeNumber 从 1 到 ${state.settings.episodeCount}。`,
    '- 整体脉络必须覆盖起承转合：前期建立世界观和冲突，中期升级矛盾和反转，后期走向高潮和收束。',
  ].join('\n')

  return { systemPrompt, userPrompt }
}

/**
 * 构建故事脉络文本，用于注入分集剧本生成的提示词。
 * 取第 1 集到第 to 集的概述，保证 AI 看到完整蓝图至当前生成点。
 */
export function buildShortDramaStoryLineage(state: ShortDramaState, to: number): string {
  const recaps = state.script.episodeRecaps
    .filter(r => r.episodeNumber <= to)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)

  if (recaps.length === 0) return ''

  const lineageLines = recaps.map(r => `第 ${r.episodeNumber} 集：${r.recap}`)
  return [
    '已确定的分集剧情脉络（请严格遵循，保持人物、伏笔、反转前后一致）：',
    ...lineageLines,
  ].join('\n')
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/routes/short-drama/_script-source.ts
git commit -m "feat(short-drama): 实现 buildShortDramaEpisodeRecapsPrompts 与 buildShortDramaStoryLineage"
```

---

### Task 6: 创建概述生成路由 — post-episode-recaps.ts

**Files:**
- Create: `apps/api/src/routes/short-drama/post-episode-recaps.ts`

- [ ] **Step 1: 创建路由文件**

结构对齐 `post-script-summary.ts`，关键差异：
- 前置校验：`refinedPrompt` 必须存在，`episodeRecaps` 未生成
- Redis 锁 key: `lock:short-drama:${projectId}:episode-recaps`
- 预冻结积分: 40 A豆
- 状态字段: `episodeRecapStatus`（不改 `script.status`）
- AI 调用: `buildShortDramaEpisodeRecapsPrompts` + `callQwenForTextStream` maxTokens=8000
- 解析: `parseEpisodeRecapBatch`
- 写回: `applyShortDramaEpisodeRecapsResult`
- 失败时: `episodeRecapStatus = 'failed'`，`script.status = 'failed'`，`markShortDramaProjectFailed`

```typescript
import type { FastifyPluginAsync } from 'fastify'
import { assertShortDramaProjectAccess } from './_shared.js'
import {
  callQwenForTextStream,
  saveShortDramaProjectState,
  saveShortDramaStateAndSettleCredits,
  safeRefundCredits,
  calculateTextGenerationCredits,
  applyShortDramaEpisodeRecapsResult,
  parseEpisodeRecapBatch,
  markShortDramaProjectFailed,
} from './_text-generation.js'
import { freezeCredits } from '../../services/credit.js'
import { acquireRedisLock, releaseRedisLock, type RedisLockHandle } from '../../lib/distributed-lock.js'
import { buildShortDramaEpisodeRecapsPrompts } from './_script-source.js'
import { createShortDramaSSESession } from './_sse.js'

// 概述生成预冻结积分（按实际输入+输出字符结算，预冻结仅上限）
const ESTIMATED_CREDITS = 40
const EPISODE_RECAP_MAX_TOKENS = 8000

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
  }>('/short-drama/projects/:id/script/episode-recaps', async (request, reply) => {
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

    // 前置校验：概述未生成
    if (state.script.episodeRecaps.length >= state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集概述已生成' },
      })
    }

    let generationLock: RedisLockHandle | null = null
    generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-recaps`)
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

    try {
      state.script.episodeRecapStatus = 'generating'
      await saveShortDramaProjectState(projectId, state, 0)
    } catch (error) {
      await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成状态保存失败')
      await releaseRedisLock(app.redis, generationLock)
      app.log.error({ error, projectId }, '短剧分集概述生成状态保存失败')
      return reply.status(500).send({
        error: { code: 'DATABASE_ERROR', message: '保存生成状态失败，请稍后重试' },
      })
    }

    const { systemPrompt, userPrompt } = buildShortDramaEpisodeRecapsPrompts(state)

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

      const aiResponse = await callQwenForTextStream(systemPrompt, userPrompt, EPISODE_RECAP_MAX_TOKENS, {
        onChunk: (text) => sendEvent('chunk', { text }),
        onPing: sendPing,
        externalSignal: clientSignal,
        audit: {
          userId,
          teamId,
          workspaceId: project.workspace_id,
          module: 'short_drama',
          provider: 'qwen',
          operation: 'script.episode_recaps',
          endpoint: '/chat/completions',
        },
      })

      const episodeCount = state.settings.episodeCount
      const recaps = parseEpisodeRecapBatch(aiResponse, episodeCount)
      const actualCredits = calculateTextGenerationCredits(systemPrompt + userPrompt, aiResponse)
      applyShortDramaEpisodeRecapsResult(state, recaps)

      const settledCredits = (await saveShortDramaStateAndSettleCredits({
        projectId,
        state,
        actualCredits,
        estimatedCredits: ESTIMATED_CREDITS,
        creditAccountId,
        userId,
        teamId,
        // 概述完成不改项目顶层状态，维持 summary_ready
      })).settledCredits

      persisted = true

      sendEvent('done', {
        success: true,
        episodeRecaps: state.script.episodeRecaps,
        credits: settledCredits,
        state,
      })
    } catch (error) {
      if (persisted) {
        app.log.warn({ error, projectId }, '短剧分集概述已生成成功，但向客户端推送结果失败')
      } else {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, '概述生成失败')
        state.script.episodeRecapStatus = 'failed'
        state.script.status = 'failed'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ saveError, projectId }, '短剧分集概述失败状态保存失败')
        })
        app.log.error({ error, projectId }, '短剧分集概述流式生成失败')
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

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/routes/short-drama/post-episode-recaps.ts
git commit -m "feat(short-drama): 新增分集概述生成路由 POST episode-recaps"
```

---

### Task 7: 修改分集剧本路由 — 门控 + 单批次 + 故事脉络注入

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts`

- [ ] **Step 1: 添加 import**

在文件顶部 import 块中，从 `_script-source.js` 增加 `buildShortDramaStoryLineage`：

```typescript
import { buildShortDramaStoryLineage } from './_script-source.js'
```

- [ ] **Step 2: 添加概述就绪门控**

在 `if (state.script.outlines.length >= state.settings.episodeCount)` 校验之后（约第 123 行之后），添加概述就绪校验：

```typescript
    // 概述就绪校验：必须先生成全部分集概述才能生成剧本
    if (state.script.episodeRecaps.length < state.settings.episodeCount) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请先生成并锁定全部分集概述' },
      })
    }
```

- [ ] **Step 3: 改为单批次 — 删除多批循环，只取第一个 batch**

将现有的 `const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)` 及后续的 `for (const batch of batches)` 循环替换为单批次逻辑。

将约第 126-127 行：
```typescript
    const episodeCount = state.settings.episodeCount
    const startEpisode = state.script.outlines.length + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
```

替换为：
```typescript
    const episodeCount = state.settings.episodeCount
    const startEpisode = state.script.outlines.length + 1
    const batches = buildShortDramaOutlineBatches(startEpisode, episodeCount)
    const batch = batches[0]
    if (!batch) {
      return reply.status(400).send({
        error: { code: 'ALREADY_GENERATED', message: '分集剧本已生成' },
      })
    }
```

- [ ] **Step 4: 将 `for (const batch of batches)` 循环体改为单次执行**

删除 `for (const batch of batches) {` 和对应的闭合 `}`（约第 167 行和第 273 行），将循环体内容直接作为单次逻辑。同时删除 `stoppedByBalance` / `warningMessage` / `totalCredits` 相关的多批次累加逻辑。

将第 161-300 行的多批循环替换为以下单批次逻辑：

```typescript
    let completedCount = state.script.outlines.length

    try {
      let creditAccountId: string

      try {
        const freezeResult = await freezeCredits(teamId, userId, ESTIMATED_CREDITS, '短剧分集大纲冻结')
        creditAccountId = freezeResult.creditAccountId
      } catch (error) {
        await releaseRedisLock(app.redis, generationLock)
        const message = error instanceof Error ? error.message : 'A豆余额不足'
        return reply.status(402).send({
          error: { code: 'INSUFFICIENT_CREDITS', message },
        })
      }

      sendEvent('progress', {
        message: `开始生成第 ${batch.from}-${batch.to} 集剧本`,
        from: batch.from,
        to: batch.to,
        completedCount,
        totalCount: episodeCount,
      })

      // 构建故事脉络注入
      const storyLineage = buildShortDramaStoryLineage(state, batch.to)
      const storyLineageSection = storyLineage
        ? `${storyLineage}\n\n其中第 ${batch.from}-${batch.to} 集为本次需要生成分场剧本的集数，请依据上述脉络展开。`
        : ''

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

      const userPrompt = `${storyLineageSection}${storyLineageSection ? '\n\n' : ''}剧本摘要：${state.script.refinedPrompt}\n\n项目视觉风格：${state.settings.style}\n画面比例：${state.settings.aspectRatio}\n\n请只生成第 ${batch.from}-${batch.to} 集，每集包含：\n- episodeNumber: 集数（${batch.from}-${batch.to}）\n- title: 集标题\n- logline: 一句话梗概（20-30字）\n- synopsis: 分场剧本正文，必须类似下面格式：\n### 场1-1\n日 内 旧教室\n【戏剧功能：开场钩子，建立拆迁压力和主角困境】\n出场人物：林微\n【场记锚点：场开始时林微站在教室门口，旧课桌堆在画面右侧；场结束时她走到第一排课桌旁，手按在刻字桌面上】\n【字幕：2024年，南方县城老中学，即将拆除】\n△ 阳光透过布满灰尘的窗户，墙上一个刺眼的红色"拆"字随风晃动。\n角色名（语气）：对白内容。\n角色名（os）：内心独白。\n\n### 场1-2\n夜 外 校园走廊\n【戏剧功能：冲突升级】\n出场人物：角色A、角色B\n【场记锚点：角色A靠近走廊左侧窗台，角色B挡在楼梯口，手机始终握在角色A右手】\n△ 动作与画面调度。\n角色A（压低声音）：对白内容。\n- characters: 该集出现的主要角色列表（字符串数组）\n- scenes: 该集主要场景列表（字符串数组）\n- hook: 悬念或钩子（吸引观众继续观看的要素，50字以内）\n\n长度与节奏要求：\n- 每集 synopsis 必须能支撑约 2 分钟成片，不要生成只能拍几十秒的短概要。\n- 每集整体分成 3-5 个场景，避免 8 个以上碎场；每个场景要有清晰戏剧功能，例如"开场钩子、冲突升级、信息反转、主动选择、结尾钩子"。\n- 每集至少写出 12-16 个清晰的动作/对白节点，方便后续按场内节拍拆成 10-12 个视频片段。\n- 每个场景至少包含 3-6 条"△"动作描写或对白/OS/VO，不要只有一两句概述。\n- 场号按"场${batch.from}-1、场${batch.from}-2..."书写；每场第一行写"日/夜 内/外 地点"，第二行写"【戏剧功能：...】"，第三行写"出场人物：..."，第四行写"【场记锚点：...】"。\n- 多用画面动作和人物对白推进剧情，少写概述性总结。\n- 动作描写要能被摄影和演员执行：写清人物从哪里来、看向哪里、哪只手拿着什么、动作结束停在哪里。\n- 视觉风格"${state.settings.style}"必须体现在场景选择、表演克制程度、镜头节奏、色彩和灯光上，不要只写剧情。\n- 每集要形成一个小冲突和结尾钩子。`

      try {
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

        let settledCredits: number
        try {
          settledCredits = (await saveShortDramaStateAndSettleCredits({
            projectId,
            state,
            actualCredits,
            estimatedCredits: ESTIMATED_CREDITS,
            creditAccountId,
            userId,
            teamId,
            status: state.script.outlines.length >= episodeCount ? 'outline_ready' : undefined,
          })).settledCredits
        } catch (error) {
          Object.assign(state, previousState)
          throw error
        }
        completedCount = state.script.outlines.length

        sendEvent('progress', {
          message: `第 ${batch.from}-${batch.to} 集剧本生成完成`,
          from: batch.from,
          to: batch.to,
          completedCount,
          totalCount: episodeCount,
        })

        sendEvent('done', {
          success: true,
          partial: state.script.outlines.length < episodeCount,
          outlines: state.script.outlines,
          credits: settledCredits,
          state,
        })
      } catch (error) {
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集剧本生成失败`)
        app.log.error({ error, projectId, batch }, '短剧分集大纲批次生成失败')
        state.script.status = 'failed'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
          app.log.error({ error: saveError, projectId }, '短剧分集大纲失败状态保存失败')
        })

        sendEvent('error', {
          code: 'AI_ERROR',
          message: error instanceof Error ? error.message : 'AI 生成失败，请稍后重试',
          completedCount,
          totalCount: episodeCount,
        })
      }
    } finally {
      await releaseRedisLock(app.redis, generationLock)
      session.end()
    }
```

- [ ] **Step 5: 删除不再需要的 `buildShortDramaOutlineBatches` import（如果不再直接使用）**

检查：`buildShortDramaOutlineBatches` 仍在使用（用于计算 `batches`），保留 import。但 `SHORT_DRAMA_OUTLINE_BATCH_SIZE` 不再直接使用，可以检查是否还有其他引用。保留不变即可。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/short-drama/post-episode-outlines.ts
git commit -m "feat(short-drama): 分集剧本路由增加概述门控、改为单批次、注入故事脉络

- 前置校验：概述未就绪时返回 VALIDATION_ERROR
- 移除多批循环，改为每次调用只生成一批（5 集）
- prompt 注入 buildShortDramaStoryLineage 保证剧情一致"
```

---

### Task 8: 运行全部后端测试

- [ ] **Step 1: 运行测试**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: 全部 PASS，包括原有测试和新增的概述/解析测试

- [ ] **Step 2: 如果测试失败，修复后重跑**

---

### Task 9: 前端 API 层 — 新增 generateShortDramaEpisodeRecaps

**Files:**
- Modify: `apps/web/src/lib/short-drama/api.ts`

- [ ] **Step 1: 在 `ShortDramaStreamResult` 接口中添加 `episodeRecaps` 字段**

在 `outlines` 之后添加：

```typescript
export interface ShortDramaStreamResult {
  success: boolean
  partial?: boolean
  warning?: string
  title?: string
  summary?: string
  outlines?: ShortDramaState['script']['outlines']
  episodeRecaps?: ShortDramaState['script']['episodeRecaps']  // 新增
  assets?: ShortDramaState['assets']['items']
  credits?: number
  completedCount?: number
  totalCount?: number
  remainingCount?: number
  state: ShortDramaState
}
```

- [ ] **Step 2: 在 `generateShortDramaEpisodeOutlines` 函数之后添加新函数**

```typescript
export function generateShortDramaEpisodeRecaps(
  projectId: string,
  options: ShortDramaStreamOptions = {}
): Promise<ShortDramaStreamResult> {
  return postShortDramaSSE<ShortDramaStreamResult>(
    `/short-drama/projects/${projectId}/script/episode-recaps`,
    options,
    projectId,
    (project) => project.state.script.episodeRecapStatus === 'generating',
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/short-drama/api.ts
git commit -m "feat(short-drama): 前端 API 层新增 generateShortDramaEpisodeRecaps"
```

---

### Task 10: 创建 EpisodeRecapCard 子组件

**Files:**
- Create: `apps/web/src/components/short-drama/episode-recap-card.tsx`

- [ ] **Step 1: 创建组件文件**

```tsx
'use client'

import { Pencil } from 'lucide-react'

interface EpisodeRecapCardProps {
  /** 集数（1-based） */
  episodeNumber: number
  /** 概述文本，约 100 字 */
  recap: string | undefined
  /** 是否可编辑（剧本未生成时可编辑） */
  canEdit: boolean
  /** 编辑回调 */
  onEdit: (episodeNumber: number) => void
  /** 保存回调（编辑后调 saveShortDramaProject 写回） */
  onSave: (episodeNumber: number, recap: string) => void
}

/**
 * 单集概述卡片 — 嵌入每集剧本卡片上方。
 * 概述来自全量预生成（episodeRecaps），剧本来自逐批生成（outlines）。
 */
export function EpisodeRecapCard({
  episodeNumber,
  recap,
  canEdit,
  onEdit,
}: EpisodeRecapCardProps) {
  if (!recap) return null

  return (
    <div className="flex items-start gap-2 rounded-md border border-violet-800/40 bg-violet-950/20 px-3 py-2">
      <div className="flex-1">
        <div className="mb-1 text-[11px] font-medium text-violet-400">剧情概述</div>
        <p className="text-xs leading-5 text-muted-foreground">{recap}</p>
      </div>
      {canEdit && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground/60 transition hover:bg-muted/40 hover:text-foreground"
          onClick={() => onEdit(episodeNumber)}
          aria-label={`编辑第${episodeNumber}集概述`}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/short-drama/episode-recap-card.tsx
git commit -m "feat(short-drama): 新增 EpisodeRecapCard 子组件"
```

---

### Task 11: 修改 step-script-outline.tsx — 集成概述 UI 与剧本生成逻辑

**Files:**
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`

- [ ] **Step 1: 添加 import**

在文件顶部 import 块中：

```typescript
import { generateShortDramaEpisodeRecaps } from '@/lib/short-drama/api'
import { EpisodeRecapCard } from './episode-recap-card'
```

同时在 `generateShortDramaEpisodeOutlines` 的 import 行下方确保新增了 `generateShortDramaEpisodeRecaps`。

- [ ] **Step 2: 添加新状态变量**

在 `const [savingSourceEdit, setSavingSourceEdit] = useState(false)` 之后添加：

```typescript
  const [generatingRecaps, setGeneratingRecaps] = useState(false)
  const [recapStreamText, setRecapStreamText] = useState('')
  const generatingRecapsRef = useRef(false)
```

在 `const typedOutlineStreamText = useTypewriterText(outlineStreamText, generatingOutlines)` 之后添加：

```typescript
  const typedRecapStreamText = useTypewriterText(recapStreamText, generatingRecaps)
```

- [ ] **Step 3: 添加派生状态**

在 `const isOutlinesGenerating = ...` 之后添加：

```typescript
  const isRecapsGenerating =
    generatingRecaps || state.script.episodeRecapStatus === 'generating'
  const hasRecaps = state.script.episodeRecaps.length >= state.settings.episodeCount
  // 隐式锁定：一旦有任何剧本生成，所有概述只读
  const canEditRecaps = !isLocked && state.script.outlines.length === 0
```

- [ ] **Step 4: 添加 handleGenerateRecaps 处理函数**

在 `handleGenerateOutlines` 函数之后添加：

```typescript
  const handleGenerateRecaps = async () => {
    if (
      generatingRecapsRef.current ||
      state.script.episodeRecapStatus === 'generating' ||
      !state.script.refinedPrompt ||
      state.script.episodeRecaps.length >= state.settings.episodeCount
    ) return
    const ok = await confirmDialog({
      title: '确认生成',
      description: '本次操作预计消耗约 40 A豆（生成分集概述），确认是否继续？',
      confirmText: '确认生成',
      destructive: false,
    })
    if (!ok) return
    generatingRecapsRef.current = true
    setGeneratingRecaps(true)
    setRecapStreamText('')
    try {
      await generateShortDramaEpisodeRecaps(projectId, {
        onChunk: text => setRecapStreamText(current => current + text),
        onProgress: progress => setOutlineProgressMessage(progress.message),
      })
      onStateChange()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '生成失败'
      toast.error(translateError(errorMessage))
    } finally {
      generatingRecapsRef.current = false
      setGeneratingRecaps(false)
    }
  }
```

- [ ] **Step 5: 添加 handleEditRecap 处理函数**

在 `handleGenerateRecaps` 之后添加：

```typescript
  const handleEditRecap = async (episodeNumber: number, newRecap: string) => {
    const nextRecaps = state.script.episodeRecaps.map(r =>
      r.episodeNumber === episodeNumber ? { ...r, recap: newRecap } : r
    )
    try {
      await saveShortDramaProject(projectId, {
        state: { ...state, script: { ...state.script, episodeRecaps: nextRecaps } },
      })
      onStateChange()
      toast.success('概述已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }
```

- [ ] **Step 6: 修改 handleGenerateOutlines — 改为单批次积分显示**

将 `handleGenerateOutlines` 中的积分计算部分：

```typescript
    const remaining = state.settings.episodeCount - state.script.outlines.length
    const batches = Math.ceil(remaining / 5)
    const outlineCredits = batches * 70
    const ok = await confirmDialog({
      title: '确认生成',
      description: `本次操作预计消耗约 ${outlineCredits} A豆（生成 ${batches} 批分集剧本），确认是否继续？`,
```

替换为：

```typescript
    const remaining = state.settings.episodeCount - state.script.outlines.length
    const ok = await confirmDialog({
      title: '确认生成',
      description: `本次操作预计消耗约 70 A豆（生成分集剧本），确认是否继续？`,
```

- [ ] **Step 7: 修改 handleGenerateOutlines — 添加概述就绪前置检查**

在 `handleGenerateOutlines` 的 guard 条件中，在 `!state.script.refinedPrompt` 之后添加：

```typescript
    if (
      generatingOutlinesRef.current ||
      state.script.status === 'generating' ||
      !state.script.refinedPrompt ||
      state.script.episodeRecaps.length < state.settings.episodeCount ||  // 新增：概述必须就绪
      state.script.outlines.length >= state.settings.episodeCount
    ) return
```

- [ ] **Step 8: 修改 EpisodeOutlineList — 接受并渲染概述**

修改 `EpisodeOutlineList` 函数签名，添加 `episodeRecaps` 和相关 props：

```typescript
function EpisodeOutlineList({
  outlines,
  episodeRecaps,
  canEdit,
  canEditRecaps,
  onEditTitle,
  onEditScene,
  onEditRecap,
}: {
  outlines: Array<{ episodeNumber: number; title: string; summary: string }>
  episodeRecaps: Array<{ episodeNumber: number; recap: string }>
  canEdit: boolean
  canEditRecaps: boolean
  onEditTitle: (episodeNumber: number) => void
  onEditScene: (episodeNumber: number, sceneIndex: number) => void
  onEditRecap: (episodeNumber: number) => void
}) {
```

在 `EpisodeOutlineList` 内部，`outline.episodeNumber` 标题之后、场景块之前，插入概述卡片：

在 `<h4 className="mt-1 text-sm font-semibold text-foreground">{outline.title}</h4>` 之后、`</div>` (标题区闭合) 之后，`<div className="mt-3 space-y-2">` 之前，添加：

```typescript
                  {(() => {
                    const recap = episodeRecaps.find(r => r.episodeNumber === outline.episodeNumber)
                    return recap ? (
                      <EpisodeRecapCard
                        episodeNumber={outline.episodeNumber}
                        recap={recap.recap}
                        canEdit={canEditRecaps}
                        onEdit={onEditRecap}
                      />
                    ) : null
                  })()}
```

- [ ] **Step 9: 修改分集剧本 section — 添加概述生成按钮和 UI**

在 `<section id="short-drama-outlines"` 和 `</section>` 之间，在现有的剧本生成按钮区域之前，插入概述生成区域。

在 `<section id="short-drama-outlines" className="scroll-mt-24 space-y-2">` 之后，`<div className="flex items-center justify-between">` 之前，插入概述生成区域：

```tsx
        {/* 分集概述区域 */}
        {!isLocked && state.script.refinedPrompt && !hasRecaps && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">分集概述</h3>
              <div className="flex items-center gap-2">
                {!isRecapsGenerating && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Coins className="h-3.5 w-3.5 text-amber-500" />
                    预计 ~40 A豆
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={handleGenerateRecaps} disabled={isRecapsGenerating}>
                  {isRecapsGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  {isRecapsGenerating ? '概述生成中' : '生成分集概述'}
                </Button>
              </div>
            </div>
            {isRecapsGenerating && (
              <div className="flex items-center gap-2 rounded-lg border border-violet-900/60 bg-violet-950/20 p-3 text-sm text-violet-200">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span>正在生成分集概述，页面会自动刷新状态...</span>
              </div>
            )}
            {generatingRecaps && typedRecapStreamText && (
              <TypewriterStreamBlock
                value={typedRecapStreamText}
                className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
              />
            )}
            <p className="text-xs text-muted-foreground">
              一次性生成全部 {state.settings.episodeCount} 集的剧情概述作为故事蓝图，锁定后方可生成分集剧本。
            </p>
          </div>
        )}
```

- [ ] **Step 10: 修改剧本生成按钮 — 显示前提改为「概述已就绪」，积分改为单批**

将分集剧本 section 的按钮区域（约第 1405-1426 行）中的条件 `!isLocked && state.script.refinedPrompt` 改为 `!isLocked && state.script.refinedPrompt && hasRecaps`。

将积分显示区域：

```typescript
{!isOutlinesGenerating && (() => {
  const remaining = state.settings.episodeCount - state.script.outlines.length
  const batches = Math.ceil(remaining / 5)
  return remaining > 0 ? (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Coins className="h-3.5 w-3.5 text-amber-500" />
      预计 {batches} 批 × 70 ≈ {batches * 70} A豆
    </span>
  ) : null
})()}
```

替换为：

```typescript
{!isOutlinesGenerating && state.script.outlines.length < state.settings.episodeCount && (
  <span className="flex items-center gap-1 text-xs text-muted-foreground">
    <Coins className="h-3.5 w-3.5 text-amber-500" />
    预计 ~70 A豆/批
  </span>
)}
```

- [ ] **Step 11: 修改 EpisodeOutlineList 调用处 — 传入新 props**

将 `<EpisodeOutlineList` 调用处（约第 1452-1457 行）：

```tsx
          <EpisodeOutlineList
            outlines={state.script.outlines}
            canEdit={!isLocked && !Boolean(episodeOutlineDialog)}
            onEditTitle={handleEditEpisodeTitle}
            onEditScene={handleEditEpisodeScene}
          />
```

替换为：

```tsx
          <EpisodeOutlineList
            outlines={state.script.outlines}
            episodeRecaps={state.script.episodeRecaps}
            canEdit={!isLocked && !Boolean(episodeOutlineDialog)}
            canEditRecaps={canEditRecaps}
            onEditTitle={handleEditEpisodeTitle}
            onEditScene={handleEditEpisodeScene}
            onEditRecap={(epNum) => {
              const recap = state.script.episodeRecaps.find(r => r.episodeNumber === epNum)
              if (!recap) return
              const newRecap = prompt(`编辑第${epNum}集概述：`, recap.recap)
              if (newRecap !== null && newRecap.trim()) {
                handleEditRecap(epNum, newRecap.trim())
              }
            }}
          />
```

注意：`prompt()` 是浏览器原生对话框，仅作为最小可行实现。后续可替换为 Dialog 组件。

- [ ] **Step 12: 提交**

```bash
git add apps/web/src/components/short-drama/step-script-outline.tsx
git commit -m "feat(short-drama): 前端集成概述 UI、修改剧本生成为单批次

- 新增 handleGenerateRecaps / handleEditRecap
- EpisodeOutlineList 传入 episodeRecaps，每集卡片上方嵌入概述
- 概述生成按钮与流式展示
- 剧本生成按钮前提改为概述就绪，积分改为单批"
```

---

### Task 12: TypeScript 构建检查

- [ ] **Step 1: 构建 types 包**

Run: `pnpm --filter @aigc/types build`
Expected: 成功

- [ ] **Step 2: 检查前端 TypeScript**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 修复任何类型错误（如有）**

根据错误信息逐一修复，确保类型一致性。

---

### Task 13: 更新 state JSON 字段说明文档

**Files:**
- Modify: `docs/superpowers/specs/2026-06-15-short-drama-episode-summary-design.md`

- [ ] **Step 1: 确认 spec 文档中第 5 节「ShortDramaState JSON 字段说明」已包含新增字段说明**

spec 文档中已有 `episodeSummaries` / `episodeSummaryStatus` 的字段说明，但实际实现使用 `episodeRecaps` / `episodeRecapStatus` 命名。需更新 spec 文档中的命名以与实现一致。

将 spec 中所有 `episodeSummaries` 替换为 `episodeRecaps`，`episodeSummaryStatus` 替换为 `episodeRecapStatus`，`ShortDramaEpisodeSummary` 替换为 `ShortDramaEpisodeRecap`，字段 `summary` 替换为 `recap`。

- [ ] **Step 2: 提交**

```bash
git add docs/superpowers/specs/2026-06-15-short-drama-episode-summary-design.md
git commit -m "docs(short-drama): 更新 spec 命名 episodeSummaries → episodeRecaps 以与实现一致"
```

---

## 自审清单

### 1. Spec 覆盖

| Spec 需求 | 对应 Task |
|-----------|-----------|
| 新增 ShortDramaEpisodeSummary/Recap 接口 | Task 1 |
| episodeSummaries/Recaps + episodeSummaryStatus/RecapStatus 状态字段 | Task 1 |
| makeDefault / makeUploaded / normalize 补默认值 | Task 1 |
| 概述生成接口 POST episode-recaps | Task 6 |
| 概述 Prompt 构建 | Task 5 |
| 剧本生成门控（概述就绪才能生成） | Task 7 |
| 剧本生成改为单批次 | Task 7 |
| 剧本生成 prompt 注入故事脉络 | Task 7 |
| 前端 API 层新增调用 | Task 9 |
| 概述展示在每集剧本上方 | Task 10, Task 11 |
| 概述编辑（剧本未生成时可编辑） | Task 10, Task 11 |
| 剧本按钮前提改为概述就绪 | Task 11 |
| 积分文案改为单批 | Task 11 |
| normalize 向后兼容 | Task 2, Task 3 |
| 断线回查谓词 episodeRecapStatus === 'generating' | Task 6 (路由), Task 9 (前端) |
| SSE 协议复用 | Task 6 |
| state JSON 字段说明文档 | Task 13 |

### 2. 占位符扫描

无 TBD / TODO / "implement later" / "fill in details" 等占位符。所有步骤含完整代码。

### 3. 类型一致性

- `ShortDramaEpisodeRecap` 定义于 Task 1，在 Task 3/4/5/6/9/10/11 中引用 — 一致
- `episodeRecaps` / `episodeRecapStatus` 字段名在所有文件中一致使用
- `recap` 字段名（非 `summary`）在所有引用处一致
- `parseEpisodeRecapBatch` 签名：`(aiResponse: string, episodeCount: number)` — 与 Task 6 调用一致
- `buildShortDramaStoryLineage` 签名：`(state, to: number)` — 与 Task 7 调用一致
- `applyShortDramaEpisodeRecapsResult` 签名：`(state, recaps)` — 与 Task 3/6 一致
