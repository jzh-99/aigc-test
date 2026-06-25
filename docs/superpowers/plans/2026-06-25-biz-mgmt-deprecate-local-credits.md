# Deprecate Local Credits → Business Management A-Bean Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底废弃本地积分系统（credit_accounts / credits_ledger / 成员配额 / payment 充值 / admin 充值），所有用户（团长与组员）的 A 豆余额、扣减、流水一律通过业管平台按 `biz_mgmt_user_id` 实时获取与扣减，生成链路硬切换为「业管扣减 + 创作结果 outbox」，本地不再维护任何积分。

**Architecture:** 本地 `users` 仍是登录主体，登录后强制选择业管会员身份（Task 1-10 已完成的基础设施）。付费生成前按当前选中的 `biz_mgmt_user_id` 调用业管余额接口实时校验、调用业管扣减接口扣费，扣减成功才创建任务并投递队列；worker 终态不再触碰本地 `credit_accounts`/`credits_ledger`，而是写 `biz_mgmt_outbox_events` 由 `biz-mgmt-notify-queue` 异步同步创作结果。充值改由业管订购接口承载；成员配额（credit_quota/credit_used）整套移除；开放接口（api_clients）也挂业管身份。前端余额展示统一指向 `/credits/biz-mgmt/balance`。

**Tech Stack:** Fastify 4、Kysely、PostgreSQL、Next.js 14 App Router、Zustand、SWR、BullMQ、pnpm。

---

## 前置条件（已完成）

以下由 `2026-06-25-biz-mgmt-member-account-selection.md` 的 Task 1-10 落地，本计划直接复用：

- 迁移 `073_biz_mgmt_member_bindings`（业管会员身份绑定缓存表）
- 迁移 `074_biz_mgmt_a_bean_transactions`（A 豆扣减审计表）
- 迁移 `075_biz_mgmt_outbox_events`（业管通知 outbox 表）
- `apps/api/src/services/biz-mgmt-member-sync.ts`（会员同步 + 首次初始化）
- `apps/api/src/services/biz-mgmt-a-bean.ts`（余额查询 / 流水查询 / 生成前扣减 `deductBizMgmtPointsForGeneration` / `getCurrentBizMgmtIdentity`）
- 登录编排 + 身份选择接口（`post-login.ts` / `post-select-biz-mgmt-member.ts`）
- 前端账号选择页 + auth-store 业管身份态
- `packages/types/src/api.ts` 已含 `BizMgmtMemberAccount` / `BizMgmtMemberSelectionResponse`
- `apps/api/src/routes/credits/get-biz-mgmt-balance.ts` / `get-biz-mgmt-ledger.ts`（只读余额/流水路由）

## 关键不变量（贯穿全计划）

1. **本地永不维护积分**：不新增/不读写 `credit_accounts.balance`、`frozen_credits`、`total_earned`、`total_spent`；不写 `credits_ledger`；不维护 `team_members.credit_quota` / `credit_used`。
2. **所有用户从业管获取**：余额、累计消费、累计获得一律实时从业管按当前选中 `biz_mgmt_user_id` 查询；前端余额统一走 `/credits/biz-mgmt/balance`。
3. **生成前扣减**：所有付费生成前必须 `deductBizMgmtPointsForGeneration`（实时余额校验 → 扣减），扣减成功才创建任务；失败不创建、不投递。
4. **worker 不碰本地积分**：worker 终态只更新 `tasks`/`task_batches` 状态 + 写 `biz_mgmt_outbox_events`；不再 confirm/refund 本地积分。
5. **通知走 outbox**：创作结果同步、会员副卡同步一律先写 `biz_mgmt_outbox_events` 再投 `biz-mgmt-notify-queue`；成功与失败记录都保留。
6. **A 豆不落本地**：`biz_mgmt_a_bean_transactions` 只记扣减审计；`biz_mgmt_member_bindings` 不存余额。

## 阻断性约束（必须先处理）

- `task_batches.credit_account_id` 当前 `NOT NULL` + FK→`credit_accounts(id)`。业管任务无本地账户，必须迁移改 nullable。
- `credits_ledger.credit_account_id` `NOT NULL` + FK。
- `credit_accounts` 在 `account-scope.ts`（每次登录）、`admin/post-teams.ts`（每建团队）、`provision-caller.ts`（开放接口）自动创建。

## Scope / 分阶段策略

本变更横跨「生成扣费迁移」「本地积分退役」「前端余额/配额 UI 迁移」三个子系统，按 **Phase A → B → C → D** 顺序推进，每个 Phase 产出可独立验证的软件。

---

## Files

**迁移 / schema：**
- Create: `packages/db/migrations/076_drop_local_credit_constraints.ts`
- Modify: `packages/db/src/schema.ts`

