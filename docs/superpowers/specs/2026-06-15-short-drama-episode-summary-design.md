# 短剧分集概述（故事脉络）改造设计

## 背景

当前短剧「生成分集剧本」按每 5 集一批生成（`SHORT_DRAMA_OUTLINE_BATCH_SIZE = 5`）。每一批的提示词只携带完整的剧本摘要（`state.script.refinedPrompt`），**不包含之前集数实际发生的剧情**。这导致后续批次与前期批次产生剧情冲突：人物关系、伏笔、反转走向对不齐。

用户需求（原话）：

> 每生成一批次剧本就要把包括本次生成的剧本归纳总结成一个简单的概述，然后把这个概述作为目前已经发生的故事接入到提示词，按照故事的脉络继续生成后续的故事。

经多轮澄清后确认采用**方案 A（全量蓝图）**：

1. 在剧本摘要之后、分集剧本之前，新增一步「分集概述」：一次性为全部 N 集各生成一段约 100 字的剧情概述，作为固定的「故事蓝图」。
2. 用户锁定全部分集概述后，再按 5 集一批生成分集剧本；每一批剧本的提示词都注入「故事脉络」（当前批次集数 + 之前所有集数的概述），保证前后一致。

## 目标

- 新增「分集概述」生成接口，一次性产出全部 N 集的 100 字概述，作为故事蓝图。
- 分集概述展示在分集剧本模块内、**每一集剧本的上方**（不独立成区）。
- 用户锁定全部概述后才能生成单集完整剧本；锁定后概述不可编辑。
- 分集剧本改为「每次调用生成一批（5 集）」，每批注入「故事脉络」概述，杜绝剧情冲突。
- 保留现有 SSE 流式、断线回查、积分预冻结/实结、Redis 分布式锁机制。
- 不改变数据库表结构，仅扩展 `short_drama_projects.state` JSON。

## 非目标

- 不引入后台队列化文本生成。
- 不改变图片、视频、导出任务的逻辑。
- 不改变剧本摘要（`refinedPrompt`）生成逻辑。
- 不做复杂的逐 token JSON 增量解析。

## 推荐方案

### 1. 数据结构变更（`packages/types/src/short-drama.ts`）

新增接口与状态字段，**无数据库迁移**：

```typescript
/** 单集剧情概述，作为故事脉络与剧本生成的固定蓝图 */
export interface ShortDramaEpisodeSummary {
  episodeNumber: number
  /** 该集剧情概述（约 100 字左右，根据剧情内容可适当增减） */
  summary: string
}
```

`ShortDramaState.script` 扩展两个字段：

```typescript
script: {
  source: ShortDramaScriptSource
  originalPrompt: string
  originalScript: string
  refinedPrompt: string | null
  episodeSummaries: ShortDramaEpisodeSummary[]      // 新增：全量分集概述
  episodeSummaryStatus: ShortDramaGenerationStatus  // 新增：概述生成状态（断线回查用）
  outlines: ShortDramaEpisodeOutline[]
  status: ShortDramaGenerationStatus
}
```

需同步更新三处：

- `makeDefaultShortDramaState` / `makeUploadedShortDramaState`：初始化 `episodeSummaries: []`、`episodeSummaryStatus: 'idle'`。
- `normalizeShortDramaState`：补默认值，保证旧项目 JSON（无这两个字段）向后兼容，读出时为 `[]` 与 `'idle'`。

### 2. 后端新增：分集概述生成接口

新增路由文件 `apps/api/src/routes/short-drama/post-episode-summaries.ts`，路径 `POST /short-drama/projects/:id/script/episode-summaries`，结构对齐 [`post-script-summary.ts`](apps/api/src/routes/short-drama/post-script-summary.ts)。

流程：

