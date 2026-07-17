# 分集剧本生成刷新恢复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **项目规则提示：** 本仓库遵循「仅当用户要求时才 commit」。计划中每个 Task 末尾的 commit 步骤，执行时需先与用户确认后再提交。

**Goal:** 分集剧本生成中刷新页面后，前端恢复加载态显示；后端生成行为不变（已支持断连继续），落库后 SWR 自动同步结果。

**Architecture:** 为 outlines 引入独立状态字段 `outlinesStatus`（对齐已验证的 `episodeSummaryStatus` 模式），与语义冲突的 `script.status` 解耦。后端 `callQwenForTextStream` 的断连继续机制（`stallChecker` + 120s 宽限）不动；仅在状态写回处维护新字段。前端读 `outlinesStatus === 'generating'` 恢复 spinner，失败时读 `outlinesErrorMessage` 显示原因 + 重试。

**Tech Stack:** TypeScript ESM、Fastify 4、Next.js 14 (React 18)、`node:assert` 测试、`tsx` 运行测试、pnpm 10 workspace。

**关联设计文档：** `docs/superpowers/specs/2026-06-15-short-drama-outline-refresh-resume-design.md`

---

## 文件结构

| 文件 | 职责 | 操作 |
|---|---|---|
| `packages/types/src/short-drama.ts` | 新增 `outlinesStatus` / `outlinesErrorMessage` 字段 + 默认值 | 修改 |
| `packages/types/src/short-drama.test.ts` | 断言新字段默认值 | 修改 |
| `apps/api/src/routes/short-drama/_text-generation.ts` | `applyShortDramaEpisodeOutlinesBatchResult` 改写新字段 | 修改 |
| `apps/api/src/__tests__/short-drama-text-generation-state.test.ts` | 断言新字段写回语义 | 修改 |
| `apps/api/src/routes/short-drama/post-episode-outlines.ts` | 生成开始/失败时写入新字段 | 修改 |
| `apps/web/src/components/short-drama/step-script-outline.tsx` | 恢复加载态 + 错误回显 + 重试按钮 | 修改 |

---

## Task 1: types 包新增 outlinesStatus / outlinesErrorMessage 字段

**Files:**
- Modify: `packages/types/src/short-drama.ts`（字段定义 ~159-164、`makeDefaultShortDramaState` ~397-398、`makeUploadedShortDramaState` ~448-449、`normalizeShortDramaState` ~479-480）
- Test: `packages/types/src/short-drama.test.ts:152`

- [ ] **Step 1: 写失败测试**

在 `packages/types/src/short-drama.test.ts` 第 152 行 `assert.equal(nestedPartial.script.status, 'idle')` 之后追加：

```ts
assert.equal(nestedPartial.script.outlinesStatus, 'idle')
assert.equal(nestedPartial.script.outlinesErrorMessage, null)
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts`
Expected: FAIL，报 `Cannot read properties of undefined (reading 'outlinesStatus')` 或类似（字段尚未定义）

- [ ] **Step 3: 字段定义**

在 `packages/types/src/short-drama.ts` 的 `script` 字段定义中，把：

```ts
    outlines: ShortDramaEpisodeOutline[]
    status: ShortDramaGenerationStatus
```

改为：

```ts
    outlines: ShortDramaEpisodeOutline[]
    /** 分集剧本批次请求状态（与 script.status 解耦）：generating=请求进行中，completed=本批成功，failed=失败 */
    outlinesStatus: ShortDramaGenerationStatus
    /** 分集剧本生成失败的持久化原因（重进页面仍可见）；成功或重新生成时清空 */
    outlinesErrorMessage: string | null
    status: ShortDramaGenerationStatus
```

- [ ] **Step 4: makeDefaultShortDramaState 默认值**

在 `makeDefaultShortDramaState`（约第 397 行）把：

```ts
      outlines: [],
      status: 'idle',
```

改为：

```ts
      outlines: [],
      outlinesStatus: 'idle',
      outlinesErrorMessage: null,
      status: 'idle',
```

- [ ] **Step 5: makeUploadedShortDramaState 默认值**

在 `makeUploadedShortDramaState`（约第 448 行）把：

```ts
      outlines: [],
      status: 'idle',
```

改为：

```ts
      outlines: [],
      outlinesStatus: 'idle',
      outlinesErrorMessage: null,
      status: 'idle',
```

- [ ] **Step 6: normalizeShortDramaState 默认值**

在 `normalizeShortDramaState`（约第 479 行）把：