**API 生成路由（扣费硬切换）：**
- Modify: `apps/api/src/routes/generate/post-image.ts`（移除本地分支）
- Modify: `apps/api/src/routes/videos/post-generate.ts`
- Modify: `apps/api/src/routes/tts/post-generate.ts`
- Modify: `apps/api/src/routes/music/post-generate.ts`
- Modify: `apps/api/src/routes/music/post-voice-clones.ts`
- Modify: `apps/api/src/routes/avatar/post-generate.ts`
- Modify: `apps/api/src/routes/action-imitation/post-generate.ts`
- Modify: `apps/api/src/routes/short-drama/post-generate-segment-video.ts`
- Modify: `apps/api/src/routes/short-drama/post-generate-assets.ts`
- Modify: `apps/api/src/routes/short-drama/post-export-episode.ts`
- Modify: `apps/api/src/routes/short-drama/post-export-batch.ts`
- Modify: `apps/api/src/routes/short-drama/post-generate-segments.ts`
- Modify: `apps/api/src/routes/short-drama/post-script-summary.ts`
- Modify: `apps/api/src/routes/short-drama/post-asset-prompts.ts`
- Modify: `apps/api/src/routes/short-drama/post-episode-summaries.ts`
- Modify: `apps/api/src/routes/short-drama/post-episode-outlines.ts`
- Modify: `apps/api/src/routes/short-drama/_text-generation.ts`
- Modify: `apps/api/src/routes/canvas/post-canvases-asset-upload.ts`
- Modify: `apps/api/src/routes/canvas-agent/post-storyboard-split.ts`

**API 服务 / 队列类型：**
- Modify: `apps/api/src/services/credit.ts`（删除 freeze/confirm/refund，仅留空壳或删除）
- Modify: `apps/api/src/services/account-scope.ts`（移除 credit_accounts 创建）
- Modify: `apps/api/src/lib/provision-caller.ts`（开放接口挂业管身份）
- Modify: `packages/types/src/queue.ts`（creditAccountId 改可选，业管字段已加）

**API 业管 outbox 服务（创作结果 + 副卡）：**
- Create: `apps/api/src/services/biz-mgmt-outbox.ts`
- Modify: `apps/api/src/routes/teams/post-create-member.ts`
- Modify: `apps/api/src/routes/teams/post-batch-members.ts`
- Modify: `apps/api/src/routes/teams/post-invite-member.ts`

**API payment / admin / 配额退役：**
- Modify: `apps/api/src/routes/payment/post-create-order.ts`（转业管订购或废弃）
- Modify: `apps/api/src/routes/payment/post-notify.ts`
- Modify: `apps/api/src/routes/payment/get-ledger-balance.ts`（余额改业管）
- Modify: `apps/api/src/routes/admin/post-teams.ts`（移除 credit_accounts 初始化）
- Delete/Modify: `apps/api/src/routes/admin/post-teams-id-credits.ts`
- Modify: `apps/api/src/routes/admin/get-teams.ts` / `get-users.ts`（移除余额列）
- Modify: `apps/api/src/routes/teams/get-by-id.ts`（移除 credits 字段）
- Modify: 配额相关路由（post-create-member / post-invite-member / post-batch-members / patch-delete-member / patch-batch-quota / admin reset-credits / patch-teams-id-members-uid / get-teams-id-members）

**Worker：**
- Modify: `apps/worker/src/pipelines/complete.ts`（移除积分操作 + 写 outbox）
- Modify: `apps/worker/src/pipelines/fail.ts`（移除积分操作 + 写 outbox）
- Create: `apps/worker/src/lib/biz-mgmt-result-outbox.ts`
- Create: `apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts`
- Create: `apps/worker/src/lib/biz-mgmt-toby-client.ts`（worker 独立业管 client，不跨包 import api）
- Create: `apps/worker/src/workers/biz-mgmt-notify.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: 各 worker 内联积分逻辑（music / music-voice-clone / video-submit / short-drama-export / 3 个 poller）移除本地积分操作

**前端：**
- Modify: `apps/web/src/components/layout/credits-badge.tsx`
- Modify: `apps/web/src/components/layout/creative-side-rail.tsx`
- Modify: `apps/web/src/components/dashboard/stats-cards.tsx`
- Modify: `apps/web/src/app/(dashboard)/credits/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/generation/page.tsx`
- Modify: 成员管理 UI（member-list / invite / batch-invite / team-credits-settings / admin team-table / user-table / topup-dialog）
- Modify: `packages/types/src/api.ts`（CreditBalance 类型退役）

**测试：**
- Test: `apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sub-card-outbox.test.ts`
- Test: 各生成路由迁移后的契约测试

---

## Phase A：迁移放宽约束 + worker 创作结果 outbox 基建

### Task 1: 迁移放宽 task_batches.credit_account_id 为 nullable

**Files:**
- Create: `packages/db/migrations/076_drop_local_credit_constraints.ts`
- Modify: `packages/db/src/schema.ts:162`
- Test: `packages/db/src/biz-mgmt-nullable-credit-account.test.ts`

- [ ] **Step 1: 写迁移结构测试**

```ts
// packages/db/src/biz-mgmt-nullable-credit-account.test.ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('076_drop_local_credit_constraints migration', () => {
  test('makes task_batches.credit_account_id nullable', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/076_drop_local_credit_constraints.ts'),
      'utf8',
    )
    assert.match(source, /ALTER TABLE task_batches ALTER COLUMN credit_account_id DROP NOT NULL/)
    assert.match(source, /COMMENT ON COLUMN task_batches.credit_account_id/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test packages/db/src/biz-mgmt-nullable-credit-account.test.ts`
Expected: FAIL（迁移文件不存在）。

- [ ] **Step 3: 新增迁移**

```ts
// packages/db/migrations/076_drop_local_credit_constraints.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 业管身份任务无本地 credit_account，credit_account_id 必须允许为空。
  // FK 保留（为空的行不触发外键校验）；本地积分退役后历史行仍可关联。
  await sql`ALTER TABLE task_batches ALTER COLUMN credit_account_id DROP NOT NULL`.execute(db)
  await sql`COMMENT ON COLUMN task_batches.credit_account_id IS '本地积分账户 ID，关联 credit_accounts.id。业管身份任务（biz_mgmt 计费）为 NULL；本地积分退役后仅历史行有值。新生成任务一律为 NULL，计费权威在 biz_mgmt_a_bean_transactions。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE task_batches SET credit_account_id = (SELECT id FROM credit_accounts LIMIT 1) WHERE credit_account_id IS NULL`.execute(db)
  await sql`ALTER TABLE task_batches ALTER COLUMN credit_account_id SET NOT NULL`.execute(db)
}
```

- [ ] **Step 4: 扩展 schema 类型**

```ts
// packages/db/src/schema.ts —— TaskBatchesTable.credit_account_id 改为可空
credit_account_id: string | null
```

- [ ] **Step 5: 编译并运行测试**

Run: `pnpm --filter @aigc/db build && node --test packages/db/src/biz-mgmt-nullable-credit-account.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/db/migrations/076_drop_local_credit_constraints.ts packages/db/src/schema.ts packages/db/src/biz-mgmt-nullable-credit-account.test.ts
git commit -m "feat: make task_batches.credit_account_id nullable for biz-mgmt tasks"
```

---

### Task 2: worker 业管 toby client（独立，不跨包 import api）

**Files:**
- Create: `apps/worker/src/lib/biz-mgmt-toby-client.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-toby-client.test.ts`

按冲突 5 决议：worker 不 import `apps/api/src/lib/toby-open-api.js`，在 worker 内复制一份业管外部接口 client（仅创作结果同步 + 会员副卡同步两个包装），避免循环依赖。

- [ ] **Step 1: 写 client 结构测试**

```ts
// apps/worker/src/__tests__/biz-mgmt-toby-client.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyBizMgmtCreationResult,
  syncBizMgmtMemberSubCard,
} from '../lib/biz-mgmt-toby-client.js'

