# 短剧生成流程：锁泄漏 + state 覆盖 + UI 矛盾 修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务实现。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 修复短剧生成流程的三个已确诊根因——① Redis 锁泄漏导致 409；② 前端 PUT 用过期 state 覆盖数据库的 generating 状态；③ "生成仍在进行中"被当成失败渲染（重试按钮 + 非 loading）。

**Architecture:**
- A 锁：5 个短剧文本生成接口的 `acquireRedisLock` 显式传 `{ ttlSeconds: 480, autoRenew: false }`，dev 重启后锁最多 ~8 分钟自过期。
- B state：put-project-id 的 `body.state` 路径接入「生成中整体拒绝」保护（纯函数 `hasShortDramaGeneratingStatus` + 脚本式测试）。
- C UI：api.ts 用 `ShortDramaStillGeneratingError` 区分「后台生成中 / 真失败」，组件 catch 识别后保持 loading、不报错，依赖既有 server-generating 轮询自愈。

**Tech Stack:** Fastify 4 + Kysely（API）、Next.js 14 + SWR（Web）、ioredis 分布式锁、`node:assert` 脚本式测试。

**已确认的定量/决策：**
- 锁 TTL = 480s，autoRenew = false
- state 保护粒度 = B1（整体拒绝，返回 409）
- 范围限定短剧（picture-book 三个接口同隐患，本次不动，列入后续）

---

## File Structure

| 文件 | 职责 | 本次动作 |
|---|---|---|
| `apps/api/src/routes/short-drama/post-episode-outlines.ts` | 分集剧本生成 | A：锁传 options |
| `apps/api/src/routes/short-drama/post-generate-segments.ts` | 分集片段脚本生成 | A：锁传 options |
| `apps/api/src/routes/short-drama/post-episode-summaries.ts` | 分集概述生成 | A：锁传 options |
| `apps/api/src/routes/short-drama/post-asset-prompts.ts` | 素材提示词生成 | A：锁传 options |
| `apps/api/src/routes/short-drama/post-script-summary.ts` | 剧本摘要生成 | A：锁传 options |
| `apps/api/src/routes/short-drama/_shared.ts` | 共享工具 | B：新增 `hasShortDramaGeneratingStatus` 纯函数 |
| `apps/api/src/__tests__/short-drama-generating-status.test.ts` | 新增测试 | B：脚本式测试 |
| `apps/api/src/routes/short-drama/put-project-id.ts` | 项目 PUT | B：body.state 路径接入保护 |
| `apps/web/src/lib/short-drama/api.ts` | 前端 SSE 封装 | C：`ShortDramaStillGeneratingError` + 清理诊断日志 |
| `apps/web/src/components/short-drama/step-episodes.tsx` | 分集片段 UI | C：catch 识别三态 |
| `apps/web/src/components/short-drama/step-script-outline.tsx` | 剧本/分集大纲 UI | C：catch 识别三态 |

---

## Task 1：A 锁 — 5 个生成接口显式传 TTL（480s，不续期）

**Files:**
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts:218`
- Modify: `apps/api/src/routes/short-drama/post-generate-segments.ts:98`
- Modify: `apps/api/src/routes/short-drama/post-episode-summaries.ts:140`
- Modify: `apps/api/src/routes/short-drama/post-asset-prompts.ts:142`
- Modify: `apps/api/src/routes/short-drama/post-script-summary.ts:68`

5 处同质改动：给 `acquireRedisLock` 第三个参数传 `{ ttlSeconds: 480, autoRenew: false }`。

- [ ] **Step 1: 改 post-episode-outlines.ts**

```ts
// 第 218 行，原：
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-outlines`)
// 改为：
// 生成类锁：固定 TTL 480s（> TEXT_TIMEOUT_MS 360s + 余量）+ 关闭自动续期。
// dev 重启 / 进程被杀后 finally 来不及释放时，锁最多 ~8 分钟自过期，不再卡默认 1 小时。
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-outlines`, { ttlSeconds: 480, autoRenew: false })
```

- [ ] **Step 2: 改 post-generate-segments.ts**

```ts
// 第 98 行，改为：
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-segments:${episodeNumber}`, { ttlSeconds: 480, autoRenew: false })
```