```ts
      outlines,
      status: partial.script?.status ?? 'idle',
```

改为：

```ts
      outlines,
      outlinesStatus: partial.script?.outlinesStatus ?? 'idle',
      outlinesErrorMessage: partial.script?.outlinesErrorMessage ?? null,
      status: partial.script?.status ?? 'idle',
```

- [ ] **Step 7: 跑测试验证通过**

Run: `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts`
Expected: PASS，输出末尾 `✓ All tests passed`

- [ ] **Step 8: 构建 types 包**

后端 `api` 测试与前端 `web` 通过 `dist/` 引用 `@aigc/types`，必须重新构建。

Run: `pnpm --filter @aigc/types build`
Expected: 无报错，`packages/types/dist/` 更新

- [ ] **Step 9: 提交（需用户确认）**

```bash
git add packages/types/src/short-drama.ts packages/types/src/short-drama.test.ts
git commit -m "feat(types): 新增分集剧本 outlinesStatus/outlinesErrorMessage 字段"
```

---

## Task 2: 后端 apply 函数改写 outlinesStatus

**Files:**
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts:447-449`（`applyShortDramaEpisodeOutlinesBatchResult`）
- Test: `apps/api/src/__tests__/short-drama-text-generation-state.test.ts:47-68, 86-105, 145-153`

- [ ] **Step 1: 改失败测试 — 全量写回（第 64 行附近）**

在 `short-drama-text-generation-state.test.ts` 第 64 行 `assert.equal(outlinesState.script.status, 'completed')` 之后追加：

```ts
assert.equal(outlinesState.script.outlinesStatus, 'completed')
assert.equal(outlinesState.script.outlinesErrorMessage, null)
```

- [ ] **Step 2: 改失败测试 — 中间批次（第 86-105 行）**

把第 86-105 行整段替换为（关键：调用 apply 前先模拟路由层设的 `status='generating'`，并改断言）：

```ts
const partialState = makeDefaultShortDramaState({
  prompt: '外卖员获得超能力',
  style: '真人都市',
  aspectRatio: '9:16',
  episodeCount: 3,
})
partialState.script.refinedPrompt = '一个普通外卖员意外获得超能力。'
// 模拟路由层 post-episode-outlines.ts:166 在生成开始时设置的 status
partialState.script.status = 'generating'

applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 1, title: '觉醒', summary: '主角觉醒能力。' },
  { episodeNumber: 2, title: '救援', summary: '主角救下邻居。' },
])

assert.equal(partialState.script.outlines.length, 2)
assert.equal(partialState.episodes.items.length, 2)
// apply 函数：outlinesStatus 标记本批完成，但不改 script.status（交由路由层管理）
assert.equal(partialState.script.outlinesStatus, 'completed')
assert.equal(partialState.script.outlinesErrorMessage, null)
assert.equal(partialState.script.status, 'generating')
assert.equal(partialState.episodes.status, 'idle')
assert.equal(partialState.episodes.items[0]?.episodeNumber, 1)
assert.equal(partialState.episodes.items[1]?.episodeNumber, 2)
console.log('✓ 部分批次会保留已生成大纲，outlinesStatus 标记本批完成，script.status 交由路由层')
```

- [ ] **Step 3: 改失败测试 — 全量补齐（第 145-153 行）**

把第 145-153 行整段替换为：

```ts
applyShortDramaEpisodeOutlinesBatchResult(partialState, [
  { episodeNumber: 3, title: '守护', summary: '主角守护街区。' },
])

assert.equal(partialState.script.outlines.length, 3)
assert.equal(partialState.episodes.items.length, 3)
assert.equal(partialState.script.outlinesStatus, 'completed')
assert.equal(partialState.script.status, 'completed')
assert.equal(partialState.episodes.status, 'idle')
console.log('✓ 全部集数生成完成后标记 outlinesStatus 与 script.status 为 completed')
```

- [ ] **Step 4: 跑测试验证失败**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: FAIL，多条 `outlinesStatus` 断言不匹配（实际为 `undefined`，因为 apply 函数还没写新字段）

- [ ] **Step 5: 实现 apply 函数**

在 `apps/api/src/routes/short-drama/_text-generation.ts` 的 `applyShortDramaEpisodeOutlinesBatchResult`（约第 447 行）把：

```ts
  state.script.outlines = mergedOutlines
  state.script.status =
    mergedOutlines.length >= state.settings.episodeCount ? 'completed' : 'generating'