test('worker biz-mgmt toby client exports notify and sync functions', () => {
  assert.equal(typeof notifyBizMgmtCreationResult, 'function')
  assert.equal(typeof syncBizMgmtMemberSubCard, 'function')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-toby-client.test.ts`
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 实现 worker 独立业管 client**

复制 `apps/api/src/lib/toby-open-api.ts` 中**仅**创作结果同步与会员副卡同步所需的最小子集（加解密、签名、`callTobyApi`、两个包装）。不要 import api 包。

```ts
// apps/worker/src/lib/biz-mgmt-toby-client.ts
// worker 独立的业管外部接口 client。仅含创作结果同步、会员副卡同步两个包装，
// 复制自 apps/api/src/lib/toby-open-api.ts 的加解密/签名/调用骨架，不跨包 import api，
// 避免 worker → api 循环依赖。加解密逻辑必须与 api 侧保持一致。
import crypto from 'node:crypto'
import CryptoJS from 'crypto-js'

// ── 与 apps/api/src/lib/toby-open-api.ts 完全一致的加解密常量与逻辑 ──
const DES_IV = '12345678'
const SIGNATURE_VALID_SECONDS = Number(process.env.TOBY_SIGNATURE_VALID_SECONDS ?? 600)

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getTobyConfig() {
  return {
    baseUrl: getRequiredEnv('TOBY_BASE_URL').replace(/\/$/, ''),
    appId: getRequiredEnv('TOBY_APP_ID'),
    appSecret: getRequiredEnv('TOBY_APP_SECRET'),
    privateKey: getRequiredEnv('TOBY_PRIVATE_KEY'),
  }
}

function getDesKey(privateKey: string): Buffer {
  const key = Buffer.from(privateKey, 'utf8')
  if (key.length < 8) throw new Error('TOBY_PRIVATE_KEY must be at least 8 bytes')
  return key.subarray(0, 8)
}

export function createTobySignature(timestamp: string, serviceCode: string): string {
  const { appId, appSecret } = getTobyConfig()
  const sortedForm = [
    ['appID', appId], ['appSecret', appSecret], ['serviceCode', serviceCode], ['timestamp', timestamp],
  ].map(([k, v]) => `${k}=${v}`).join('&')
  return crypto.createHash('md5').update(sortedForm, 'utf8').digest('hex')
}

export function encryptTobyJson(payload: object): string {
  const { privateKey } = getTobyConfig()
  const key = CryptoJS.enc.Latin1.parse(getDesKey(privateKey).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  return CryptoJS.DES.encrypt(JSON.stringify(payload), key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString()
}

export function decryptTobyJson<T extends object>(encryptedValue: string): T {
  const { privateKey } = getTobyConfig()
  const key = CryptoJS.enc.Latin1.parse(getDesKey(privateKey).toString('latin1'))
  const iv = CryptoJS.enc.Utf8.parse(DES_IV)
  const text = CryptoJS.DES.decrypt(encryptedValue, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8)
  if (!text) throw new Error('Toby 加密报文解密失败')
  return JSON.parse(text) as T
}

export interface TobyApiResponse<T = unknown> {
  code: string
  message: string
  data?: unknown
  decryptedData?: T
}

// worker 侧通知仅需成功即可，不做响应验签回查（与 api 侧 callTobyApi 行为一致）
async function callTobyApi<T extends object>(
  path: string,
  serviceCode: string,
  payload: object,
): Promise<TobyApiResponse<T>> {
  const { baseUrl, appId } = getTobyConfig()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestPayload = { ...payload, appID: appId, timestamp, serviceCode, signature: createTobySignature(timestamp, serviceCode) }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appID: appId, requestJson: encryptTobyJson(requestPayload) }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Toby 接口请求失败：${response.status}`)
    const body = (await response.json()) as TobyApiResponse<T>
    return body
  } finally {
    clearTimeout(timer)
  }
}

export interface BizMgmtCreationResultRequest {
  userId: string
  requestNo: string
  workNo: string
  success: boolean
  remark?: string
}

export interface BizMgmtMemberSubCardRequest {
  phone: string
  userName: string
  compName: string
  channel: string
  belongId: string
  initialPointsNum: number | string
}

// 创作结果同步 → AIHUB_CREATION_RESULT_NOTIFY
export function notifyBizMgmtCreationResult(payload: BizMgmtCreationResultRequest) {
  return callTobyApi('/api/toby/points/external/result-notify', 'AIHUB_CREATION_RESULT_NOTIFY', payload)
}

// 会员副卡同步 → MEMBER-1002
export function syncBizMgmtMemberSubCard(payload: BizMgmtMemberSubCardRequest) {
  return callTobyApi('/api/toby/member/sub-card', 'MEMBER-1002', payload)
}
```

- [ ] **Step 4: 安装 worker 缺失依赖（crypto-js）并编译测试**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-toby-client.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/lib/biz-mgmt-toby-client.ts apps/worker/src/__tests__/biz-mgmt-toby-client.test.ts
git commit -m "feat: add worker-side biz-mgmt toby client"
```

---

### Task 3: worker 创作结果 outbox 构造 + 入队

**Files:**
- Create: `apps/worker/src/lib/biz-mgmt-result-outbox.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts`

- [ ] **Step 1: 写结果同步测试**

```ts
// apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBizMgmtCreationResultRemark, buildCreationResultOutboxPayload } from '../lib/biz-mgmt-result-outbox.js'

test('creation result remark is bounded to 500 chars', () => {
  const remark = buildBizMgmtCreationResultRemark({ status: 'failed', module: 'image', message: 'x'.repeat(1000) })
  assert.equal(remark.length <= 500, true)
  assert.match(remark, /image/)
})

test('creation result outbox payload contains task and billing context', () => {
  const event = buildCreationResultOutboxPayload({
    localUserId: 'user-1', bizMgmtUserId: 'biz-user-1', teamId: 'team-1', workspaceId: 'workspace-1',
    batchId: 'batch-1', taskId: 'task-1', taskStatus: 'completed', pointsNum: 12,
    requestNo: 'bizmgmt-batch-1-task-1', workNo: 'task-1', success: true,
  })
  assert.equal(event.eventType, 'creation_result_notify')
  assert.equal(event.dedupeKey, 'creation-result:bizmgmt-batch-1-task-1')
  assert.equal(event.payload.success, true)
  assert.equal(event.pointsNum, 12)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-creation-result-sync.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 outbox 构造 + 入队**

```ts
// apps/worker/src/lib/biz-mgmt-result-outbox.ts
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

// 创作结果 remark 控制在业管接口要求的 500 字内
export function buildBizMgmtCreationResultRemark(input: {
  status: 'completed' | 'failed'
  module?: string | null
  message?: string | null
}): string {
  const prefix = input.status === 'completed' ? '创作成功' : '创作失败'
  return `${prefix}${input.module ? `：${input.module}` : ''}${input.message ? `，${input.message}` : ''}`.slice(0, 500)
}

export function buildCreationResultOutboxPayload(input: {
  localUserId: string
  bizMgmtUserId: string
  teamId: string
  workspaceId?: string | null
  batchId: string
  taskId: string
  taskStatus: 'completed' | 'failed'
  pointsNum: number
  requestNo: string
  workNo: string
  module?: string | null
  message?: string | null
}) {
  const remark = buildBizMgmtCreationResultRemark({
    status: input.taskStatus,
    module: input.module,
    message: input.message,
  })
  return {
    eventType: 'creation_result_notify' as const,
    dedupeKey: `creation-result:${input.requestNo}`,
    localUserId: input.localUserId,
    bizMgmtUserId: input.bizMgmtUserId,
    teamId: input.teamId,
    workspaceId: input.workspaceId ?? null,
    batchId: input.batchId,
    taskId: input.taskId,
    taskStatus: input.taskStatus,
    pointsNum: input.pointsNum,
    payload: {
      userId: input.bizMgmtUserId,
      requestNo: input.requestNo,
      workNo: input.workNo,
      success: input.taskStatus === 'completed',
      remark,
    },
  }
}

// 幂等写入 outbox：dedupe_key 冲突 doNothing，重复终态不重复入队
export async function enqueueCreationResultOutbox(
  input: ReturnType<typeof buildCreationResultOutboxPayload>,
): Promise<void> {
  const db = getDb()
  await db
    .insertInto('biz_mgmt_outbox_events')
    .values({
      event_type: input.eventType,
      dedupe_key: input.dedupeKey,
      local_user_id: input.localUserId,
      biz_mgmt_user_id: input.bizMgmtUserId,
      team_id: input.teamId,
      workspace_id: input.workspaceId,
      task_id: input.taskId,
      batch_id: input.batchId,
      task_status: input.taskStatus,
      points_num: String(input.pointsNum),
      payload: sql`${JSON.stringify(input.payload)}::jsonb`,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute()
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-creation-result-sync.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/lib/biz-mgmt-result-outbox.ts apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts
git commit -m "feat: build business management creation result outbox events"
```

---

### Task 4: worker outbox 派发 + biz-mgmt-notify worker

**Files:**
- Create: `apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts`
- Create: `apps/worker/src/workers/biz-mgmt-notify.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts`

- [ ] **Step 1: 写派发逻辑测试（指数退避）**

```ts
// apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBizMgmtOutboxNextAttempt } from '../lib/biz-mgmt-outbox-dispatch.js'

test('next attempt follows exponential backoff in minutes', () => {
  const minutes = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000)
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(1)), 5)   // 1→5m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(2)), 15)  // 2→15m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(7)), 1440) // 上限 1 天
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-outbox-dispatch.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现派发逻辑**

```ts
// apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { notifyBizMgmtCreationResult, syncBizMgmtMemberSubCard } from './biz-mgmt-toby-client.js'

// 指数退避：1m,5m,15m,60m,360m,720m,1440m,1440m（attemptCount 已是「本次尝试后」的次数）
export function computeBizMgmtOutboxNextAttempt(attemptCount: number): Date {
  const minutes = [1, 5, 15, 60, 360, 720, 1440, 1440][Math.min(attemptCount, 7)]
  return new Date(Date.now() + minutes * 60_000)
}

// 派发单个 outbox 事件：领取(processing)→调业管→成功(succeeded) / 失败(退避重试或 failed)
export async function dispatchBizMgmtOutboxEvent(eventId: string): Promise<void> {
  const db = getDb()
  const event = await db.selectFrom('biz_mgmt_outbox_events').selectAll().where('id', '=', eventId).executeTakeFirst()
  if (!event || event.status === 'succeeded' || event.status === 'failed') return

  // 领取：attempt_count+1，置 processing 并加锁
  await db.updateTable('biz_mgmt_outbox_events')
    .set({ status: 'processing', locked_at: new Date(), locked_by: 'biz-mgmt-notify', attempt_count: sql`attempt_count + 1`, updated_at: new Date() })
    .where('id', '=', eventId).execute()

  const maxAttempts = Number(event.max_attempts ?? 8)
  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    // 按 event_type 分派到对应业管接口
    const response = event.event_type === 'creation_result_notify'
      ? await notifyBizMgmtCreationResult(payload)
      : await syncBizMgmtMemberSubCard(payload)

    if (response.code !== '0000') throw new Error(response.message || '业管通知失败')

    // 成功：记录响应、清空错误、置 succeeded，保留成功记录不删除
    await db.updateTable('biz_mgmt_outbox_events')
      .set({ status: 'succeeded', last_response: sql`${JSON.stringify(response)}::jsonb`, last_error: null, sent_at: new Date(), updated_at: new Date() })
      .where('id', '=', eventId).execute()
  } catch (err) {
    const nextAttemptCount = Number(event.attempt_count ?? 0) + 1
    const exhausted = nextAttemptCount >= maxAttempts
    await db.updateTable('biz_mgmt_outbox_events')
      .set({
        status: exhausted ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
        next_attempt_at: computeBizMgmtOutboxNextAttempt(nextAttemptCount),
        updated_at: new Date(),
      })
      .where('id', '=', eventId).execute()
    // 未耗尽重试次数时抛错，触发 BullMQ 重试
    if (!exhausted) throw err
  }
}
```

- [ ] **Step 4: 实现 notify worker 并注册**

```ts
// apps/worker/src/workers/biz-mgmt-notify.ts
import { Worker } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'
import { dispatchBizMgmtOutboxEvent } from '../lib/biz-mgmt-outbox-dispatch.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

// biz-mgmt-notify-queue：消费 outbox 事件并调业管接口，失败按指数退避重试
export function startBizMgmtNotifyWorker(): Worker {
  return new Worker(
    'biz-mgmt-notify-queue',
    async (job) => {
      await dispatchBizMgmtOutboxEvent(String(job.data.eventId))
    },
    {
      connection: getBullMQConnection(),
      ...DEFAULT_JOB_OPTIONS,
      // BullMQ 层重试与 outbox 表退避双保险：表内 next_attempt_at 控制下次可见，
      // BullMQ attempts 兜底网络抖动
      settings: { backoffStrategy: (attempts) => Math.min(60 * attempts, 3600) * 1000 },
    },
  ).on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'biz-mgmt-notify job failed (will retry or mark failed in outbox)')
  })
}
```

```ts
// apps/worker/src/index.ts —— 在其它 worker 注册处追加
import { startBizMgmtNotifyWorker } from './workers/biz-mgmt-notify.js'
// ... 在 startAllWorkers() 内：
startBizMgmtNotifyWorker()
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @aigc/worker exec node --import tsx --test src/__tests__/biz-mgmt-outbox-dispatch.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts apps/worker/src/workers/biz-mgmt-notify.ts apps/worker/src/index.ts apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts
git commit -m "feat: dispatch business management outbox events via notify worker"
```

---

## Phase B：生成扣费硬切换（API 侧）

> 每个 Task 把一个生成路由的 freeze/confirm/refund 替换为 `deductBizMgmtPointsForGeneration`，并把业管计费上下文（bizMgmtUserId/requestNo/workNo + workspaceId）透传到 jobData。统一模式见 Task 5。

### Task 5: post-image 移除本地分支，统一为业管扣减（参考模板）

**Files:**
- Modify: `apps/api/src/routes/generate/post-image.ts`

- [ ] **Step 1: 移除 freezeCredits/refundCredits 分支**

把 Task 10 引入的「bizMgmt identity 探测 + 本地 fallback」双分支改为单一业管扣减分支：
- 删除 `freezeCredits` 调用与 `getCurrentBizMgmtIdentity` try/catch 探测；直接 `deductBizMgmtPointsForGeneration`，无业管身份时 `deductBizMgmtPointsForGeneration` 内部 `getCurrentBizMgmtIdentity` 抛错 → 返回 402「请先选择业管会员身份」。
- `task_batches.credit_account_id` 传 `null`（迁移 076 已放宽）。
- batch 创建/入队失败不再 `refundCredits`（业管扣减失败时 audit 已记 failed，未成功扣减不会创建任务；成功扣减后若 batch 创建失败需写一条 outbox 或单独的退款——见下方说明）。

```ts
// apps/api/src/routes/generate/post-image.ts —— 扣费段替换为：
let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
try {
  // 所有用户统一走业管扣减：实时余额校验 → 扣减 → 成功后才创建任务
  const deduction = await deductBizMgmtPointsForGeneration({
    localUserId: userId,
    teamId,
    workspaceId,
    batchId: idempotency_key, // 扣减幂等号用 idempotency_key，批次级稳定
    pointsNum: totalCost,
    source: 1, // 来源值以业管文档为准，集中在此常量
    remark: `图片生成：${model}`,
  })
  bizMgmtBilling = deduction
} catch (err) {
  const msg = err instanceof Error ? err.message : '业管 A 豆扣减失败'
  logGenerateSubmissionError(app, { userId, errorCode: 'INSUFFICIENT_CREDITS', httpStatus: 402, detail: msg, model, canvasId: canvas_id })
  return reply.status(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: msg } })
}
```

task_batches 插入处 `credit_account_id: null`；jobData 携带 `workspaceId` + `bizMgmtDeductRequestNo/bizMgmtUserId/bizMgmtWorkNo`（Task 10 已加）。删除 `creditAccountId` 相关变量与 import `freezeCredits/refundCredits`（若该路由是最后引用，可保留 import 供其它路由过渡，但本路由不再调用）。

- [ ] **Step 2: 编译验证**

Run: `pnpm --filter @aigc/api build`
Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/routes/generate/post-image.ts
git commit -m "feat: image generation deducts only via business management a beans"
```