- [ ] **Step 3: 改 post-episode-summaries.ts**

```ts
// 第 140 行，改为：
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:episode-summaries`, { ttlSeconds: 480, autoRenew: false })
```

- [ ] **Step 4: 改 post-asset-prompts.ts**

```ts
// 第 142 行，改为：
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:asset-prompts`, { ttlSeconds: 480, autoRenew: false })
```

- [ ] **Step 5: 改 post-script-summary.ts**

```ts
// 第 68 行，改为：
generationLock = await acquireRedisLock(app.redis, `lock:short-drama:${projectId}:script-summary`, { ttlSeconds: 480, autoRenew: false })
```

- [ ] **Step 6: 验证**

Run: `pnpm --filter @aigc/api build`
Expected: tsc 编译通过（确认 options 类型正确）。

Run（确认 5 处都改了、无遗漏）: `grep -rn "acquireRedisLock(app.redis" apps/api/src/routes/short-drama`
Expected: 5 处都带 `{ ttlSeconds: 480, autoRenew: false }`。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/short-drama/post-episode-outlines.ts apps/api/src/routes/short-drama/post-generate-segments.ts apps/api/src/routes/short-drama/post-episode-summaries.ts apps/api/src/routes/short-drama/post-asset-prompts.ts apps/api/src/routes/short-drama/post-script-summary.ts
git commit -m "fix(short-drama): 生成类 Redis 锁显式设 TTL 480s 并关闭续期

dev 重启时进行中的生成 handler 被杀、finally 来不及释放锁；旧默认 TTL 3600s+autoRenew 导致锁残留近 1 小时，期间重复生成一律 409。改为 480s 不续期，最差 ~8 分钟自过期。"
```

---

## Task 2：B-1 新增「是否生成中」纯函数 + 脚本式测试（TDD）

**Files:**
- Modify: `apps/api/src/routes/short-drama/_shared.ts`（新增导出函数）
- Create: `apps/api/src/__tests__/short-drama-generating-status.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/api/src/__tests__/short-drama-generating-status.test.ts`:

```ts
import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState } from '@aigc/types'
import { hasShortDramaGeneratingStatus } from '../routes/short-drama/_shared.js'

console.log('测试 hasShortDramaGeneratingStatus...')

// 全 idle → false
const idleState = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
assert.equal(hasShortDramaGeneratingStatus(idleState), false, '全 idle 应为 false')
console.log('✓ 全 idle → false')

// script.status=generating → true
const scriptGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
scriptGen.script.status = 'generating'
assert.equal(hasShortDramaGeneratingStatus(scriptGen), true)
console.log('✓ script.status=generating → true')

// outlinesStatus=generating → true
const outlinesGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
outlinesGen.script.outlinesStatus = 'generating'
assert.equal(hasShortDramaGeneratingStatus(outlinesGen), true)
console.log('✓ outlinesStatus=generating → true')

// episodeSummaryStatus=generating → true
const summaryGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
summaryGen.script.episodeSummaryStatus = 'generating'
assert.equal(hasShortDramaGeneratingStatus(summaryGen), true)
console.log('✓ episodeSummaryStatus=generating → true')

// assets.status=generating → true
const assetsGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
assetsGen.assets.status = 'generating'
assert.equal(hasShortDramaGeneratingStatus(assetsGen), true)
console.log('✓ assets.status=generating → true')

// 某集片段脚本生成中（episode.status=generating）→ true
const episodeGen = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
episodeGen.episodes.items[0].status = 'generating'
assert.equal(hasShortDramaGeneratingStatus(episodeGen), true)
console.log('✓ episode.status=generating → true')

// failed 不算 generating
const failedState = makeDefaultShortDramaState({ prompt: 'p', style: 's', aspectRatio: '9:16', episodeCount: 2 })
failedState.script.outlinesStatus = 'failed'
assert.equal(hasShortDramaGeneratingStatus(failedState), false)
console.log('✓ failed 状态不算 generating')