1. `assertShortDramaProjectAccess` 校验权限。
2. 前置校验：`state.script.refinedPrompt` 必须存在，否则 `VALIDATION_ERROR: 请先生成剧本摘要`。
3. 前置校验：`state.script.episodeSummaries.length >= episodeCount` 时返回 `ALREADY_GENERATED`。
4. `acquireRedisLock(... :episode-summaries)`，占用则 `GENERATION_IN_PROGRESS`。
5. 预冻结积分（`ESTIMATED_CREDITS`，建议值见「开放决策点」），余额不足 `INSUFFICIENT_CREDITS`。
6. `state.script.episodeSummaryStatus = 'generating'`，保存状态。
7. `reply.hijack()`，建立 SSE，复用 `createShortDramaSSESession`。
8. `buildShortDramaEpisodeSummariesPrompts(state)` 构建 prompt（见下）。
9. `callQwenForTextStream`，`onChunk` 转发 `chunk`，`externalSignal` 绑定 `clientSignal`。
10. 解析返回的 JSON 数组，校验每集含 `episodeNumber`、`summary`，数量等于 `episodeCount`。
11. `applyShortDramaEpisodeSummariesResult(state, summaries)` 写回 `episodeSummaries`、`episodeSummaryStatus = 'completed'`。
12. `saveShortDramaStateAndSettleCredits` 原子结算。概述生成**只更新 `state.script.episodeSummaryStatus`，不改 `state.script.status`**（后者属摘要/剧本流程，避免互相覆盖）。其 `status` 入参写入 `short_drama_projects.status` 项目顶层 DB 列，传值见开放决策点。
13. `sendEvent('done', { success: true, episodeSummaries, state })`，`persisted` 标志区分「业务成功但 SSE 推送失败」与「真正失败」，复用摘要路由的退积分/失败处理范式。

#### 概述 Prompt 构建（`_script-source.ts` 新增 `buildShortDramaEpisodeSummariesPrompts`）

- **systemPrompt**：你是专业短剧编剧；根据剧本摘要为每集生成约 100 字的剧情概述；概述必须形成连贯的故事脉络，覆盖起承转合、人物关系变化与阶段性钩子；集与集之间要有因果递进，不能互相矛盾；只输出 JSON 数组 `[{episodeNumber, summary}]`。
- **userPrompt**：剧本摘要（`state.script.refinedPrompt`）+ 集数（`episodeCount`）+ 视觉风格 + 输出格式约束 + 「每集概述 80–120 字、第 N 集概述必须承接第 N-1 集结尾」等要求。
- **maxTokens**：建议 `8000`（按 N 集 × 100 字 + JSON 结构估算，覆盖最大 100 集）。

### 3. 后端改造：分集剧本生成（`post-episode-outlines.ts`）

三处改动：

#### 3.1 前置门控

在现有「摘要已生成」「大纲未完成」校验之后，增加概述就绪校验：

```typescript
if (state.script.episodeSummaries.length < state.settings.episodeCount) {
  return reply.status(400).send({
    error: { code: 'VALIDATION_ERROR', message: '请先生成并锁定全部分集概述' },
  })
}
```

#### 3.2 改为单批次

删除现有 `for (const batch of batches)` 多批循环，改为只取下一批：

```typescript
const startEpisode = state.script.outlines.length + 1
const batch = buildShortDramaOutlineBatches(startEpisode, episodeCount)[0]
if (!batch) {
  return reply.status(400).send({ error: { code: 'ALREADY_GENERATED', message: '分集剧本已生成' } })
}
```

单批内逻辑（冻结积分 → 流式调用 → 解析 → `applyShortDramaEpisodeOutlinesBatchResult` → 结算）保持不变，但去掉循环与「余额不足停止后续批次」的多批分支，简化为单次成功/失败。

#### 3.3 Prompt 注入故事脉络

在 `userPrompt` 中注入「故事脉络」段落——取第 `1` 到第 `batch.to` 集的概述（即「当前批次 + 之前所有集数」），保证 AI 看到完整蓝图至当前点：