---

### Task 6-15: 其余生成路由批量迁移（统一模式）

每个路由重复 Task 5 的模式：把 `freezeCredits(...)` 替换为 `deductBizMgmtPointsForGeneration(...)`，`credit_account_id` 传 `null`，jobData 透传业管上下文。各路由的差异点：

| Task | 路由 | 关键差异 |
|---|---|---|
| 6 | `videos/post-generate.ts` | estimatedCredits 来自视频时长；jobData 加 workspaceId |
| 7 | `tts/post-generate.ts` | **同步流程**：删除 in-route `confirmCredits`，扣减即终态（无 confirm） |
| 8 | `music/post-generate.ts` | credits 来自 resolveMusicCredits；加 workspaceId |
| 9 | `music/post-voice-clones.ts` | 同上；清理上传音频逻辑保留 |
| 10 | `avatar/post-generate.ts` | **同步 + 内联退款**：删除 inline refund 事务，改业管扣减 |
| 11 | `action-imitation/post-generate.ts` | 同 avatar |
| 12 | `short-drama/post-generate-segment-video.ts` | 入队 video-submit，加 workspaceId |
| 13 | `short-drama/post-generate-assets.ts` | addBulk 图片，加 workspaceId |
| 14 | `short-drama/post-export-episode.ts` + `post-export-batch.ts` | 入队 short-drama-export |
| 15 | `short-drama/_text-generation.ts` + 5 个 SSE 路由 | `saveShortDramaStateAndSettleCredits` 改为：扣减用业管（扣实际预估），删除本地 confirm/refund；保留 short_drama_projects.state 写入 |