console.log('全部通过')
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-generating-status.test.ts`
Expected: 失败，提示 `hasShortDramaGeneratingStatus` 未导出/未定义。

- [ ] **Step 3: 在 _shared.ts 实现纯函数**

在 `_shared.ts` 合适位置（状态工具区，`readShortDramaProjectState` 附近）新增并导出：

```ts
/**
 * 判断短剧 state 是否存在任一「文本生成中」流程（generating）。
 * 用于 put-project-id 拒绝前端过期 state 覆盖，避免抹掉生成中标记导致状态与锁不一致。
 * 注意：只覆盖「文本类」生成（脚本/大纲/概述/素材/片段脚本），不包含 segment 视频任务（走 worker）。
 */
export function hasShortDramaGeneratingStatus(state: ShortDramaState): boolean {
  return (
    state.script.status === 'generating' ||
    state.script.outlinesStatus === 'generating' ||
    state.script.episodeSummaryStatus === 'generating' ||
    state.assets.status === 'generating' ||
    state.episodes.status === 'generating' ||
    state.episodes.items.some(ep => ep.status === 'generating')
  )
}
```

> 需确认 `_shared.ts` 顶部已 import `ShortDramaState`（通常已有）。若无需补 `import type { ShortDramaState } from '@aigc/types'`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-generating-status.test.ts`
Expected: 输出 `全部通过`，退出码 0。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/short-drama/_shared.ts apps/api/src/__tests__/short-drama-generating-status.test.ts
git commit -m "feat(short-drama): 新增 hasShortDramaGeneratingStatus 纯函数及测试"
```

---

## Task 3：B-2 put-project-id 接入「生成中整体拒绝」保护

**Files:**
- Modify: `apps/api/src/routes/short-drama/put-project-id.ts:44-55`（body.state 分支）

- [ ] **Step 1: 改 body.state 分支**

在 `put-project-id.ts` 的 `if (body.state !== undefined)` 分支开头插入生成中检查。`readShortDramaProjectState` 与 `hasShortDramaGeneratingStatus` 都需确保已 import。

```ts
// 处理 state
if (body.state !== undefined) {
  // 生成中保护：库内任一文本流程在 generating 时，拒绝前端整份 state 覆盖。
  // 前端 SWR 缓存的 state 可能落后于数据库，直接覆盖会抹掉 generating 标记，
  // 造成「状态丢失 + Redis 锁仍在」的不一致。
  const currentState = await readShortDramaProjectState(id)
  if (hasShortDramaGeneratingStatus(currentState)) {
    return reply.status(409).send({
      error: { code: 'GENERATION_IN_PROGRESS', message: '生成进行中，请刷新页面查看最新结果' },
    })
  }
  try {
    const normalizedState = normalizeShortDramaState(body.state)
    await syncShortDramaSegmentsFromState(id, normalizedState)
    updates.state = JSON.stringify(normalizedState)
  } catch (error) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: '状态数据格式无效' }
    })
  }
}
```

- [ ] **Step 2: 确认 import**

确认 `put-project-id.ts` 顶部从 `./_shared.js` import 了 `hasShortDramaGeneratingStatus`（`readShortDramaProjectState` 已 import）。若无需补：

```ts
import {
  assertShortDramaProjectAccess,
  readShortDramaProjectState,
  hasShortDramaGeneratingStatus,
  syncShortDramaSegmentsFromState,
} from './_shared.js'
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter @aigc/api build`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/short-drama/put-project-id.ts
git commit -m "fix(short-drama): put-project 生成中拒绝前端 state 覆盖

前端 SWR state 可能落后于数据库，PUT 整份 state 会抹掉 generating 标记，
造成「状态丢失 + 锁仍在」不一致。库内任一 generating 时返回 409 提示刷新。"
```

---

## Task 4：C-1 api.ts 区分「后台生成中 / 真失败」三态

