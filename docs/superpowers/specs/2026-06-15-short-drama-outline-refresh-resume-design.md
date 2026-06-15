# 分集剧本生成刷新恢复 设计文档

- 日期：2026-06-15
- 范围：短剧创作 - 剧本步骤（script）- 分集剧本（episode outlines）生成
- 关联代码：`apps/api/src/routes/short-drama/post-episode-outlines.ts`、`_text-generation.ts`、`apps/web/src/components/short-drama/step-script-outline.tsx`、`packages/types/src/short-drama.ts`

## 1. 背景与问题

用户在「分集剧本」步骤点击「继续生成剧本」后，**刷新或重进页面，生成中的加载状态（spinner）会丢失**。

经排查，后端 `callQwenForTextStream`（`_text-generation.ts:144-311`）已内置「客户端断连不立即中止」机制（`stallChecker` + `CLIENT_DISCONNECT_STALL_MS = 120_000`）：客户端 SSE 断开后，只要 AI 持续产出 chunk（120s 内有更新），后端会继续跑完并落库；只有 AI 真卡死 120s 才中止。所有 5 个文本生成路由（summary / episode-outlines / episode-summaries / asset-prompts / segments）共用此机制。

因此 **outlines 后端在刷新后本来就会继续生成并落库**，问题纯粹在前端：刷新后无法恢复「生成中」的加载显示。

## 2. 根因分析

### 2.1 `script.status` 语义冲突

`state.script.status`（`ShortDramaGenerationStatus`）在分集剧本流程中被塞了两种语义：

| 场景 | `script.status` | 实际含义 |
|---|---|---|
| 正在生成某批 | `generating` | 请求进行中 |
| 中间批次完成（如 1-5 集完成、还有 6-10 集可生成） | `generating` | 分批流程未结束、等待用户点「继续」 |
| 全量完成 | `completed` | 流程结束 |

中间批次与请求进行中**共用 `generating`**，前端无法区分「该显示 spinner」还是「该显示继续按钮」。

### 2.2 上一轮死锁修复的副作用

上一轮为修复「按钮永久 disabled」死锁，把前端 `isOutlinesGenerating`（`step-script-outline.tsx:1031`）改为**只读本地请求状态** `generatingOutlines`，并移除了 `handleGenerateOutlines` 守卫里对 `status === 'generating'` 的拦截。死锁解决了，但副作用是：刷新后本地 `generatingOutlines` 归零，spinner 消失——即便后端仍在生成、轮询仍在工作（`script.status === 'generating'` 触发 `use-short-drama-project.ts` 轮询，outlines 几秒后会静默更新）。

### 2.3 对比 `episodeSummaryStatus`

分集概述（episode summaries）已有独立字段 `state.script.episodeSummaryStatus`，与 `script.status` 解耦，因此概述生成能正常刷新恢复。outlines 缺这一层独立字段，是问题根源。

## 3. 设计方案

核心：**为 outlines 引入独立状态字段 `outlinesStatus`，对齐已验证的 `episodeSummaryStatus` 模式**。后端生成行为（含断连继续机制）一行都不改。

### 3.1 状态字段（`packages/types/src/short-drama.ts`）

`ShortDramaState.script` 增加两个字段（紧邻 `outlines` 与 `episodeSummaryStatus`）：

```ts
outlinesStatus: ShortDramaGenerationStatus       // 分集剧本批次请求状态
outlinesErrorMessage: string | null              // 失败原因，跨刷新持久化
```

字段语义（与 `script.status` 解耦）：

| 场景 | `outlinesStatus` | `script.status`（保持现状语义） | 前端表现 |
|---|---|---|---|
| 初始 / 未生成 | `idle` | `idle` | 显示「生成 5 集剧本」 |
| 正在生成某批（含刷新后后端仍在跑） | `generating` | `generating` | spinner + 轮询 |
| 中间批次完成、等用户点继续 | `completed` | `generating` | 显示「继续生成剧本（剩 X 集）」 |
| 全量完成 | `completed` | `completed` | 「下一步」可点 |
| 失败（AI 卡死 / 解析错 / 空） | `failed` | `failed` | 错误原因 + 重试 |

`makeDefaultShortDramaState` / `normalizeShortDramaState` 中补默认值 `outlinesStatus: 'idle'`、`outlinesErrorMessage: null`，对旧 JSON 向后兼容（与 `episodeSummaryStatus` 的默认值处理一致，见 `short-drama.ts:395-397、446-448、477-478`）。

### 3.2 后端（`apps/api`）

#### 3.2.1 `applyShortDramaEpisodeOutlinesBatchResult`（`_text-generation.ts:429-467`）

当前第 448-449 行：

```ts
state.script.status =
  mergedOutlines.length >= state.settings.episodeCount ? 'completed' : 'generating'
```

改为：

```ts
// 分集剧本批次请求独立状态：本批成功即 completed（区别于 script.status 的「整体流程进度」语义）
state.script.outlinesStatus = 'completed'
state.script.outlinesErrorMessage = null
// 仅全量完成时同步 script.status（顶层「整体进度」语义）
if (mergedOutlines.length >= state.settings.episodeCount) {
  state.script.status = 'completed'
}
```

这是死锁与刷新丢失的**共同根因**：原来中间批次把 `script.status` 置回 `generating`，既导致上一轮死锁，又让 `outlinesStatus` 缺位。

#### 3.2.2 `post-episode-outlines.ts`

- 第 166 行生成开始处，**保留** `state.script.status = 'generating'`（仍被 `post-episode-summaries.ts:112`、`put-script-source.ts:37` 用于并发拦截「剧本流程进行中」），**追加**：

  ```ts
  state.script.outlinesStatus = 'generating'
  state.script.outlinesErrorMessage = null  // 重新生成时清空历史失败原因
  ```