- [ ] **每个 Task 的统一步骤：**
1. 定位该路由的 `freezeCredits` 调用，替换为 `deductBizMgmtPointsForGeneration`。
2. `task_batches.credit_account_id` 改 `null`。
3. jobData 移除 `creditAccountId`（改可选，见 Task 16），加 `workspaceId` + 业管三字段。
4. 删除该路由的 `refundCredits`/`confirmCredits`/`safeRefundCredits` 调用（失败时不退本地积分；业管扣减失败则任务不创建）。
5. `pnpm --filter @aigc/api build` 编译通过。
6. 提交：`git commit -m "feat: <module> generation deducts via business management a beans"`。

> **短剧 SSE 退款说明**：短剧文本生成是流式、扣减在前。失败时不再本地退积分；改为写一条 `creation_result_notify(success=false)` outbox 由业管侧按需处理退款（业管收到失败通知后由业管退款）。`saveShortDramaStateAndSettleCredits` 只保留 `short_drama_projects.state` + `actual_credits` 写入，移除 credit_accounts/credits_ledger/team_members 操作。

- [ ] **零扣费路由**：`canvas/post-canvases-asset-upload.ts`、`canvas-agent/post-storyboard-split.ts`、`open-api/text.ts`——只需把 `credit_account_id` 占位查询删除、改传 `null`，不走业管扣减。