**Files:**
- Modify: `apps/web/src/lib/short-drama/api.ts`（定义 error 类、改造 throw、清理诊断日志）

- [ ] **Step 1: 定义 ShortDramaStillGeneratingError 并导出**

在 `ShortDramaSseError` 类定义之后（约 api.ts:114 后）新增：

```ts
/**
 * SSE 断线回查后判定「后台仍在生成中」。
 * 与「真失败」区分：组件 catch 命中本类时应保持 loading、不报错、不显示重试，
 * 交给 server-generating 状态的既有轮询自愈。
 */
export class ShortDramaStillGeneratingError extends Error {
  constructor(message = '生成仍在进行中，请稍后刷新页面查看结果') {
    super(message)
    this.name = 'ShortDramaStillGeneratingError'
  }
}
```

- [ ] **Step 2: postShortDramaSSE catch 改造（区分三态 + 清理诊断日志）**

把之前临时加的 `[sd-sse-debug]` 日志移除，并把 still-generating 改成抛 `ShortDramaStillGeneratingError`：

```ts
  try {
    return await consumeShortDramaSSE<T>(res, options)
  } catch (err) {
    // 后端主动 error 事件（业务明确失败）：直接抛出，不回查
    if (err instanceof ShortDramaSseError) throw err
    // 其余（网络中断/连接被代理掐断）：回查项目状态兜底，避免误报 network error
    if (projectId && isGenerating) {
      const recovery = await recoverShortDramaStream<T>(projectId, isGenerating)
      if (recovery.kind === 'success') return recovery.data
      // 三态区分：真失败抛普通 Error（组件显示重试）；后台仍生成抛专用 error（组件保持 loading）
      throw recovery.kind === 'failed'
        ? new Error('生成失败，请稍后重试')
        : new ShortDramaStillGeneratingError()
    }
    throw err
  }
```

- [ ] **Step 3: 移除 recoverShortDramaStream 内的临时诊断日志**

删除之前加的 3 处 `console.warn('[sd-sse-debug] ...')`（回查失败、回查成功两处），恢复 catch 为 `catch {`（不捕获 err，因为不再记录）。最终 recoverShortDramaStream 回到无日志形态：

```ts
    try {
      project = await getShortDramaProject(projectId)
    } catch {
      // 回查请求本身失败：无法判断，按「仍在生成」处理，提示用户刷新
      return { kind: 'still-generating' }
    }

    if (project.status === 'failed') return { kind: 'failed' }
    if (!isGenerating(project)) {
      return { kind: 'success', data: { success: true, state: project.state } as unknown as T }
    }
    // ...（其余不变）
```

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`（或 lint）
Expected: 通过，无 `[sd-sse-debug]` 残留（`grep -n "sd-sse-debug" apps/web/src` 应为空）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/short-drama/api.ts
git commit -m "feat(short-drama): SSE 回查区分后台生成中与真失败

still-generating 改抛 ShortDramaStillGeneratingError，让组件能区分三态，
不再把'后台仍在生成'误当失败渲染（重试按钮+非loading）。同时清理临时诊断日志。"
```

---

## Task 5：C-2 组件 catch 识别三态（保持 loading，不报错）

**Files:**
- Modify: `apps/web/src/components/short-drama/step-episodes.tsx:127-132`
- Modify: `apps/web/src/components/short-drama/step-script-outline.tsx`（handleGenerateOutlines / handleGenerateSummary / handleGenerateSummaries 三处 catch）

原则：catch 命中 `ShortDramaStillGeneratingError` 时——**不 setFailed/setError、不 toast、触发 onStateChange 让 server-generating 轮询接管**。本地 loading 由 finally 正常关闭，显示权交给 `state.xxx.status==='generating'` 的轮询态。

- [ ] **Step 5a: step-episodes.tsx**

import 区加：
```ts
import { ShortDramaStillGeneratingError } from '@/lib/short-drama/api'
```

`generateSelectedSegments` 的 catch（127-132）改为：