```text
已确定的分集剧情脉络（请严格遵循，保持人物、伏笔、反转前后一致）：
第 1 集：{summary1}
第 2 集：{summary2}
...
第 {to} 集：{summaryTo}

其中第 {from}-{to} 集为本次需要生成分场剧本的集数，请依据上述脉络展开。
```

`systemPrompt` 增加：「必须延续上方故事脉络，不得与已确定的概述产生剧情冲突」。

### 4. 前端改造

#### 4.1 API 层（`apps/web/src/lib/short-drama/api.ts`）

- `ShortDramaStreamResult` 增加可选字段 `episodeSummaries?: ShortDramaEpisodeSummary[]`。
- 新增 `generateShortDramaEpisodeSummaries(projectId, options)`，复用 `postShortDramaSSE`，断线回查谓词为 `project.state.script.episodeSummaryStatus === 'generating'`，模式对齐 `generateShortDramaScriptSummary`。

#### 4.2 步骤组件（`step-script-outline.tsx`）

- 新增状态：`summaryStreamText`（概述流式文本）、`isSummariesGenerating`。
- 新增 `handleGenerateSummaries`：二次确认（提示预估 A 豆）→ 调 `generateShortDramaEpisodeSummaries` → 流式展示 → done 后 `onStateChange` 刷新。
- 分集概述展示**归属分集剧本模块内**：改造 `EpisodeOutlineList`，使其同时接收 `episodeSummaries` 与 `outlines`，按集数渲染每一集卡片，卡片结构为：

  ```text
  ┌─ 第 N 集 ──────────────────────────
  │ [分集概述]（约100字，剧本未生成时可编辑）   ← 新增模块，置于剧本上方
  ├─ 标题 / 分场剧本正文（outlines，已生成时展示）
  └────────────────────────────────────
  ```

  - 概述来自 `episodeSummaries`（全量预生成），剧本来自 `outlines`（逐批生成）。
  - 概述生成完成但剧本未生成的集：卡片仅显示顶部概述，剧本区显示「待生成」占位。
  - 概述编辑：剧本未生成时可编辑（复用现有编辑弹窗模式，`onEditSummary`），编辑后调 `saveShortDramaProject` 写回 `episodeSummaries`。
- 分集剧本按钮：显示前提改为「全部概述已就绪」（`episodeSummaries.length >= episodeCount`）；积分文案改为单批（`70 A豆/批`）；按钮文案：未生成→「生成分集剧本」/ 部分生成→「继续生成剧本（剩 X 集）」。

#### 4.3 组件抽离（targeted improvement）

`step-script-outline.tsx` 已超 1500 行，远超 200 行规则。新增的概述展示/编辑逻辑抽成独立组件 `EpisodeSummaryCard`（同目录新文件），主组件引用，避免继续膨胀。

### 5. `ShortDramaState` JSON 字段说明（权威）

> 项目此前无 `state` JSON 字段级说明文档，本节作为权威说明，含本次新增字段。

`short_drama_projects.state`（JSONB）顶层结构：

| 路径 | 类型 | 说明 |
|------|------|------|
| `steps.active` | `'script'|'assets'|'episodes'` | 当前激活步骤 |
| `steps.completed` | `ShortDramaStepId[]` | 已完成步骤 |
| `script.source` | `'idea'|'upload'` | 灵感模式 / 上传剧本模式 |
| `script.originalPrompt` | `string` | 原始创意（idea 模式） |
| `script.originalScript` | `string` | 原始剧本正文（upload 模式） |
| `script.refinedPrompt` | `string \| null` | AI 生成的完整剧本摘要 |
| `script.episodeSummaries` | `ShortDramaEpisodeSummary[]` | **新增**：全量分集概述（每集约 100 字），故事脉络来源 |
| `script.episodeSummaryStatus` | `ShortDramaGenerationStatus` | **新增**：概述生成状态，`'generating'` 用于断线回查 |
| `script.outlines` | `ShortDramaEpisodeOutline[]` | 分集剧本（逐批生成） |
| `script.status` | `ShortDramaGenerationStatus` | 脚本整体生成状态 |
| `assets.*` | — | 素材相关（本次不变） |
| `episodes.*` | — | 分集/片段相关（本次不变） |
| `exports.batches` | `ShortDramaBatchExport[]` | 导出批次（本次不变） |
| `settings.*` | — | 项目设置：风格/比例/集数/时长/计费模式 |
| `locks.script/assets/episodes` | `boolean` | 步骤确认锁（本次不变） |