---

### Task 16: 队列类型 creditAccountId 改可选

**Files:**
- Modify: `packages/types/src/queue.ts`

- [ ] **Step 1: 把所有 JobData 的 creditAccountId 改可选**

```ts
// packages/types/src/queue.ts —— 所有 *JobData 接口的 creditAccountId: string → creditAccountId?: string | null
```

- [ ] **Step 2: 重新构建 types**

Run: `pnpm --filter @aigc/types build`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add packages/types/src/queue.ts
git commit -m "refactor: make creditAccountId optional in job data types"
```

---

## Phase C：worker 移除本地积分操作 + 写创作结果 outbox

### Task 17: complete.ts / fail.ts 移除积分操作并写 outbox

**Files:**
- Modify: `apps/worker/src/pipelines/complete.ts`
- Modify: `apps/worker/src/pipelines/fail.ts`

- [ ] **Step 1: complete.ts 移除 credit_accounts/credits_ledger/team_members 操作**

删除第 51-86 行（credit_accounts 冻结确认、team_members 调整、credits_ledger confirm）。保留 assets 插入、tasks 状态、task_batches 计数。事务提交后、SSE/回调前，若 jobData 携带业管上下文则写创作结果 outbox：

```ts
// complete.ts —— 事务后追加（仅业管任务）：
import { buildCreationResultOutboxPayload, enqueueCreationResultOutbox } from '../lib/biz-mgmt-result-outbox.js'