```ts
        } catch (err) {
          if (err instanceof ShortDramaStillGeneratingError) {
            // 后台仍在生成：不当失败，交给 episode.status==='generating' 的轮询自愈
            onStateChange()
            break
          }
          const message = translateError(err instanceof Error ? err.message : 'AI 生成失败，请稍后重试')
          setFailedEpisodeErrors(current => ({ ...current, [episodeNumber]: message }))
          toast.error(message)
          break
        }
```

- [ ] **Step 5b: step-script-outline.tsx**

import 区加：
```ts
import { ShortDramaStillGeneratingError } from '@/lib/short-drama/api'
```

`handleGenerateOutlines`（1151-1154）、`handleGenerateSummary`（1108-1112）、`handleGenerateSummaries`（1191-1194）三处 catch 统一加前置判断。以 `handleGenerateOutlines` 为例：

```ts
    } catch (err) {
      if (err instanceof ShortDramaStillGeneratingError) {
        // 后台仍在生成：不报错，交给 outlinesStatus==='generating' 的轮询自愈
        onStateChange()
        return
      }
      const errorMessage = translateError(err instanceof Error ? err.message : '生成失败')
      setOutlineErrorMessage(errorMessage)
      toast.error(errorMessage)
    } finally {
```

其余两处 catch 同构替换（错误字段分别是 `setSummaryErrorMessage` / `setOutlineErrorMessage`）。

- [ ] **Step 5c: 确认 server-generating loading 显示链路**

确认 `step-episodes` 的 `isServerGenerating`（已有，第 46-50 行）与 `step-script-outline` 是否在 `state.script.outlinesStatus==='generating'` 时显示 loading：
- step-episodes：已确认有 `isServerGenerating` 轮询与 loading 文案（220-227 行）。
- step-script-outline：确认其 JSX 中是否有「outlinesStatus==='generating' → 显示 loading」的分支；若**没有**，需补一个 loading 提示（避免本地 loading 关闭后用户看不到生成中）。补法：在生成按钮区域加 `{state.script.outlinesStatus === 'generating' && <Loader2 className="animate-spin" /> 第X-Y集生成中...}`（具体文案对齐既有 `isOutlinesGenerating` 变量）。

> 执行时先读 step-script-outline 顶部状态变量与 JSX，确认是否已有 server-generating loading；有则跳过 5c，无则补。

- [ ] **Step 5d: 验证编译 + lint**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 5e: Commit**

```bash
git add apps/web/src/components/short-drama/step-episodes.tsx apps/web/src/components/short-drama/step-script-outline.tsx
git commit -m "fix(short-drama): SSE 后台生成中保持 loading 不当失败

组件 catch 识别 ShortDramaStillGeneratingError：跳过错误态，触发 onStateChange
让 server-generating 轮询接管 loading 显示，消除'生成中却显示重试按钮'的矛盾。"
```

---

## Task 6（可选扩展）：step-assets 同模式接入

`generateShortDramaAssetPrompts` 同样走 SSE recovery（api.ts:427），`step-assets.tsx` 若有对应 catch，按 Task 5 同构改造。**本次用户问题集中在分集剧本/片段脚本，本任务列为可选**，执行时与用户确认是否纳入。

---

## Self-Review 结论

- **覆盖**：A（409 锁泄漏）→ Task 1；B（state 覆盖）→ Task 2+3；C（UI 矛盾）→ Task 4+5。三块均有对应。
- **定量**：锁 480s、保护 B1 均已落代码。
- **类型一致**：`hasShortDramaGeneratingStatus(state: ShortDramaState): boolean`、`ShortDramaStillGeneratingError` 在定义与使用处签名一致。
- **风险**：B 块整体拒绝可能在「生成卡死但 status 未更新为 failed」时误拒正常编辑——但这正是要避免的覆盖，可接受；后续若需更细可升级到 B2/B3。C 块依赖后端确实把 `xxx.status` 置为 generating（已确认各接口均设置），轮询链路（use-short-drama-project hasPendingWork）已存在。