```

改为：

```ts
  state.script.outlines = mergedOutlines
  // 分集剧本批次请求独立状态：本批成功即 completed（区别于 script.status 的整体流程进度语义）
  state.script.outlinesStatus = 'completed'
  state.script.outlinesErrorMessage = null
  // 仅全量完成时同步 script.status（顶层整体进度语义，触发「下一步」可点）
  if (mergedOutlines.length >= state.settings.episodeCount) {
    state.script.status = 'completed'
  }
```

- [ ] **Step 6: 跑测试验证通过**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: PASS，输出末尾 `✅ 短剧文本生成状态写回测试通过！`

- [ ] **Step 7: 提交（需用户确认）**

```bash
git add apps/api/src/routes/short-drama/_text-generation.ts apps/api/src/__tests__/short-drama-text-generation-state.test.ts
git commit -m "refactor(short-drama): applyOutlinesBatch 写 outlinesStatus 而非 script.status"
```

---

## Task 3: 后端路由持久化 outlinesStatus 与失败原因

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts:165-167`（生成开始）、`280-284`（失败 catch）

> 说明：SSE 路由依赖 DB/Redis/AI 上游，无独立单测。状态写回核心逻辑已由 Task 2 的 `applyShortDramaEpisodeOutlinesBatchResult` 单测覆盖；本 Task 的失败/开始字段写入靠 Task 5 手动验证。

- [ ] **Step 1: 生成开始处写入新字段**

在 `post-episode-outlines.ts` 第 165-167 行把：

```ts
    try {
      state.script.status = 'generating'
      await saveShortDramaProjectState(projectId, state, 0)
```

改为：

```ts
    try {
      state.script.status = 'generating'
      // 分集剧本批次请求独立状态：刷新后前端据此恢复加载态；重新生成时清空历史失败原因
      state.script.outlinesStatus = 'generating'
      state.script.outlinesErrorMessage = null
      await saveShortDramaProjectState(projectId, state, 0)
```

- [ ] **Step 2: 失败 catch 持久化失败状态与原因**

在第 280-284 行把：

```ts
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集剧本生成失败`)
        state.script.status = 'failed'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