if (jobData.bizMgmtUserId && jobData.bizMgmtDeductRequestNo) {
  await enqueueCreationResultOutbox(buildCreationResultOutboxPayload({
    localUserId: userId,
    bizMgmtUserId: jobData.bizMgmtUserId,
    teamId,
    workspaceId: jobData.workspaceId ?? null,
    batchId,
    taskId,
    taskStatus: 'completed',
    pointsNum: actualCredits,
    requestNo: jobData.bizMgmtDeductRequestNo,
    workNo: jobData.bizMgmtWorkNo ?? taskId,
    module: 'image',
  }))
}
```

- [ ] **Step 2: fail.ts 同理移除积分操作并写失败 outbox**

删除第 45-75 行（credit_accounts/team_members/credits_ledger）。保留 tasks 状态、task_batches 计数。事务后写失败 outbox（success=false）。

- [ ] **Step 3: 编译**

Run: `pnpm --filter @aigc/worker build`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/worker/src/pipelines/complete.ts apps/worker/src/pipelines/fail.ts
git commit -m "feat: pipelines write biz-mgmt creation result outbox, drop local credits"
```

---

### Task 18: 各 worker 内联积分逻辑移除 + 写 outbox

**Files:**
- Modify: `workers/music.ts`, `workers/music-voice-clone.ts`, `workers/video-submit.ts`, `workers/short-drama-export.ts`, `pollers/video-poller.ts`, `pollers/avatar-poller.ts`, `pollers/action-imitation-poller.ts`

每个文件的 `confirmXxxCredits` / `failXxxJob` / `handleXxxSuccess` / `handleXxxFailure`：
- 删除 credit_accounts / credits_ledger / team_members 写操作。
- 保留 tasks 状态、task_batches 计数、各自业务表（music_tracks 等）状态。
- 终态后按 jobData（或 poller 从 DB 查出的 batch）业管上下文写创作结果 outbox。

- [ ] **每个文件统一步骤：**
1. 定位 confirm/refund 事务，删除积分三表操作。
2. 成功路径追加 `enqueueCreationResultOutbox(... success=true ...)`。
3. 失败路径追加 `enqueueCreationResultOutbox(... success=false ...)`。
4. poller 的业管上下文来源：jobData 已携带（video/avatar/action 走 video-submit 入队时透传）。
5. `pnpm --filter @aigc/worker build` 通过。
6. 提交。

- [ ] **开放接口零扣费 worker**（news/podcast/storybook）：estimatedCredits=0，credit_accounts 操作移除即可，不写 outbox（非业管计费）。

---

## Phase D：本地积分系统退役 + 前端迁移

### Task 19: payment 转业管订购

**Files:**
- Modify: `apps/api/src/routes/payment/post-create-order.ts`, `post-notify.ts`, `get-ledger-balance.ts`
- Modify: 前端 `topup-modal.tsx`, `credits/page.tsx`