`ShortDramaEpisodeSummary`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `episodeNumber` | `number` | 集数，1-based |
| `summary` | `string` | 该集剧情概述（约 100 字左右，根据剧情内容可适当增减） |

**向后兼容**：旧项目 JSON 无 `episodeSummaries` / `episodeSummaryStatus` 时，`normalizeShortDramaState` 读出为 `[]` / `'idle'`，表现为「未生成概述」，用户需先走概述步骤；已有 `outlines` 的旧项目不受影响（剧本已完成）。

## SSE 协议

概述生成接口复用与摘要相同的 SSE 协议（`progress` / `chunk` / `done` / `error`），断线回查通过 `episodeSummaryStatus === 'generating'` 判定。剧本生成接口 SSE 协议不变，仅改为单批次返回。

## 测试与验证

- `buildShortDramaOutlineBatches(startEpisode, total)` 单批取值正确（从 `outlines.length+1` 起）。
- 概述生成：解析返回数组、数量校验、写回 `episodeSummaries` 与状态。
- 概述生成失败：退积分、状态置 `failed`、SSE 推送失败不误判（`persisted` 标志）。
- 剧本生成门控：概述未就绪时返回 `VALIDATION_ERROR`。
- 剧本生成 prompt 注入的故事脉络覆盖第 `1` 到 `to` 集。
- `normalizeShortDramaState` 对无新字段的旧 JSON 正确补默认值。
- 前端概述展示在每集剧本上方、编辑权限正确（剧本未生成时可编辑）。
- `packages/types` 与 `apps/api`、`apps/web` TypeScript build 通过。

## 风险与注意事项

- 概述是一次性全量生成，集数较大（如 80–100）时单次输出较长，需关注模型超时与 token 上限；`maxTokens` 取值见开放决策点。
- 锁定语义采用「隐式锁定，不新增布尔字段」：一旦 `outlines.length > 0`，概述即视为锁定（只读），因后续批次依赖其作为脉络。详见开放决策点。
- 前端 `EpisodeOutlineList` 改为同时消费 `episodeSummaries` 与 `outlines`，需保证两者按 `episodeNumber` 正确匹配、缺失集数优雅降级。
- 概述生成与剧本生成共用 `script.status`，需注意状态流转不互相覆盖；概述生成期间 `script.status` 不应被剧本流程读取为就绪。

## 开放决策点（需审查确认）

1. **概述生成预冻结积分（`ESTIMATED_CREDITS`）**：建议 `40`（最终按实际输入+输出字符数结算，预冻结仅上限）。可审查调整。
2. **概述生成 `maxTokens`**：建议 `8000`。可审查调整。
3. **概述生成 `saveShortDramaStateAndSettleCredits` 的 `status` 入参**（写入 `short_drama_projects.status` 顶层 DB 列）：建议与摘要流程一致传 `'generating'`，等剧本全部完成后才由剧本流程置最终态。可审查调整。
4. **概述编辑范围**：当前设计为「该集剧本未生成时可编辑该集概述」；一旦任一集剧本开始生成，全部概述只读（隐式锁定）。请确认。

> 注：已确认采用「隐式锁定，不新增持久化锁定字段」——`outlines.length > 0` 即锁定概述。