```

改为：

```ts
        await safeRefundCredits(app, teamId, creditAccountId, userId, ESTIMATED_CREDITS, projectId, `第 ${batch.from}-${batch.to} 集剧本生成失败`)
        state.script.status = 'failed'
        // 持久化分集剧本失败状态与原因，前端重进页面仍可见并可重试
        state.script.outlinesStatus = 'failed'
        state.script.outlinesErrorMessage = error instanceof Error ? error.message : '分集剧本生成失败'
        await markShortDramaProjectFailed(projectId, state).catch((saveError) => {
```

- [ ] **Step 3: 跑已有测试确保无回归**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-text-generation-state.test.ts`
Expected: PASS（确认改动未影响 apply 函数测试）

- [ ] **Step 4: 提交（需用户确认）**

```bash
git add apps/api/src/routes/short-drama/post-episode-outlines.ts
git commit -m "feat(short-drama): 分集剧本生成持久化 outlinesStatus 与失败原因"
```

---

## Task 4: 前端恢复加载态 + 错误回显 + 重试

**Files:**
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`（import 第 4 行、`isOutlinesGenerating` 第 1031、`outlineErrorText` 第 1037、`handleGenerateOutlines` 守卫 第 1097-1105、失败 banner 第 1588-1598）

> 说明：React 组件无单测，靠 Task 5 手动验证。

- [ ] **Step 1: import RefreshCw 图标**

在第 4 行把：

```ts
import { AlertCircle, Loader2, Sparkles, Check, Pencil, Save, X, Plus, Coins } from 'lucide-react'
```

改为：

```ts
import { AlertCircle, Loader2, Sparkles, Check, Pencil, Save, X, Plus, Coins, RefreshCw } from 'lucide-react'
```

- [ ] **Step 2: isOutlinesGenerating 读后端字段**

在第 1031 行把：

```ts
  // 仅以本地请求状态判断"剧本生成中"。
  // 单批次模式下，中间批次（如 1-5 集）成功后后端会把 script.status 置为 'generating'
  // （语义是"分批流程未结束、还有下一批可生成"），若用它锁按钮，会导致生成完 1-5 集后
  // 按钮永久 disabled、无法点"继续生成剧本"生成 6-10 集。刷新恢复交给后端 worker + 轮询，
  // 结果落库后 SWR 自动同步，不依赖这里锁 UI。
  const isOutlinesGenerating = generatingOutlines
```

改为：

```ts
  // 加载态同时覆盖「本地请求进行中」与「后端持久化的生成中（刷新恢复）」。
  // 用独立的 outlinesStatus 判断，避开 script.status 在中间批次的语义冲突。
  const isOutlinesGenerating =
    generatingOutlines || state.script.outlinesStatus === 'generating'
```

- [ ] **Step 3: outlineErrorText 读 outlines 自己的错误字段（修正 bug）**

在第 1037 行把：

```ts
  // 跨刷新兜底：重进页面后前端临时错误已丢失，从后端持久化的概述失败原因读取
  const outlineErrorText = outlineErrorMessage || state.script.episodeSummaryErrorMessage || ''
```

改为：

```ts
  // 跨刷新兜底：重进页面后前端临时错误已丢失，从后端持久化的分集剧本失败原因读取
  const outlineErrorText = outlineErrorMessage || state.script.outlinesErrorMessage || ''
```

- [ ] **Step 4: handleGenerateOutlines 守卫改用 outlinesStatus**

在第 1097-1105 行把：

```ts
    if (
      // 不拦截 script.status==='generating'：单批次模式下中间批次完成后 status 会停在
      // 'generating'（表示可继续生成下一批），拦截它会导致"继续生成剧本"永远无法触发。
      // 并发由本地 generatingOutlinesRef + 后端 Redis 锁双重保证。
      generatingOutlinesRef.current ||
      !state.script.refinedPrompt ||
      !isSummariesReady ||
      state.script.outlines.length >= state.settings.episodeCount
    ) return
```

改为：

```ts
    if (
      generatingOutlinesRef.current ||
      // 精确拦截「请求进行中」：outlinesStatus 在中间批次完成时是 'completed'，
      // 不会误锁「继续生成剧本」按钮（区别于旧的 script.status 拦截）。
      // 并发仍由本地 generatingOutlinesRef + 后端 Redis 锁双重保证。
      state.script.outlinesStatus === 'generating' ||
      !state.script.refinedPrompt ||
      !isSummariesReady ||
      state.script.outlines.length >= state.settings.episodeCount
    ) return
```

- [ ] **Step 5: 失败 banner 追加重试按钮**

在第 1588-1598 行把：

```tsx
        {outlineErrorText && !isSummariesGenerating && !isOutlinesGenerating && (
          <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">生成失败</div>
                <p className="mt-1">{outlineErrorText}</p>
              </div>
            </div>
          </div>
        )}
```

改为：

```tsx
        {outlineErrorText && !isSummariesGenerating && !isOutlinesGenerating && (
          <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">生成失败</div>
                <p className="mt-1">{outlineErrorText}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => handleGenerateOutlines()}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  重试
                </Button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 6: 提交（需用户确认）**

```bash
git add apps/web/src/components/short-drama/step-script-outline.tsx
git commit -m "fix(web): 分集剧本生成刷新后恢复加载态与失败重试"
```

---

## Task 5: 手动验证

> 本地验证边界：前端改动完成后即可结束反馈，不执行构建/浏览器刷新/重启 dev server。以下清单由用户在本地 dev 环境完成。

- [ ] **前置：重启 dev server**
  - 若 api 仍运行旧代码（Task 2/3 改动前），重启 `pnpm --filter @aigc/api dev`
  - web 开发服务器重启以加载 Task 4 改动与 Task 1 重建的 types dist

- [ ] **验证 1：生成中刷新恢复**
  1. 进入短剧项目剧本步骤，生成概述（锁定）
  2. 点「生成 5 集剧本」，在生成中（spinner 显示时）刷新页面
  3. 预期：刷新后 spinner **保持显示**（读 `outlinesStatus='generating'`），底部按钮显示「生成中...」禁用态
  4. 等后端跑完，spinner 消失，显示「继续生成剧本（剩 X 集）」或全量后「下一步」可点

- [ ] **验证 2：继续生成刷新恢复**
  1. 已有 1-5 集，点「继续生成剧本」生成 6-10 集
  2. 中途刷新，预期 spinner 保持 → 完成后「下一步」可点

- [ ] **验证 3：失败重试**
  1. 模拟失败（断开网络或 AI 异常）
  2. 预期：红色 banner 显示失败原因 + 「重试」按钮
  3. 点重试 → 弹 70 A豆确认 → 重新生成

- [ ] **验证 4：旧项目兼容**
  1. 打开一个改动前已存在的短剧项目（state JSON 无 `outlinesStatus` 字段）
  2. 预期：`normalizeShortDramaState` 补默认 `'idle'`，页面正常加载，无字段 undefined 报错