- catch 分支（第 281 行 `state.script.status = 'failed'` 附近）追加：

  ```ts
  state.script.outlinesStatus = 'failed'
  state.script.outlinesErrorMessage = error instanceof Error ? error.message : '分集剧本生成失败'
  ```

- 生成行为（`externalSignal: clientSignal`、`callQwenForTextStream` 调用、积分冻结/结算/退款、Redis 锁）**全部不动**。

### 3.3 前端（`apps/web`）

#### 3.3.1 `isOutlinesGenerating`（`step-script-outline.tsx:1031`）

```ts
const isOutlinesGenerating =
  generatingOutlines || state.script.outlinesStatus === 'generating'
```

刷新后读后端持久化的 `outlinesStatus`，spinner 恢复显示。同时修正上一轮注释中「刷新恢复交给后端 worker + 轮询」的错误表述（实际并无 worker，靠 SSE stallChecker + SWR 轮询）。

#### 3.3.2 `handleGenerateOutlines` 守卫（`step-script-outline.tsx:1097-1105`）

上一轮移除了 `status === 'generating'` 拦截。现在用精确的 `outlinesStatus === 'generating'` 重新拦截（不会死锁，因为批次间隙是 `completed`）：

```ts
if (
  generatingOutlinesRef.current ||
  state.script.outlinesStatus === 'generating' ||   // 新增：精确拦截「请求进行中」
  !state.script.refinedPrompt ||
  !isSummariesReady ||
  state.script.outlines.length >= state.settings.episodeCount
) return
```

并发仍由本地 `generatingOutlinesRef` + 后端 Redis 锁双重保证。

#### 3.3.3 `outlineErrorText`（`step-script-outline.tsx:1037`）修正

当前错误回显 fallback 到概述字段，是 bug：

```ts
// 当前（错误）：
const outlineErrorText = outlineErrorMessage || state.script.episodeSummaryErrorMessage || ''
```

改为读 outlines 自己的错误字段：

```ts
const outlineErrorText = outlineErrorMessage || state.script.outlinesErrorMessage || ''
```

#### 3.3.4 失败态显示（`step-script-outline.tsx:1588-1598`）

现有红色 banner 条件 `outlineErrorText && !isSummariesGenerating && !isOutlinesGenerating` 保留，并在 banner 内追加「重试」按钮（对齐概述失败态），点击调用 `handleGenerateOutlines()`。

#### 3.3.5 轮询

**不改**。outlines 生成期间 `script.status === 'generating'`（3.2.2 保留），`use-short-drama-project.ts:43-44` 的轮询已自然触发，后端落库后 SWR 自动同步。`api.ts:384` 的 SSE `shouldPoll` 同理无需调整。

### 3.4 不改动的部分（边界）

明确**不动**以下位置，避免扩大范围 / 引入回归：

- `applyShortDramaScriptSummaryResult`（`_text-generation.ts:410`）写 `script.status = 'completed'` —— 摘要流程语义
- `post-script-summary.ts`、`post-episode-summaries.ts`、`put-script-source.ts` 中对 `script.status === 'generating'` 的并发拦截 —— 保持原有兜底
- 前端 `handleGenerateSummary`、`canGenerateSummaries`、`handleGenerateSummaries` 中对 `script.status` 的读取 —— 摘要 / 概述流程守卫，不受 outlinesStatus 影响
- 剧本摘要（summary）刷新恢复用的 `status === 'generating' && !refinedPrompt` hack —— 未报问题，不在本次范围

## 4. 已知限制

**中间批次完成后 `script.status` 仍为 `generating`**（来自 `post-episode-outlines.ts:166` 的生成开始设置，用于并发拦截 summaries/上传），会导致 `use-short-drama-project.ts` 在「等用户点继续」期间持续空轮询（3s/次 sync，拿到的状态不变）。属既有行为，本次不解决——彻底清理需重构 `script.status` 的整体进度语义（影响后端多处），超出本设计范围。功能上无害（轮询仅 sync，不扣费、不触发生成）。

## 5. 测试

### 5.1 后端单测（`apps/api/src/__tests__/short-drama-text-generation-state.test.ts`）

- `applyShortDramaEpisodeOutlinesBatchResult` 后：`outlinesStatus === 'completed'`、`outlinesErrorMessage === null`
- 全量完成：`script.status === 'completed'`
- 中间批次（outlines.length < episodeCount）：`outlinesStatus === 'completed'`、`script.status` 保持调用前的 `'generating'`（不再被置回）
- 失败路径（在 `post-episode-outlines.ts` 集成或 mock）：`outlinesStatus === 'failed'`、`outlinesErrorMessage` 非空

### 5.2 types 单测（`packages/types/src/short-drama.test.ts`）

- `makeDefaultShortDramaState`：`outlinesStatus === 'idle'`、`outlinesErrorMessage === null`
- `normalizeShortDramaState`：对缺字段的旧 JSON 补 `outlinesStatus: 'idle'`、`outlinesErrorMessage: null` 默认值

### 5.3 手动验证（由用户在本地 dev 完成）

1. 生成概述 → 点「生成 5 集剧本」→ 生成中刷新页面 → spinner 应保持（读 `outlinesStatus='generating'`）
2. 后端跑完 1-5 集 → spinner 消失，显示「继续生成剧本（剩 X 集）」
3. 点「继续」生成 6-10 集 → 中途刷新 → spinner 保持 → 完成后显示「下一步」可点
4. 模拟失败（断网或 AI 异常）→ 显示错误原因 + 重试按钮