- [ ] **充值改由业管订购接口**：`post-create-order` 调用业管 `SUBSCRIBE_SERVICE_CODE_1001`（已有 `syncTobySubscribe` 包装）；`post-notify` 不再写 credit_accounts.balance；余额查询 `get-ledger-balance` 的 balance 部分代理到业管 `MEMBER-1004`，ledger 代理到 `AIHUB_POINTS_CHANGE_QUERY`。
- 前端 topup 流程按业管订购回执调整；credits 页余额改 `/credits/biz-mgmt/balance`。

> 若业管订购回执流程需要额外 webhook，按业管文档补充；本计划以「充值由业管承载、本地不再写余额」为目标。

---

### Task 20: admin 充值/配额退役 + 团队/用户列表移除余额列

**Files:**
- Delete: `apps/api/src/routes/admin/post-teams-id-credits.ts`
- Modify: `admin/post-teams.ts`（移除 credit_accounts 初始化）, `admin/get-teams.ts`, `admin/get-users.ts`, `teams/get-by-id.ts`（移除 credits 字段）
- Modify: 配额路由（post-create-member / post-invite-member / post-batch-members / patch-delete-member / patch-batch-quota / admin reset-credits / patch-teams-id-members-uid / get-teams-id-members）移除 credit_quota/credit_used
- Modify: 前端 admin team-table / user-table / topup-dialog / member-list / invite / batch-invite / team-credits-settings

- [ ] 移除 credit_quota/credit_used 字段读写（schema 列保留以兼容历史，但不再读写、不再在 UI 展示）。
- [ ] admin 团队创建不再初始化 credit_accounts。
- [ ] 前端移除余额/配额展示列与充值/配额操作 UI。

---

### Task 21: account-scope / provision-caller 移除 credit_accounts 创建

**Files:**
- Modify: `apps/api/src/services/account-scope.ts`（删除 ensureTeamCreditAccount）
- Modify: `apps/api/src/lib/provision-caller.ts`（开放接口挂业管身份，删除 1e9 占位账户）

- [ ] `ensurePersonalAccountScope` 不再创建 credit_accounts。
- [ ] 开放接口 caller provisioning：改为关联业管身份（或保留独立计费策略，但不再用本地占位账户）。

---

### Task 22: 前端余额展示统一指向业管

**Files:**
- Modify: `credits-badge.tsx`, `creative-side-rail.tsx`, `stats-cards.tsx`, `credits/page.tsx`, `generation/page.tsx`

- [ ] 所有显示余额数字的组件改用 `GET /credits/biz-mgmt/balance`（SWR key 统一）。
- [ ] 移除 `credit_quota - credit_used` 分支逻辑与 `frozen_credits` 展示。
- [ ] generation 页 `mutate` 的 SWR key 改为业管余额 key。
- [ ] 退役 `CreditBalance` 类型。

---

### Task 23: member sub card outbox（团队创建成员后同步副卡）

**Files:**
- Create: `apps/api/src/services/biz-mgmt-outbox.ts`
- Modify: `apps/api/src/routes/teams/post-create-member.ts`, `post-batch-members.ts`, `post-invite-member.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sub-card-outbox.test.ts`

> 对应原计划 Task 12：团长创建成员后写 `member_sub_card_sync` outbox，由 notify worker 调 MEMBER-1002。配额退役后 `initialPointsNum` 固定为 0（或按表单字段）。

- [ ] 实现 `buildMemberSubCardOutboxPayload` + `enqueueBizMgmtOutboxEvent`（投 `biz-mgmt-notify-queue`）。
- [ ] 三个团队成员创建路由接入。
- [ ] 测试 + 提交。

---

### Task 24: 验证与回归

- [ ] `pnpm --filter @aigc/db build` + 全部 db 迁移测试 PASS。
- [ ] `pnpm --filter @aigc/api build` + 全部 api 测试 PASS。
- [ ] `pnpm --filter @aigc/worker build` + 全部 worker 测试 PASS。
- [ ] `pnpm --filter @aigc/types build` PASS。
- [ ] 前端 lint/类型检查（按 AGENTS.md 本地验证边界，不构建）。
- [ ] 全链路手工验收：登录选身份 → 余额实时查 → 生成扣减 → worker 终态 outbox → 业管同步成功/失败重试 → 充值走业管 → 成员创建同步副卡。
- [ ] 确认生成链路不再读写 credit_accounts / credits_ledger / team_members.credit_*。

---

## Self Review

- **Spec coverage**：覆盖所有生成路由扣费硬切换（image/video/tts/music/avatar/action-imitation/short-drama×6/canvas/open-api）、worker 全部终态管线移除本地积分 + 写 outbox、payment 转业管订购、admin/配额退役、前端余额统一业管、成员副卡 outbox。明确「本地永不维护积分」「所有用户从业管获取」。
- **Placeholder scan**：Phase B/C 的批量路由迁移给出统一模式与差异表，每个路由的差异点已列出，无「类似上面」占位；具体代码用 post-image 为模板展开。
- **Type consistency**：`credit_account_id` 统一 nullable、jobData `creditAccountId` 可选、业管三字段（bizMgmtUserId/bizMgmtDeductRequestNo/bizMgmtWorkNo）与 outbox payload 字段一致。
- **Scope check**：本变更横跨三子系统，按 Phase A→D 顺序推进，每 Phase 可独立验证。Phase A（outbox 基建）与现有 Task 1-10 基础设施衔接，不回滚已完成工作。
