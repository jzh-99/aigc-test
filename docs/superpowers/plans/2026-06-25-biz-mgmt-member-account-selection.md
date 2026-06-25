# Business Management Member Account Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地登录账号支持同手机号下多个业管会员身份，并在当前业管身份下完成 A 豆余额校验、A 豆扣减、A 豆流水查询、会员副卡通知和创作结果同步。

**Architecture:** 本地 `users` 继续作为登录主体，新增 `biz_mgmt_member_bindings` 作为业管会员身份缓存与本地 team/workspace 映射。只要用户用手机号完成本地登录，就必须无条件调用业管会员查询并刷新绑定列表，不能因为本地用户已存在而跳过；选择当前业管身份后，付费生成统一通过业管 A 豆余额接口实时校验，通过业管 A 豆扣减接口完成扣费。所有需要通知业管的平台事件，例如创作结果同步、会员副卡创建同步，都先写入 `biz_mgmt_outbox_events` 再进入队列异步投递，失败按退避策略重试并持久化失败上下文。

**Tech Stack:** Fastify 4、Kysely、PostgreSQL、Next.js 14 App Router、Zustand、SWR、pnpm。

---

## Scope

本计划处理会员身份缓存、首次初始化、本地密码登录后的身份选择、A 豆流水查询、A 豆余额实时校验、A 豆扣减、创作结果同步、会员副卡通知、业管通知 outbox 与重试队列。模型规格同步落库另起计划，避免把模型配置治理和登录计费闭环混在同一次变更里。

## Critical Login Invariant

- 本地 `users` 只决定密码校验和登录主体，不决定业管会员身份来源。
- 每次手机号密码登录成功后，都调用业管 `MEMBER-1001` 查询当前手机号的完整会员列表。
- 本地已有用户时，也必须刷新 `biz_mgmt_member_bindings`，以发现用户登录后在业管新增的管理账号或公司账号。
- 本地不存在用户时，必须先查业管；只有业管返回至少一个 `status=1` 的会员，才允许创建本地用户、团队、工作空间和一次性初始密码。
- 本地缓存中本次未从业管返回的绑定不能硬删除，只能标记为非当前可用或保留历史，避免业管临时异常导致本地权限被误删。

## A 豆权威数据约束

- 用户 A 豆余额、A 豆累计消费、A 豆累计获得不在本地维护，不新增本地余额字段、累计消费字段、累计获得字段，也不写入 `biz_mgmt_member_bindings`。
- `MEMBER-1001` 返回中的 `pointsNum`、`sumPointsNum`、`consumePointsNum` 只允许作为原始接口响应字段被解析或调试，不作为本地落库字段，不作为生成前余额判断依据，不作为前端账号选择页的权威余额展示。
- 付费使用大模型前必须基于当前选中的 `biz_mgmt_user_id` 调用业管“单独 A 豆余额获取接口”实时获取余额，再与本次预估消耗比较；余额不足则不创建生成任务。
- 生成前推荐顺序：读取当前选中业管身份 -> 调用单独 A 豆余额接口 -> 校验余额是否足够 -> 调用业管 A 豆扣减接口 -> 扣减成功后创建本地生成任务和队列任务。
- 当前代码中已有 `MEMBER-1004` 会员 A 豆余额查询、`AIHUB_POINTS_CHANGE_QUERY` A 豆流水查询、`AIHUB_POINTS_CHANGE` A 豆扣减、`AIHUB_CREATION_RESULT_NOTIFY` 创作结果同步包装；本计划以这些包装为协议层基础，在业务服务层补身份校验、幂等请求号、错误处理和生成链路接入。

## Biz Mgmt Outbox Invariant

- 所有“本地状态已经变化，需要通知业管”的接口都必须走 outbox，不允许在主业务事务提交后只做一次 fire-and-forget 调用。
- Outbox 覆盖本次范围：创作结果同步 `AIHUB_CREATION_RESULT_NOTIFY`、会员副卡创建同步 `MEMBER-1002`。后续订购同步、模型规格处理回执等同类通知也必须复用该机制。
- 业务事务内只负责写入 `biz_mgmt_outbox_events(status='pending')`；事务提交后投递 `biz-mgmt-notify-queue`。队列消费失败时按指数退避重试，达到最大次数后标记 `failed`，保留失败记录，不删除。
- 通知任务状态固定为 4 类：`pending`=待投递或等待下次重试，`processing`=队列 worker 已领取并正在调用业管，`succeeded`=业管返回成功且已记录成功响应，`failed`=超过最大重试次数或不可重试错误。成功记录也必须保留，不能删除或只写日志。
- 失败记录必须包含：本地用户 ID、业管会员 ID、手机号、团队 ID、工作空间 ID、任务 ID、批次 ID、任务状态、扣减 A 豆数、事件类型、幂等键、请求 payload、最近响应、最近错误、尝试次数、下一次重试时间。
- Outbox payload 是复杂 JSONB，迁移注释必须逐层说明不同 `event_type` 的字段含义；不能用一句“请求参数”带过。

## Documentation Invariant

- 任何新增表、字段、索引语义、外部字段映射都必须在迁移脚本中写清楚。PostgreSQL 表和字段必须使用 `COMMENT ON TABLE/COLUMN`，不能只依赖 TypeScript 类型名。
- 字段说明必须包含：业务含义、取值范围或枚举、单位、是否允许为空、数据权威来源、与外部接口字段的映射关系、缓存/快照刷新时机。
- `jsonb`、JSON 字符串、配置对象、数组对象等复杂字段必须逐层说明 key 的含义、类型、取值范围、默认值、嵌套结构、兼容策略；不能写成“扩展配置”“元数据”等一句话。
- 复杂模块代码注释必须覆盖关键函数、状态流转、幂等、重试、失败降级、外部系统边界；注释要解释“为什么这样做”，不是复述代码。

## Files

- Create: `packages/db/migrations/072_biz_mgmt_member_bindings.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/types/src/api.ts`
- Create: `apps/api/src/services/biz-mgmt-member-sync.ts`
- Modify: `apps/api/src/routes/auth/post-login.ts`
- Modify: `apps/api/src/services/user-profile.ts`
- Create: `apps/api/src/routes/auth/post-select-biz-mgmt-member.ts`
- Modify: `apps/api/src/routes/users/get-me.ts`
- Modify: `apps/web/src/stores/auth-store.ts`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/select-account/page.tsx`
- Create: `apps/web/src/components/auth/biz-mgmt-member-option-card.tsx`
- Create: `packages/db/migrations/073_biz_mgmt_a_bean_transactions.ts`
- Create: `packages/db/migrations/074_biz_mgmt_outbox_events.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `apps/api/src/services/biz-mgmt-a-bean.ts`
- Create: `apps/api/src/services/biz-mgmt-outbox.ts`
- Create: `apps/api/src/routes/credits/get-biz-mgmt-balance.ts`
- Create: `apps/api/src/routes/credits/get-biz-mgmt-ledger.ts`
- Modify: `apps/api/src/routes/generate/post-image.ts`
- Modify: `apps/api/src/routes/teams/post-create-member.ts`
- Modify: `apps/api/src/routes/teams/post-batch-members.ts`
- Modify: `apps/api/src/routes/teams/post-invite-member.ts`
- Modify: `apps/api/src/services/credit.ts`
- Modify: `apps/worker/src/pipelines/complete.ts`
- Modify: `apps/worker/src/pipelines/fail.ts`
- Create: `apps/worker/src/workers/biz-mgmt-notify.ts`
- Create: `apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `packages/types/src/queue.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sync.test.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts`

---

### Task 1: 新增业管会员绑定表

**Files:**
- Create: `packages/db/migrations/072_biz_mgmt_member_bindings.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/biz-mgmt-member-bindings-schema.test.ts`

- [ ] **Step 1: 写迁移结构测试**

```ts
// packages/db/src/biz-mgmt-member-bindings-schema.test.ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('072_biz_mgmt_member_bindings migration', () => {
  test('creates biz_mgmt_member_bindings with local user and team mapping', () => {
    const source = readFileSync(
      join(__dirname, '../migrations/072_biz_mgmt_member_bindings.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_member_bindings'\)/)
    assert.match(source, /addColumn\('local_user_id', 'uuid'/)
    assert.match(source, /addColumn\('biz_mgmt_user_id', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('team_id', 'uuid'/)
    assert.match(source, /addColumn\('workspace_id', 'uuid'/)
    assert.match(source, /addUniqueConstraint\('uq_biz_mgmt_member_bindings_biz_mgmt_user_id'/)
    assert.match(source, /COMMENT ON TABLE biz_mgmt_member_bindings/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_member_bindings\.biz_mgmt_user_id/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_member_bindings\.is_selected/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/db test -- biz-mgmt-member-bindings-schema`

Expected: FAIL，提示 migration 文件不存在。

- [ ] **Step 3: 新增迁移**

```ts
// packages/db/migrations/072_biz_mgmt_member_bindings.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_member_bindings')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('local_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('biz_mgmt_user_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('phone', 'varchar(20)', (col) => col.notNull())
    .addColumn('user_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('user_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('status', 'integer', (col) => col.notNull())
    .addColumn('comp_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('goods_id', 'varchar(64)')
    .addColumn('goods_name', 'varchar(255)')
    .addColumn('biz_mgmt_created_at', 'timestamptz')
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id'))
    .addColumn('is_selected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('last_synced_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_member_bindings_biz_mgmt_user_id', ['biz_mgmt_user_id'])
    .addUniqueConstraint('uq_biz_mgmt_member_bindings_user_team', ['local_user_id', 'team_id'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_member_bindings ADD CONSTRAINT chk_biz_mgmt_member_user_type CHECK (user_type IN ('1','2'))`.execute(db)
  await sql`ALTER TABLE biz_mgmt_member_bindings ADD CONSTRAINT chk_biz_mgmt_member_status CHECK (status IN (1,2,3))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_member_bindings_phone').on('biz_mgmt_member_bindings').column('phone').execute()
  await db.schema.createIndex('idx_biz_mgmt_member_bindings_local_user').on('biz_mgmt_member_bindings').column('local_user_id').execute()

  await sql`COMMENT ON TABLE biz_mgmt_member_bindings IS '业务管理平台会员身份绑定缓存表。每条记录表示一个业管会员身份与一个本地登录用户、本地团队、默认工作空间之间的映射；业管平台是会员、权益和 A 豆余额的权威来源，本表只做登录后身份选择、权益商品展示和本地资源归属映射，不保存 A 豆余额、累计获得或累计消费。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.id IS '本地绑定记录主键，UUID，由 PostgreSQL 自动生成；不暴露给业管平台。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.local_user_id IS '本地登录用户 ID，关联 users.id。一个本地手机号登录主体可以绑定多个业管会员身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.biz_mgmt_user_id IS '业务管理平台会员编号，来源于 MEMBER-1001 响应 members[].userId；全局唯一，是后续 A 豆扣减、流水查询、创作结果同步的会员主键。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.phone IS '会员手机号，来源于 MEMBER-1001 响应 members[].phone；用于每次本地手机号登录成功后刷新业管会员列表。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.user_name IS '业管会员名称，来源于 members[].userName；用于账号身份选择页展示，不作为权限判断依据。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.user_type IS '业管会员类型，来源于 members[].userType；取值 1=个人会员，2=公司会员。个人会员映射本地 personal 团队，公司会员映射本地 company_a 团队。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.status IS '业管会员状态，来源于 members[].status；取值 1=正常，2=冻结，3=删除。只有 status=1 的记录可被选择为当前身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.comp_name IS '公司名称或个人标识，来源于 members[].compName；个人会员通常为“个人”，公司会员为公司名称，用作团队名称优先来源。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.goods_id IS '最近一条已完成订购记录的商品 ID，来源于 members[].goodsId；用于展示当前权益，不作为本地计费权威。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.goods_name IS '最近一条已完成订购记录的商品名称，来源于 members[].goodsName；用于展示当前权益，不作为本地计费权威。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.biz_mgmt_created_at IS '业管会员注册时间，来源于 members[].createTime，格式 yyyy-MM-dd HH:mm:ss，入库为 timestamptz；为空表示业管未返回。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.team_id IS '该业管会员身份对应的本地团队 ID。个人会员创建个人团队，公司会员创建公司团队；用于本地资源、工作区和任务归属。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.workspace_id IS '该业管会员身份对应的默认本地工作空间 ID。用户选择身份后默认进入此工作空间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.is_selected IS '当前本地用户最近选择的业管会员身份标记。同一 local_user_id 理论上最多一条为 true；选择身份接口会先清空再设置。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.last_synced_at IS '最近一次从业管 MEMBER-1001 成功刷新该身份快照的时间；用于判断缓存新鲜度和排查同步问题。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.created_at IS '本地绑定记录创建时间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.updated_at IS '本地绑定记录最近更新时间，包括快照刷新、状态变化和身份选择相关更新。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_member_bindings').execute()
}
```

- [ ] **Step 4: 扩展 schema 类型**

```ts
// packages/db/src/schema.ts
export interface BizMgmtMemberBindingsTable {
  id: Generated<string>
  local_user_id: string
  biz_mgmt_user_id: string
  phone: string
  user_name: string
  user_type: '1' | '2'
  status: 1 | 2 | 3
  comp_name: string
  goods_id: string | null
  goods_name: string | null
  biz_mgmt_created_at: Timestamp | null
  team_id: string
  workspace_id: string
  is_selected: Generated<boolean>
  last_synced_at: Generated<Date>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

Add to `Database`:

```ts
biz_mgmt_member_bindings: BizMgmtMemberBindingsTable
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @aigc/db test -- biz-mgmt-member-bindings-schema`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/db/migrations/072_biz_mgmt_member_bindings.ts packages/db/src/schema.ts packages/db/src/biz-mgmt-member-bindings-schema.test.ts
git commit -m "feat: add business management member binding schema"
```

---

### Task 2: 增加 业管会员同步服务

**Files:**
- Create: `apps/api/src/services/biz-mgmt-member-sync.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sync.test.ts`

- [ ] **Step 1: 写同步服务测试**

```ts
// apps/api/src/__tests__/biz-mgmt-member-sync.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBizMgmtMember, pickDefaultBizMgmtMemberName } from '../services/biz-mgmt-member-sync.js'

test('normalizeBizMgmtMember keeps identity and entitlement fields only', () => {
  const result = normalizeBizMgmtMember({
    userId: 'AED8352BF32B429EAB0EE4C8295391BC',
    phone: '17714420972',
    userName: '个人账号',
    compName: '个人',
    userType: '1',
    status: 1,
    pointsNum: 500,
    sumPointsNum: 800,
    consumePointsNum: 0,
    goodsId: 'TOBYAI000009',
    goodsName: '随心选兑换',
    createTime: '2026-06-23 14:08:10',
  })

  assert.equal(result.bizMgmtUserId, 'AED8352BF32B429EAB0EE4C8295391BC')
  assert.equal(result.userType, '1')
  assert.equal(result.teamName, '个人账号')
  assert.equal('pointsNum' in result, false)
  assert.equal('sumPointsNum' in result, false)
  assert.equal('consumePointsNum' in result, false)
})

test('company member team name prefers compName', () => {
  assert.equal(pickDefaultBizMgmtMemberName({ userName: '吃瓜', compName: '牛奶', userType: '2' }), '牛奶')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sync`

Expected: FAIL，提示服务文件不存在。

- [ ] **Step 3: 实现标准化函数和同步骨架**

```ts
// apps/api/src/services/biz-mgmt-member-sync.ts
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { queryTobyMemberLoginInfo } from '../lib/toby-open-api.js'

export interface RawBizMgmtMember {
  userId: string
  phone: string
  userName: string
  compName: string
  userType: '1' | '2' | string
  status: number
  pointsNum?: number | null
  sumPointsNum?: number | null
  consumePointsNum?: number | null
  goodsId?: string | null
  goodsName?: string | null
  createTime?: string | null
}

export interface NormalizedBizMgmtMember {
  bizMgmtUserId: string
  phone: string
  userName: string
  compName: string
  userType: '1' | '2'
  status: 1 | 2 | 3
  goodsId: string | null
  goodsName: string | null
  bizMgmtCreatedAt: string | null
  teamName: string
}

export function pickDefaultBizMgmtMemberName(input: { userName: string; compName: string; userType: string }): string {
  if (input.userType === '2' && input.compName.trim()) return input.compName.trim()
  return input.userName.trim() || input.compName.trim() || '业管账号'
}

export function normalizeBizMgmtMember(member: RawBizMgmtMember): NormalizedBizMgmtMember {
  if (member.userType !== '1' && member.userType !== '2') throw new Error(`未知会员类型：${member.userType}`)
  if (member.status !== 1 && member.status !== 2 && member.status !== 3) throw new Error(`未知会员状态：${member.status}`)
  return {
    bizMgmtUserId: member.userId,
    phone: member.phone,
    userName: member.userName,
    compName: member.compName,
    userType: member.userType,
    status: member.status,
    goodsId: member.goodsId ?? null,
    goodsName: member.goodsName ?? null,
    bizMgmtCreatedAt: member.createTime ?? null,
    teamName: pickDefaultBizMgmtMemberName(member),
  }
}

export function generateOneTimePassword(): string {
  return `Biz-${crypto.randomBytes(4).toString('hex')}`
}

export async function fetchBizMgmtMembersByPhone(phone: string): Promise<NormalizedBizMgmtMember[]> {
  const response = await queryTobyMemberLoginInfo({ phone })
  const members = (response.decryptedData as { members?: RawBizMgmtMember[] } | undefined)?.members ?? []
  // MEMBER-1001 返回的 pointsNum/sumPointsNum/consumePointsNum 属于业管实时权益数据。
  // 本服务只同步身份和权益商品信息，不能把 A 豆余额或累计消费落入本地库；
  // 付费生成前必须调用单独的 A 豆余额接口重新获取余额。
  return members.map(normalizeBizMgmtMember).filter((member) => member.status === 1)
}

export async function ensureLocalUserForBizMgmtPhone(phone: string): Promise<{ userId: string; oneTimePassword: string | null; members: NormalizedBizMgmtMember[] }> {
  const db = getDb()
  const existing = await db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirst()
  const members = await fetchBizMgmtMembersByPhone(phone)
  if (members.length === 0) throw new Error('业管平台未查询到可用会员')
  if (existing) return { userId: existing.id, oneTimePassword: null, members }

  const oneTimePassword = generateOneTimePassword()
  const passwordHash = await bcrypt.hash(oneTimePassword, 10)
  const user = await db
    .insertInto('users')
    .values({
      account: phone,
      phone,
      email: null,
      username: phone,
      password_hash: passwordHash,
      role: 'member',
      status: 'active',
      plan_tier: 'free',
      password_change_required: true,
      generation_defaults: JSON.stringify({}),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return { userId: user.id, oneTimePassword, members }
}
```

- [ ] **Step 4: 运行服务测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sync`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/biz-mgmt-member-sync.ts apps/api/src/__tests__/biz-mgmt-member-sync.test.ts
git commit -m "feat: normalize business management member sync data"
```

---

### Task 3: 同步会员并初始化 team/workspace

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-member-sync.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sync.test.ts`

- [ ] **Step 1: 补充集成行为测试**

```ts
// apps/api/src/__tests__/biz-mgmt-member-sync.test.ts
test('syncBizMgmtMembersForLocalUser is exported for login orchestration', async () => {
  const mod = await import('../services/biz-mgmt-member-sync.js')
  assert.equal(typeof mod.syncBizMgmtMembersForLocalUser, 'function')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sync`

Expected: FAIL，提示 `syncBizMgmtMembersForLocalUser` 不是函数。

- [ ] **Step 3: 实现同步函数**

```ts
// apps/api/src/services/biz-mgmt-member-sync.ts
export async function syncBizMgmtMembersForLocalUser(localUserId: string, phone: string): Promise<NormalizedBizMgmtMember[]> {
  const db = getDb()
  const members = await fetchBizMgmtMembersByPhone(phone)

  await db.transaction().execute(async (trx) => {
    for (const member of members) {
      const existingBinding = await trx
        .selectFrom('biz_mgmt_member_bindings')
        .select(['id', 'team_id', 'workspace_id'])
        .where('biz_mgmt_user_id', '=', member.bizMgmtUserId)
        .executeTakeFirst()

      let teamId = existingBinding?.team_id
      let workspaceId = existingBinding?.workspace_id

      if (!teamId) {
        const team = await trx
          .insertInto('teams')
          .values({
            name: member.teamName,
            owner_id: localUserId,
            plan_tier: 'free',
            team_type: member.userType === '1' ? 'personal' : 'company_a',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        teamId = team.id

        await trx.insertInto('team_members').values({ team_id: teamId, user_id: localUserId, role: 'owner' }).execute()
        await trx.insertInto('credit_accounts').values({ owner_type: 'team', team_id: teamId, balance: 0, frozen_credits: 0, total_earned: 0, total_spent: 0 }).execute()
      }

      if (!workspaceId) {
        const workspace = await trx
          .insertInto('workspaces')
          .values({ team_id: teamId, name: '默认工作区', description: null, created_by: localUserId })
          .returning('id')
          .executeTakeFirstOrThrow()
        workspaceId = workspace.id

        await trx.insertInto('workspace_members').values({ workspace_id: workspaceId, user_id: localUserId, role: 'admin' }).execute()
      }

      await trx
        .insertInto('biz_mgmt_member_bindings')
        .values({
          local_user_id: localUserId,
          biz_mgmt_user_id: member.bizMgmtUserId,
          phone: member.phone,
          user_name: member.userName,
          user_type: member.userType,
          status: member.status,
          comp_name: member.compName,
          goods_id: member.goodsId,
          goods_name: member.goodsName,
          biz_mgmt_created_at: member.bizMgmtCreatedAt ? sql`${member.bizMgmtCreatedAt}::timestamptz` : null,
          team_id: teamId,
          workspace_id: workspaceId,
          last_synced_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .onConflict((oc) => oc.column('biz_mgmt_user_id').doUpdateSet({
          local_user_id: localUserId,
          phone: member.phone,
          user_name: member.userName,
          user_type: member.userType,
          status: member.status,
          comp_name: member.compName,
          goods_id: member.goodsId,
          goods_name: member.goodsName,
          team_id: teamId,
          workspace_id: workspaceId,
          last_synced_at: sql`now()`,
          updated_at: sql`now()`,
        }))
        .execute()
    }

    if (members.length > 0) {
      await trx
        .updateTable('biz_mgmt_member_bindings')
        .set({ status: 2, updated_at: sql`now()` })
        .where('local_user_id', '=', localUserId)
        .where('biz_mgmt_user_id', 'not in', members.map((member) => member.bizMgmtUserId))
        .execute()
    }
  })

  return members
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sync`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/biz-mgmt-member-sync.ts apps/api/src/__tests__/biz-mgmt-member-sync.test.ts
git commit -m "feat: sync business management members into local scopes"
```

---

### Task 4: 登录接口接入首次初始化和身份选择标记

**Files:**
- Modify: `apps/api/src/routes/auth/post-login.ts`
- Modify: `apps/api/src/services/user-profile.ts`
- Modify: `packages/types/src/api.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts`

- [ ] **Step 1: 写路由契约测试**

```ts
// apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('login route always syncs business management members after local password login', () => {
  const source = readFileSync('apps/api/src/routes/auth/post-login.ts', 'utf8')
  assert.match(source, /syncBizMgmtMembersForLocalUser/)
  assert.match(source, /ensureLocalUserForBizMgmtPhone/)
  assert.match(source, /每次手机号密码登录成功后都刷新业管会员/)
})

test('user profile selects business management bindings', () => {
  const source = readFileSync('apps/api/src/services/user-profile.ts', 'utf8')
  assert.match(source, /biz_mgmt_member_bindings/)
  assert.match(source, /require_biz_mgmt_member_selection/)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-selection-routes`

Expected: FAIL。

- [ ] **Step 3: 扩展 API 类型**

```ts
// packages/types/src/api.ts
export interface BizMgmtMemberAccount {
  biz_mgmt_user_id: string
  bizMgmtUserId: string
  team_id: string
  teamId: string
  workspace_id: string
  workspaceId: string
  user_name: string
  userName: string
  user_type: '1' | '2'
  userType: '1' | '2'
  comp_name: string
  compName: string
  goods_id: string | null
  goodsId: string | null
  goods_name: string | null
  goodsName: string | null
  is_selected: boolean
  isSelected: boolean
}
```

Add to `UserProfile`:

```ts
biz_mgmt_members?: BizMgmtMemberAccount[]
bizMgmtMembers?: BizMgmtMemberAccount[]
require_biz_mgmt_member_selection?: boolean
requireBizMgmtMemberSelection?: boolean
current_biz_mgmt_user_id?: string | null
currentBizMgmtUserId?: string | null
```

- [ ] **Step 4: 修改 profile 组装**

```ts
// apps/api/src/services/user-profile.ts
// 在 buildUserProfile 查询 teams/workspaces 后追加：
const bizMgmtRows = await db
  .selectFrom('biz_mgmt_member_bindings')
  .select([
    'biz_mgmt_user_id',
    'team_id',
    'workspace_id',
    'user_name',
    'user_type',
    'comp_name',
    'goods_id',
    'goods_name',
    'is_selected',
  ])
  .where('local_user_id', '=', userId)
  .where('status', '=', 1)
  .orderBy('user_type', 'asc')
  .orderBy('created_at', 'asc')
  .execute()

const selected = bizMgmtRows.find((row) => row.is_selected)
const bizMgmtMembers = bizMgmtRows.map((row) => ({
  ...row,
  bizMgmtUserId: row.biz_mgmt_user_id,
  teamId: row.team_id,
  workspaceId: row.workspace_id,
  userName: row.user_name,
  userType: row.user_type,
  compName: row.comp_name,
  goodsId: row.goods_id,
  goodsName: row.goods_name,
  isSelected: row.is_selected,
}))
```

Return fields:

```ts
biz_mgmt_members: bizMgmtMembers,
bizMgmtMembers,
require_biz_mgmt_member_selection: bizMgmtMembers.length > 1 && !selected,
requireBizMgmtMemberSelection: bizMgmtMembers.length > 1 && !selected,
current_biz_mgmt_user_id: selected?.biz_mgmt_user_id ?? null,
currentBizMgmtUserId: selected?.biz_mgmt_user_id ?? null,
```

- [ ] **Step 5: 修改登录编排**

```ts
// apps/api/src/routes/auth/post-login.ts
import { ensureLocalUserForBizMgmtPhone, syncBizMgmtMembersForLocalUser } from '../../services/biz-mgmt-member-sync.js'
```

在查本地用户前加入手机号初始化分支，但本地存在时不能跳过业管同步。首次初始化必须先由 `ensureLocalUserForBizMgmtPhone` 查询到业管可用会员，否则不创建本地用户。

```ts
let user = await db
  .selectFrom('users')
  .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
  .where((eb) => eb.or([
    eb('account', '=', identifier.toLowerCase()),
    eb('phone', '=', identifier),
  ]))
  .executeTakeFirst()

let oneTimePassword: string | null = null
if (!user && /^1\d{10}$/.test(identifier)) {
  const created = await ensureLocalUserForBizMgmtPhone(identifier)
  oneTimePassword = created.oneTimePassword
  user = await db
    .selectFrom('users')
    .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
    .where('id', '=', created.userId)
    .executeTakeFirst()
}
```

密码校验成功后刷新会员。这里是强约束：每次手机号密码登录成功后都刷新业管会员，即使本地用户已存在，也要发现业管新增账号。

```ts
if (user.phone) {
  // 每次手机号密码登录成功后都刷新业管会员，避免用户在业管新增账号后本地不可见。
  await syncBizMgmtMembersForLocalUser(user.id, user.phone)
}
```

响应中仅首次初始化返回一次性密码：

```ts
const authBody = buildAuthResponse(accessToken, profile)
return oneTimePassword ? { ...authBody, one_time_password: oneTimePassword, oneTimePassword } : authBody
```

- [ ] **Step 6: 运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-selection-routes`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/types/src/api.ts apps/api/src/routes/auth/post-login.ts apps/api/src/services/user-profile.ts apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts
git commit -m "feat: require business management member selection after login"
```

---

### Task 5: 新增选择当前业管会员接口

**Files:**
- Create: `apps/api/src/routes/auth/post-select-biz-mgmt-member.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts`

- [ ] **Step 1: 补充路由源码测试**

```ts
// apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts
test('select business management member route updates one selected binding', () => {
  const source = readFileSync('apps/api/src/routes/auth/post-select-biz-mgmt-member.ts', 'utf8')
  assert.match(source, /\/auth\/select-biz-mgmt-member/)
  assert.match(source, /is_selected: false/)
  assert.match(source, /is_selected: true/)
  assert.match(source, /buildAuthResponse/)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-selection-routes`

Expected: FAIL，提示 route 文件不存在。

- [ ] **Step 3: 实现选择接口**

```ts
// apps/api/src/routes/auth/post-select-biz-mgmt-member.ts
import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { buildAuthResponse, buildUserProfile } from '../../services/user-profile.js'
import { signAccessToken } from '../../lib/auth-tokens.js'

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { biz_mgmt_user_id: string } }>('/auth/select-biz-mgmt-member', {
    schema: {
      body: {
        type: 'object',
        required: ['biz_mgmt_user_id'],
        properties: {
          biz_mgmt_user_id: { type: 'string', minLength: 1, maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const db = getDb()
    const binding = await db
      .selectFrom('biz_mgmt_member_bindings')
      .select(['id'])
      .where('local_user_id', '=', request.user.id)
      .where('biz_mgmt_user_id', '=', request.body.biz_mgmt_user_id)
      .where('status', '=', 1)
      .executeTakeFirst()

    if (!binding) {
      return reply.status(404).send({
        success: false,
        error: { code: 'BIZ_MGMT_MEMBER_NOT_FOUND', message: '账号身份不存在或不可用' },
      })
    }

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('biz_mgmt_member_bindings').set({ is_selected: false }).where('local_user_id', '=', request.user.id).execute()
      await trx.updateTable('biz_mgmt_member_bindings').set({ is_selected: true }).where('id', '=', binding.id).execute()
    })

    const profile = await buildUserProfile(db, request.user.id)
    const accessToken = signAccessToken({ id: request.user.id, account: request.user.account, role: request.user.role })
    return buildAuthResponse(accessToken, profile)
  })
}

export default route
```

- [ ] **Step 4: 确认 autoload 注册**

Run: `rg -n "autoload|routes" apps/api/src`

Expected: 当前路由目录通过 autoload 自动注册；如果不是自动注册，在对应 route index 中引入 `post-select-biz-mgmt-member.ts`。

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-selection-routes`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/auth/post-select-biz-mgmt-member.ts apps/api/src/__tests__/biz-mgmt-member-selection-routes.test.ts
git commit -m "feat: select active business management member identity"
```

---

### Task 6: 前端登录后跳转账号选择页

**Files:**
- Modify: `apps/web/src/stores/auth-store.ts`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/select-account/page.tsx`
- Create: `apps/web/src/components/auth/biz-mgmt-member-option-card.tsx`

- [ ] **Step 1: 更新 auth store 类型和行为**

```ts
// apps/web/src/stores/auth-store.ts
import type { UserProfile, UserTeam, UserWorkspace, BizMgmtMemberAccount } from '@aigc/types'

interface AuthState {
  user: UserProfile | null
  accessToken: string | null
  activeTeamId: string | null
  activeWorkspaceId: string | null
  currentBizMgmtUserId: string | null
  isInitialized: boolean
  isRefreshing: boolean
  activeBizMgmtMember: () => BizMgmtMemberAccount | null
  setActiveBizMgmtMember: (member: BizMgmtMemberAccount) => void
}
```

Initialize:

```ts
currentBizMgmtUserId: null,
activeBizMgmtMember: () => {
  const { user, currentBizMgmtUserId } = get()
  return user?.bizMgmtMembers?.find((member) => member.bizMgmtUserId === currentBizMgmtUserId) ?? null
},
```

Update `setAuth`:

```ts
const selectedMember = user.bizMgmtMembers?.find((member) => member.isSelected)
const firstTeam = selectedMember
  ? user.teams.find((team) => team.id === selectedMember.teamId)
  : user.teams[0]
const firstWs = selectedMember
  ? firstTeam?.workspaces.find((workspace) => workspace.id === selectedMember.workspaceId)
  : firstTeam?.workspaces[0]
set({
  user,
  accessToken: token,
  currentBizMgmtUserId: selectedMember?.bizMgmtUserId ?? null,
  activeTeamId: firstTeam?.id ?? null,
  activeWorkspaceId: firstWs?.id ?? null,
  isInitialized: true,
  isRefreshing: false,
})
```

Add action:

```ts
setActiveBizMgmtMember: (member) => set({
  currentBizMgmtUserId: member.bizMgmtUserId,
  activeTeamId: member.teamId,
  activeWorkspaceId: member.workspaceId,
}),
```

- [ ] **Step 2: 登录页跳转**

```tsx
// apps/web/src/app/(auth)/login/page.tsx
if (res.user.requireBizMgmtMemberSelection || res.user.require_biz_mgmt_member_selection) {
  router.push('/select-account')
  return
}
```

如果返回 `oneTimePassword`，展示一次性密码提示，并提示“登录后需修改密码，遗失请联系管理员重置”。

- [ ] **Step 3: 新增账号卡片组件**

```tsx
// apps/web/src/components/auth/biz-mgmt-member-option-card.tsx
'use client'

import type { BizMgmtMemberAccount } from '@aigc/types'

interface Props {
  member: BizMgmtMemberAccount
  disabled?: boolean
  onSelect: (member: BizMgmtMemberAccount) => void
}

export function BizMgmtMemberOptionCard({ member, disabled, onSelect }: Props) {
  const typeLabel = member.userType === '1' ? '个人会员' : '公司会员'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(member)}
      className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary disabled:opacity-60"
    >
      <div>
        <p className="text-base font-semibold text-foreground">{member.compName || member.userName}</p>
        <p className="mt-1 text-sm text-muted-foreground">{typeLabel} / {member.goodsName ?? '暂无权益名称'}</p>
      </div>
    </button>
  )
}
```

- [ ] **Step 4: 新增选择页**

```tsx
// apps/web/src/app/(auth)/select-account/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import type { AuthResponse, BizMgmtMemberAccount } from '@aigc/types'
import { BizMgmtMemberOptionCard } from '@/components/auth/biz-mgmt-member-option-card'

export default function SelectAccountPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const token = useAuthStore((s) => s.accessToken)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const members = user?.bizMgmtMembers ?? []

  async function handleSelect(member: BizMgmtMemberAccount) {
    setSubmittingId(member.bizMgmtUserId)
    try {
      const res = await apiPost<AuthResponse>('/auth/select-biz-mgmt-member', { biz_mgmt_user_id: member.bizMgmtUserId })
      setAuth(res.user, res.access_token)
      router.push('/dashboard')
    } finally {
      setSubmittingId(null)
    }
  }

  if (!user || !token) {
    router.push('/login')
    return null
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold text-foreground">选择账号身份</h1>
        <div className="mt-6 space-y-3">
          {members.map((member) => (
            <BizMgmtMemberOptionCard
              key={member.bizMgmtUserId}
              member={member}
              disabled={!!submittingId}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: 运行前端静态检查**

Run: `pnpm --filter @aigc/web lint`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/stores/auth-store.ts apps/web/src/app/(auth)/login/page.tsx apps/web/src/app/(auth)/select-account/page.tsx apps/web/src/components/auth/biz-mgmt-member-option-card.tsx
git commit -m "feat: add business management member account selection UI"
```

---

### Task 7: 新增业管 A 豆交易审计表

**Files:**
- Create: `packages/db/migrations/073_biz_mgmt_a_bean_transactions.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/biz-mgmt-a-bean-transactions-schema.test.ts`

- [ ] **Step 1: 写迁移结构测试**

```ts
// packages/db/src/biz-mgmt-a-bean-transactions-schema.test.ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('073_biz_mgmt_a_bean_transactions migration', () => {
  test('creates idempotent audit table without storing balance snapshots', () => {
    const source = readFileSync(
      join(__dirname, '../migrations/073_biz_mgmt_a_bean_transactions.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_a_bean_transactions'\)/)
    assert.match(source, /addColumn\('biz_mgmt_user_id', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('request_no', 'varchar\(128\)'/)
    assert.match(source, /addColumn\('work_no', 'varchar\(128\)'/)
    assert.match(source, /addColumn\('points_num', 'numeric\(12, 2\)'/)
    assert.doesNotMatch(source, /balance_snapshot|sum_points|consume_points/)
    assert.match(source, /COMMENT ON TABLE biz_mgmt_a_bean_transactions/)
    assert.doesNotMatch(source, /result_sync_status|result_payload|result_response|result_sync_attempts/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/db test -- biz-mgmt-a-bean-transactions-schema`

Expected: FAIL，提示 migration 文件不存在。

- [ ] **Step 3: 新增迁移**

```ts
// packages/db/migrations/073_biz_mgmt_a_bean_transactions.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_a_bean_transactions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('local_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) => col.references('workspaces.id'))
    .addColumn('biz_mgmt_user_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('request_no', 'varchar(128)', (col) => col.notNull())
    .addColumn('work_no', 'varchar(128)', (col) => col.notNull())
    .addColumn('source', 'integer', (col) => col.notNull())
    .addColumn('points_num', 'numeric(12, 2)', (col) => col.notNull())
    .addColumn('remark', 'varchar(500)')
    .addColumn('task_id', 'uuid')
    .addColumn('batch_id', 'uuid')
    .addColumn('deduct_status', 'varchar(32)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('deduct_response', 'jsonb')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_a_bean_transactions_request_no', ['request_no'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_a_bean_transactions ADD CONSTRAINT chk_biz_mgmt_a_bean_deduct_status CHECK (deduct_status IN ('pending','succeeded','failed'))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_a_bean_transactions_user').on('biz_mgmt_a_bean_transactions').column('biz_mgmt_user_id').execute()
  await db.schema.createIndex('idx_biz_mgmt_a_bean_transactions_batch').on('biz_mgmt_a_bean_transactions').column('batch_id').execute()

  await sql`COMMENT ON TABLE biz_mgmt_a_bean_transactions IS '业务管理平台 A 豆扣减与创作结果同步审计表。记录本地生成任务调用业管扣减和结果同步的幂等请求号、状态、请求响应，不保存用户 A 豆余额、累计获得、累计消费等动态权益数据。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.local_user_id IS '本地登录用户 ID，关联 users.id；用于审计是谁发起生成，不作为业管会员主键。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.team_id IS '本地团队 ID，关联 teams.id；来源于用户当前选择的业管会员身份映射，用于本地资源归属。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.workspace_id IS '本地工作空间 ID，关联 workspaces.id；允许为空表示任务未绑定具体工作空间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.biz_mgmt_user_id IS '业管会员编号，来源于 biz_mgmt_member_bindings.biz_mgmt_user_id；A 豆扣减、流水查询、创作结果同步均以该字段作为会员身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.request_no IS '调用业管 A 豆扣减接口的幂等请求号；建议使用 bizmgmt-{batchId}-{taskId 或 submit}，全局唯一，重复请求必须复用同一值。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.work_no IS '业管作品编号，对应 A 豆扣减和创作结果同步接口 workNo；优先使用 task_id，批量任务可使用 batch_id 加序号。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.source IS '业管 A 豆扣减来源，取值按业管接口文档定义；本地不重新定义枚举含义，必须在调用服务中集中映射。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.points_num IS '本次生成预估扣减 A 豆数量，单位 A 豆，numeric(12,2)；用于请求业管扣减接口和审计，不表示账户余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.remark IS '扣减备注，最多 500 字；包含模块、模型、任务摘要等便于业管侧排查的信息。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.task_id IS '本地 tasks.id；允许为空表示扣减发生在创建任务前或批量级扣减。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.batch_id IS '本地 task_batches.id；用于关联批次终态并触发创作结果同步。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.deduct_status IS '业管扣减调用状态，pending=本地已创建审计但未成功扣减，succeeded=业管扣减成功，failed=业管扣减失败且不得创建付费生成任务。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.deduct_response IS '业管扣减接口响应 JSON。结构说明：code=业管返回码，message=业管返回信息，decryptedData=验签解密后的响应体；仅用于审计和排障，不包含本地计算余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.last_error IS '最近一次 A 豆扣减失败的错误摘要；用于排障，不展示给普通用户。创作结果同步失败记录保存在 biz_mgmt_outbox_events。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.created_at IS '本地审计记录创建时间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.updated_at IS '本地扣减审计记录最近更新时间，包括扣减状态和错误信息变化。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_a_bean_transactions').execute()
}
```

- [ ] **Step 4: 扩展 schema 类型**

```ts
// packages/db/src/schema.ts
export interface BizMgmtABeanTransactionsTable {
  id: Generated<string>
  local_user_id: string
  team_id: string
  workspace_id: string | null
  biz_mgmt_user_id: string
  request_no: string
  work_no: string
  source: number
  points_num: string
  remark: string | null
  task_id: string | null
  batch_id: string | null
  deduct_status: Generated<'pending' | 'succeeded' | 'failed'>
  deduct_response: unknown | null
  last_error: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

Add to `Database`:

```ts
biz_mgmt_a_bean_transactions: BizMgmtABeanTransactionsTable
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @aigc/db test -- biz-mgmt-a-bean-transactions-schema`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/db/migrations/073_biz_mgmt_a_bean_transactions.ts packages/db/src/schema.ts packages/db/src/biz-mgmt-a-bean-transactions-schema.test.ts
git commit -m "feat: add business management a bean transaction audit"
```

---

### Task 8: 新增业管通知 Outbox 表

**Files:**
- Create: `packages/db/migrations/074_biz_mgmt_outbox_events.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/biz-mgmt-outbox-events-schema.test.ts`

- [ ] **Step 1: 写迁移结构测试**

```ts
// packages/db/src/biz-mgmt-outbox-events-schema.test.ts
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('074_biz_mgmt_outbox_events migration', () => {
  test('creates retryable business management outbox event table', () => {
    const source = readFileSync(
      join(__dirname, '../migrations/074_biz_mgmt_outbox_events.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_outbox_events'\)/)
    assert.match(source, /addColumn\('event_type', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('status', 'varchar\(32\)'/)
    assert.match(source, /addColumn\('payload', 'jsonb'/)
    assert.match(source, /addColumn\('attempt_count', 'integer'/)
    assert.match(source, /addColumn\('max_attempts', 'integer'/)
    assert.match(source, /addColumn\('next_attempt_at', 'timestamptz'/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_outbox_events\.payload/)
    assert.match(source, /creation_result_notify/)
    assert.match(source, /member_sub_card_sync/)
  })
})
```

- [ ] **Step 2: 新增迁移**

```ts
// packages/db/migrations/074_biz_mgmt_outbox_events.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_outbox_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('event_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('dedupe_key', 'varchar(180)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('local_user_id', 'uuid')
    .addColumn('biz_mgmt_user_id', 'varchar(64)')
    .addColumn('phone', 'varchar(20)')
    .addColumn('team_id', 'uuid')
    .addColumn('workspace_id', 'uuid')
    .addColumn('task_id', 'uuid')
    .addColumn('batch_id', 'uuid')
    .addColumn('task_status', 'varchar(32)')
    .addColumn('points_num', 'numeric(12, 2)')
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('last_response', 'jsonb')
    .addColumn('last_error', 'text')
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('next_attempt_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'varchar(128)')
    .addColumn('sent_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_outbox_events_dedupe_key', ['dedupe_key'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_event_type CHECK (event_type IN ('creation_result_notify','member_sub_card_sync'))`.execute(db)
  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_status CHECK (status IN ('pending','processing','succeeded','failed'))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_outbox_pending').on('biz_mgmt_outbox_events').columns(['status', 'next_attempt_at']).execute()
  await db.schema.createIndex('idx_biz_mgmt_outbox_user').on('biz_mgmt_outbox_events').column('biz_mgmt_user_id').execute()
  await db.schema.createIndex('idx_biz_mgmt_outbox_task').on('biz_mgmt_outbox_events').columns(['batch_id', 'task_id']).execute()

  await sql`COMMENT ON TABLE biz_mgmt_outbox_events IS '业务管理平台出站通知 outbox 表。所有本地状态变化后需要通知业管的事件先入本表，再由 biz-mgmt-notify-queue 异步投递；多次失败后保留 failed 记录用于人工排查和补偿。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.event_type IS '出站事件类型。creation_result_notify=创作结果同步到 AIHUB_CREATION_RESULT_NOTIFY；member_sub_card_sync=团队成员创建后同步会员副卡到 MEMBER-1002。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.dedupe_key IS '幂等键，全局唯一。创作结果建议 creation-result:{requestNo}；会员副卡建议 member-sub-card:{teamId}:{userId}:{phone}。重复入队必须复用同一 dedupe_key。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.status IS '投递状态，pending=待投递或等待下次重试，processing=队列 worker 已领取并正在调用业管，succeeded=业管返回成功且已记录 last_response/sent_at，failed=超过 max_attempts 或不可重试错误。成功和失败记录都必须保留。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.local_user_id IS '本地用户 ID，记录事件相关用户。创作结果为发起生成用户；会员副卡为被创建的团队成员用户。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.biz_mgmt_user_id IS '业管会员 ID。创作结果为当前扣费会员；会员副卡为团长或所属主会员 ID，具体映射来自 biz_mgmt_member_bindings。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.phone IS '事件相关手机号。会员副卡同步时为新成员手机号；创作结果可为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.team_id IS '本地团队 ID，用于定位团队、团长和成员创建上下文。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.workspace_id IS '本地工作空间 ID，用于定位创作所在空间；会员副卡同步可为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.task_id IS '本地任务 ID，创作结果同步时填写 tasks.id；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.batch_id IS '本地批次 ID，创作结果同步时填写 task_batches.id；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.task_status IS '任务终态。创作结果同步取 completed 或 failed；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.points_num IS '事件相关 A 豆数量，单位 A 豆。创作结果同步为本次扣减或实际消耗；会员副卡同步为 initialPointsNum。该字段不是余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.payload IS '出站请求 JSON。creation_result_notify 结构：userId=业管会员 ID，requestNo=扣减幂等号，workNo=作品号，success=是否成功，remark=500 字内结果说明；member_sub_card_sync 结构：phone=新成员手机号，userName=新成员名称，compName=团队/公司名称，channel=来源渠道，belongId=所属主会员 ID，initialPointsNum=副卡初始 A 豆。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.last_response IS '最近一次业管响应 JSON。结构：code=返回码，message=返回信息，decryptedData=验签解密后的响应体；成功和失败响应都要记录，便于审计和排障；为空表示尚未收到响应。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.last_error IS '最近一次投递失败错误摘要，包括网络错误、验签失败、业管业务失败等；成功后清空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.attempt_count IS '已经尝试投递次数，首次消费前为 0，每次实际调用业管接口前加 1。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.max_attempts IS '最大投递次数，默认 8。达到后状态置 failed，不再自动重试。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.next_attempt_at IS '下一次允许投递时间。失败后按指数退避更新，例如 1m、5m、15m、1h、6h。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.locked_at IS '队列 worker 领取事件的时间，用于识别卡死 processing 事件。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.locked_by IS '领取事件的 worker 标识，用于排查并发消费。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.sent_at IS '业管通知成功时间。仅当 status=succeeded 时写入；成功记录保留在 outbox 表中，不删除。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.created_at IS 'outbox 事件创建时间，必须与本地业务状态变化处于同一事务或同一失败可恢复流程。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.updated_at IS 'outbox 事件最近更新时间。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_outbox_events').execute()
}
```

- [ ] **Step 3: 扩展 schema 类型并运行测试**

```ts
// packages/db/src/schema.ts
export interface BizMgmtOutboxEventsTable {
  id: Generated<string>
  event_type: 'creation_result_notify' | 'member_sub_card_sync'
  dedupe_key: string
  status: Generated<'pending' | 'processing' | 'succeeded' | 'failed'>
  local_user_id: string | null
  biz_mgmt_user_id: string | null
  phone: string | null
  team_id: string | null
  workspace_id: string | null
  task_id: string | null
  batch_id: string | null
  task_status: string | null
  points_num: string | null
  payload: unknown
  last_response: unknown | null
  last_error: string | null
  attempt_count: Generated<number>
  max_attempts: Generated<number>
  next_attempt_at: Generated<Date>
  locked_at: Date | null
  locked_by: string | null
  sent_at: Date | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

Run: `pnpm --filter @aigc/db test -- biz-mgmt-outbox-events-schema`

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/db/migrations/074_biz_mgmt_outbox_events.ts packages/db/src/schema.ts packages/db/src/biz-mgmt-outbox-events-schema.test.ts
git commit -m "feat: add business management outbox events"
```

---

### Task 9: 增加业管 A 豆服务和只读查询路由

**Files:**
- Create: `apps/api/src/services/biz-mgmt-a-bean.ts`
- Create: `apps/api/src/routes/credits/get-biz-mgmt-balance.ts`
- Create: `apps/api/src/routes/credits/get-biz-mgmt-ledger.ts`
- Modify: `apps/api/src/routes/credits/index.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`

- [ ] **Step 1: 写服务测试**

```ts
// apps/api/src/__tests__/biz-mgmt-a-bean.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
} from '../services/biz-mgmt-a-bean.js'

test('deduct request number is stable for batch and task', () => {
  assert.equal(
    buildBizMgmtDeductRequestNo({ batchId: 'batch-1', taskId: 'task-1' }),
    'bizmgmt-batch-1-task-1',
  )
})

test('balance normalization accepts numeric strings only', () => {
  assert.equal(normalizeBizMgmtPointsBalance({ pointsNum: '97.00' }), 97)
  assert.throws(() => normalizeBizMgmtPointsBalance({ pointsNum: 'abc' }), /A 豆余额格式错误/)
})

test('ledger query clamps page size and maps current member id', () => {
  assert.deepEqual(
    normalizeBizMgmtPointsLedgerQuery({ bizMgmtUserId: 'u1', pageNum: 0, pageSize: 999 }),
    { userId: 'u1', pageNum: 1, pageSize: 100 },
  )
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-a-bean`

Expected: FAIL，提示服务文件不存在。

- [ ] **Step 3: 实现服务骨架**

```ts
// apps/api/src/services/biz-mgmt-a-bean.ts
import { getDb } from '@aigc/db'
import {
  deductTobyPoints,
  queryTobyMemberPoints,
  queryTobyPointsChangeList,
} from '../lib/toby-open-api.js'

export interface CurrentBizMgmtIdentity {
  localUserId: string
  teamId: string
  workspaceId: string | null
  bizMgmtUserId: string
}

export function buildBizMgmtDeductRequestNo(input: { batchId: string; taskId?: string | null }): string {
  return `bizmgmt-${input.batchId}-${input.taskId ?? 'batch'}`
}

export function normalizeBizMgmtPointsBalance(payload: { pointsNum?: number | string | null }): number {
  const value = Number(payload.pointsNum)
  if (!Number.isFinite(value) || value < 0) throw new Error('A 豆余额格式错误')
  return value
}

export function normalizeBizMgmtPointsLedgerQuery(input: {
  bizMgmtUserId: string
  changeType?: string
  pageNum?: number
  pageSize?: number
}) {
  return {
    userId: input.bizMgmtUserId,
    ...(input.changeType ? { changeType: input.changeType } : {}),
    pageNum: Math.max(1, Math.trunc(input.pageNum ?? 1)),
    pageSize: Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 20))),
  }
}

export async function getCurrentBizMgmtIdentity(localUserId: string): Promise<CurrentBizMgmtIdentity> {
  const db = getDb()
  const binding = await db
    .selectFrom('biz_mgmt_member_bindings')
    .select(['local_user_id', 'team_id', 'workspace_id', 'biz_mgmt_user_id'])
    .where('local_user_id', '=', localUserId)
    .where('is_selected', '=', true)
    .where('status', '=', 1)
    .executeTakeFirst()

  if (!binding) throw new Error('请先选择可用的业管会员身份')
  return {
    localUserId: binding.local_user_id,
    teamId: binding.team_id,
    workspaceId: binding.workspace_id,
    bizMgmtUserId: binding.biz_mgmt_user_id,
  }
}

export async function queryCurrentBizMgmtBalance(localUserId: string): Promise<number> {
  const identity = await getCurrentBizMgmtIdentity(localUserId)
  const response = await queryTobyMemberPoints({ userId: identity.bizMgmtUserId })
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆余额查询失败')
  return normalizeBizMgmtPointsBalance(response.decryptedData as { pointsNum?: number | string | null })
}

export async function queryCurrentBizMgmtLedger(input: {
  localUserId: string
  changeType?: string
  pageNum?: number
  pageSize?: number
}) {
  const identity = await getCurrentBizMgmtIdentity(input.localUserId)
  const response = await queryTobyPointsChangeList(normalizeBizMgmtPointsLedgerQuery({
    bizMgmtUserId: identity.bizMgmtUserId,
    changeType: input.changeType,
    pageNum: input.pageNum,
    pageSize: input.pageSize,
  }))
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆流水查询失败')
  return response.decryptedData ?? {}
}

export async function deductBizMgmtPointsForGeneration(input: {
  localUserId: string
  teamId: string
  workspaceId?: string | null
  batchId: string
  taskId?: string | null
  pointsNum: number
  source: number
  remark: string
}) {
  const identity = await getCurrentBizMgmtIdentity(input.localUserId)
  if (identity.teamId !== input.teamId) throw new Error('当前业管身份与生成团队不匹配')

  const balance = await queryCurrentBizMgmtBalance(input.localUserId)
  if (balance < input.pointsNum) throw new Error('A 豆余额不足')

  const requestNo = buildBizMgmtDeductRequestNo({ batchId: input.batchId, taskId: input.taskId })
  const workNo = input.taskId ?? input.batchId
  const db = getDb()

  await db.insertInto('biz_mgmt_a_bean_transactions').values({
    local_user_id: input.localUserId,
    team_id: input.teamId,
    workspace_id: input.workspaceId ?? identity.workspaceId,
    biz_mgmt_user_id: identity.bizMgmtUserId,
    request_no: requestNo,
    work_no: workNo,
    source: input.source,
    points_num: String(input.pointsNum),
    remark: input.remark,
    task_id: input.taskId ?? null,
    batch_id: input.batchId,
  }).onConflict((oc) => oc.column('request_no').doNothing()).execute()

  const response = await deductTobyPoints({
    userId: identity.bizMgmtUserId,
    requestNo,
    source: input.source,
    workNo,
    pointsNum: input.pointsNum,
    remark: input.remark,
  })

  await db.updateTable('biz_mgmt_a_bean_transactions')
    .set({
      deduct_status: response.code === '0000' ? 'succeeded' : 'failed',
      deduct_response: JSON.stringify(response),
      last_error: response.code === '0000' ? null : response.message,
    })
    .where('request_no', '=', requestNo)
    .execute()

  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆扣减失败')
  return { requestNo, workNo, bizMgmtUserId: identity.bizMgmtUserId }
}
```

Implementation note: `apps/api/src/services/biz-mgmt-a-bean.ts` 只负责余额、流水和扣减。创作结果同步不能在这里直接调用业管接口，必须由 Task 11 写入 `biz_mgmt_outbox_events` 后交给 `biz-mgmt-notify-queue` 投递。

- [ ] **Step 4: 增加余额和流水只读路由**

```ts
// apps/api/src/routes/credits/get-biz-mgmt-balance.ts
import type { FastifyInstance } from 'fastify'
import { queryCurrentBizMgmtBalance } from '../../services/biz-mgmt-a-bean.js'

export async function registerGetBizMgmtBalance(app: FastifyInstance) {
  app.get('/credits/biz-mgmt/balance', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id
    const balance = await queryCurrentBizMgmtBalance(userId)
    return { balance }
  })
}
```

```ts
// apps/api/src/routes/credits/get-biz-mgmt-ledger.ts
import type { FastifyInstance } from 'fastify'
import { queryCurrentBizMgmtLedger } from '../../services/biz-mgmt-a-bean.js'

export async function registerGetBizMgmtLedger(app: FastifyInstance) {
  app.get<{
    Querystring: { changeType?: string; pageNum?: number; pageSize?: number }
  }>('/credits/biz-mgmt/ledger', { preHandler: [app.authenticate] }, async (request) => {
    return queryCurrentBizMgmtLedger({
      localUserId: request.user.id,
      changeType: request.query.changeType,
      pageNum: Number(request.query.pageNum ?? 1),
      pageSize: Number(request.query.pageSize ?? 20),
    })
  })
}
```

- [ ] **Step 5: 注册路由并运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-a-bean`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/services/biz-mgmt-a-bean.ts apps/api/src/routes/credits/get-biz-mgmt-balance.ts apps/api/src/routes/credits/get-biz-mgmt-ledger.ts apps/api/src/routes/credits/index.ts apps/api/src/__tests__/biz-mgmt-a-bean.test.ts
git commit -m "feat: add business management a bean services"
```

---

### Task 10: 生成前接入业管 A 豆扣减

**Files:**
- Modify: `apps/api/src/routes/generate/post-image.ts`
- Modify: `apps/api/src/services/credit.ts`
- Modify: `packages/types/src/queue.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-generation-deduct.test.ts`

- [ ] **Step 1: 写生成扣减行为测试**

```ts
// apps/api/src/__tests__/biz-mgmt-generation-deduct.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBizMgmtDeductRequestNo } from '../services/biz-mgmt-a-bean.js'

test('generation uses deterministic request number for business management deduction', () => {
  assert.equal(
    buildBizMgmtDeductRequestNo({ batchId: 'batch-123', taskId: 'task-456' }),
    'bizmgmt-batch-123-task-456',
  )
})
```

- [ ] **Step 2: 改造生成入口**

在 `apps/api/src/routes/generate/post-image.ts` 中，把“创建批次/任务后冻结本地积分”的路径改为：

```ts
const deduction = await deductBizMgmtPointsForGeneration({
  localUserId: userId,
  teamId,
  workspaceId,
  batchId,
  taskId,
  pointsNum: estimatedCredits,
  source: 1,
  remark: `图片生成：${model}`,
})

await imageQueue.add('generate-image', {
  taskId,
  batchId,
  userId,
  teamId,
  workspaceId,
  creditAccountId,
  estimatedCredits,
  bizMgmtDeductRequestNo: deduction.requestNo,
  bizMgmtUserId: deduction.bizMgmtUserId,
  bizMgmtWorkNo: deduction.workNo,
})
```

Implementation notes:
- `source` 的数字含义必须以业管文档为准；如果文档未明确，先集中定义常量并在注释里写“待业管确认”，不能散落魔法数字。
- 对业管身份生成的任务，不能在提交前读取 `credit_accounts.balance` 判定余额。
- 若业管扣减失败，必须回滚或标记刚创建的 `task_batches/tasks` 为 failed，不能把未扣费任务投递到队列。
- 迁移期如仍需兼容非业管账号，可保留本地 `freezeCredits` 分支，但分支条件必须显式为“没有当前业管身份的旧账号/内部账号”。

- [ ] **Step 3: 扩展队列类型**

```ts
// packages/types/src/queue.ts
export interface BizMgmtGenerationBillingContext {
  bizMgmtDeductRequestNo?: string
  bizMgmtUserId?: string
  bizMgmtWorkNo?: string
}
```

Add these optional fields to image/video/music/text generation job data where the worker must report creation result.

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-generation-deduct`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/routes/generate/post-image.ts apps/api/src/services/credit.ts packages/types/src/queue.ts apps/api/src/__tests__/biz-mgmt-generation-deduct.test.ts
git commit -m "feat: deduct business management a beans before generation"
```

---

### Task 11: Worker 终态写入创作结果 Outbox 并异步同步业管

**Files:**
- Modify: `apps/worker/src/pipelines/complete.ts`
- Modify: `apps/worker/src/pipelines/fail.ts`
- Create: `apps/worker/src/lib/biz-mgmt-result-outbox.ts`
- Create: `apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts`
- Create: `apps/worker/src/workers/biz-mgmt-notify.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts`
- Test: `apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts`

- [ ] **Step 1: 写结果同步测试**

```ts
// apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBizMgmtCreationResultRemark, buildCreationResultOutboxPayload } from '../lib/biz-mgmt-result-outbox.js'

test('creation result remark is bounded', () => {
  const remark = buildBizMgmtCreationResultRemark({
    status: 'failed',
    module: 'image',
    message: 'x'.repeat(1000),
  })
  assert.equal(remark.length <= 500, true)
  assert.match(remark, /image/)
})

test('creation result outbox payload contains task and billing context', () => {
  const event = buildCreationResultOutboxPayload({
    localUserId: 'user-1',
    bizMgmtUserId: 'biz-user-1',
    teamId: 'team-1',
    workspaceId: 'workspace-1',
    batchId: 'batch-1',
    taskId: 'task-1',
    taskStatus: 'completed',
    pointsNum: 12,
    requestNo: 'bizmgmt-batch-1-task-1',
    workNo: 'task-1',
    success: true,
    remark: '创作成功：image',
  })

  assert.equal(event.eventType, 'creation_result_notify')
  assert.equal(event.dedupeKey, 'creation-result:bizmgmt-batch-1-task-1')
  assert.equal(event.payload.success, true)
  assert.equal(event.pointsNum, 12)
})
```

- [ ] **Step 2: 增加终态 outbox 构造函数**

```ts
// apps/worker/src/lib/biz-mgmt-result-outbox.ts
import { getDb } from '@aigc/db'

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
  success: boolean
}) {
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
      success: input.success,
      remark: input.success ? '创作成功' : '创作失败',
    },
  }
}

export async function enqueueCreationResultOutbox(input: ReturnType<typeof buildCreationResultOutboxPayload>) {
  const db = getDb()
  await db.insertInto('biz_mgmt_outbox_events').values({
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
    payload: JSON.stringify(input.payload),
  }).onConflict((oc) => oc.column('dedupe_key').doNothing()).execute()
}
```

- [ ] **Step 3: 增加 outbox 派发 worker**

```ts
// apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts
import { getDb } from '@aigc/db'
import { notifyTobyCreationResult, syncTobyMemberSubCard } from '../../../api/src/lib/toby-open-api.js'

export function computeBizMgmtOutboxNextAttempt(attemptCount: number): Date {
  const minutes = [1, 5, 15, 60, 360, 720, 1440, 1440][Math.min(attemptCount, 7)]
  return new Date(Date.now() + minutes * 60_000)
}

export async function dispatchBizMgmtOutboxEvent(eventId: string): Promise<void> {
  const db = getDb()
  const event = await db
    .selectFrom('biz_mgmt_outbox_events')
    .selectAll()
    .where('id', '=', eventId)
    .executeTakeFirst()
  if (!event || event.status === 'succeeded' || event.status === 'failed') return

  await db.updateTable('biz_mgmt_outbox_events')
    .set({ status: 'processing', locked_at: new Date(), attempt_count: (eb) => eb('attempt_count', '+', 1) })
    .where('id', '=', eventId)
    .execute()

  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    const response = event.event_type === 'creation_result_notify'
      ? await notifyTobyCreationResult(payload)
      : await syncTobyMemberSubCard(payload)

    if (response.code !== '0000') throw new Error(response.message || '业管通知失败')

    await db.updateTable('biz_mgmt_outbox_events')
      .set({ status: 'succeeded', last_response: JSON.stringify(response), last_error: null, sent_at: new Date(), updated_at: new Date() })
      .where('id', '=', eventId)
      .execute()
  } catch (err) {
    const nextAttemptCount = Number(event.attempt_count ?? 0) + 1
    const exhausted = nextAttemptCount >= Number(event.max_attempts ?? 8)
    await db.updateTable('biz_mgmt_outbox_events')
      .set({
        status: exhausted ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message : String(err),
        next_attempt_at: computeBizMgmtOutboxNextAttempt(nextAttemptCount),
        updated_at: new Date(),
      })
      .where('id', '=', eventId)
      .execute()
    if (!exhausted) throw err
  }
}
```

Implementation note: 如果 worker 不能直接 import API lib，执行时把 `toby-open-api.ts` 移到共享 package，或复制成 worker 专属外部接口 client；不要让 worker import API route/service 造成循环依赖。

```ts
// apps/worker/src/workers/biz-mgmt-notify.ts
import { Worker } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'
import { dispatchBizMgmtOutboxEvent } from '../lib/biz-mgmt-outbox-dispatch.js'

export function startBizMgmtNotifyWorker() {
  return new Worker(
    'biz-mgmt-notify-queue',
    async (job) => {
      await dispatchBizMgmtOutboxEvent(String(job.data.eventId))
    },
    { connection: getBullMQConnection(), ...DEFAULT_JOB_OPTIONS },
  )
}
```

- [ ] **Step 4: 完成管线写入成功 outbox**

在 `apps/worker/src/pipelines/complete.ts` 的事务提交后、SSE/回调通知前调用：

```ts
await enqueueCreationResultOutbox(buildCreationResultOutboxPayload({
  localUserId: userId,
  bizMgmtUserId: jobData.bizMgmtUserId!,
  teamId,
  workspaceId: jobData.workspaceId,
  batchId,
  taskId,
  taskStatus: 'completed',
  pointsNum: actualCredits,
  requestNo: jobData.bizMgmtDeductRequestNo!,
  workNo: jobData.bizMgmtWorkNo ?? taskId,
  success: true,
}))
```

- [ ] **Step 5: 失败管线写入失败 outbox**

在 `apps/worker/src/pipelines/fail.ts` 标记任务失败后调用：

```ts
await enqueueCreationResultOutbox(buildCreationResultOutboxPayload({
  localUserId: userId,
  bizMgmtUserId: jobData.bizMgmtUserId!,
  teamId,
  workspaceId: jobData.workspaceId,
  batchId,
  taskId,
  taskStatus: 'failed',
  pointsNum: estimatedCredits,
  requestNo: jobData.bizMgmtDeductRequestNo!,
  workNo: jobData.bizMgmtWorkNo ?? taskId,
  success: false,
}))
```

- [ ] **Step 6: 运行测试**

Run: `pnpm --filter @aigc/worker test -- biz-mgmt-creation-result-sync biz-mgmt-outbox-dispatch`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/worker/src/pipelines/complete.ts apps/worker/src/pipelines/fail.ts apps/worker/src/lib/biz-mgmt-result-outbox.ts apps/worker/src/lib/biz-mgmt-outbox-dispatch.ts apps/worker/src/workers/biz-mgmt-notify.ts apps/worker/src/index.ts apps/worker/src/__tests__/biz-mgmt-creation-result-sync.test.ts apps/worker/src/__tests__/biz-mgmt-outbox-dispatch.test.ts
git commit -m "feat: enqueue business management creation result notifications"
```

---

### Task 12: 团队成员创建后写入会员副卡同步 Outbox

**Files:**
- Create: `apps/api/src/services/biz-mgmt-outbox.ts`
- Modify: `apps/api/src/routes/teams/post-create-member.ts`
- Modify: `apps/api/src/routes/teams/post-batch-members.ts`
- Modify: `apps/api/src/routes/teams/post-invite-member.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-member-sub-card-outbox.test.ts`

- [ ] **Step 1: 写会员副卡 outbox 测试**

```ts
// apps/api/src/__tests__/biz-mgmt-member-sub-card-outbox.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMemberSubCardOutboxPayload } from '../services/biz-mgmt-outbox.js'

test('member sub card outbox payload contains owner and new member context', () => {
  const event = buildMemberSubCardOutboxPayload({
    ownerBizMgmtUserId: 'owner-biz-1',
    teamId: 'team-1',
    localUserId: 'member-user-1',
    phone: '17714420972',
    userName: '新成员',
    compName: '牛奶',
    channel: 'AIGC',
    initialPointsNum: 0,
  })

  assert.equal(event.eventType, 'member_sub_card_sync')
  assert.equal(event.dedupeKey, 'member-sub-card:team-1:member-user-1:17714420972')
  assert.equal(event.payload.belongId, 'owner-biz-1')
  assert.equal(event.payload.initialPointsNum, 0)
})
```

- [ ] **Step 2: 实现会员副卡 outbox 服务**

```ts
// apps/api/src/services/biz-mgmt-outbox.ts
import { getDb } from '@aigc/db'
import { Queue } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'

let bizMgmtNotifyQueue: Queue | null = null

function getBizMgmtNotifyQueue(): Queue {
  if (!bizMgmtNotifyQueue) {
    bizMgmtNotifyQueue = new Queue('biz-mgmt-notify-queue', {
      connection: getBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return bizMgmtNotifyQueue
}

export function buildMemberSubCardOutboxPayload(input: {
  ownerBizMgmtUserId: string
  teamId: string
  localUserId: string
  phone: string
  userName: string
  compName: string
  channel: string
  initialPointsNum: number
}) {
  return {
    eventType: 'member_sub_card_sync' as const,
    dedupeKey: `member-sub-card:${input.teamId}:${input.localUserId}:${input.phone}`,
    localUserId: input.localUserId,
    bizMgmtUserId: input.ownerBizMgmtUserId,
    phone: input.phone,
    teamId: input.teamId,
    pointsNum: input.initialPointsNum,
    payload: {
      phone: input.phone,
      userName: input.userName,
      compName: input.compName,
      channel: input.channel,
      belongId: input.ownerBizMgmtUserId,
      initialPointsNum: input.initialPointsNum,
    },
  }
}

export async function enqueueBizMgmtOutboxEvent(input: ReturnType<typeof buildMemberSubCardOutboxPayload>) {
  const db = getDb()
  const row = await db.insertInto('biz_mgmt_outbox_events')
    .values({
      event_type: input.eventType,
      dedupe_key: input.dedupeKey,
      local_user_id: input.localUserId,
      biz_mgmt_user_id: input.bizMgmtUserId,
      phone: input.phone,
      team_id: input.teamId,
      points_num: String(input.pointsNum),
      payload: JSON.stringify(input.payload),
    })
    .onConflict((oc) => oc.column('dedupe_key').doUpdateSet({ updated_at: new Date() }))
    .returning('id')
    .executeTakeFirstOrThrow()

  await getBizMgmtNotifyQueue().add('biz-mgmt-notify', { eventId: row.id })
  return row.id
}
```

- [ ] **Step 3: 接入单成员创建**

在 `apps/api/src/routes/teams/post-create-member.ts` 成员创建事务成功后：

```ts
const ownerBinding = await db.selectFrom('biz_mgmt_member_bindings')
  .select(['biz_mgmt_user_id', 'comp_name'])
  .where('local_user_id', '=', request.user.id)
  .where('team_id', '=', teamId)
  .where('is_selected', '=', true)
  .executeTakeFirst()

if (ownerBinding && createdUser.phone) {
  await enqueueBizMgmtOutboxEvent(buildMemberSubCardOutboxPayload({
    ownerBizMgmtUserId: ownerBinding.biz_mgmt_user_id,
    teamId,
    localUserId: createdUser.id,
    phone: createdUser.phone,
    userName: createdUser.username ?? createdUser.phone,
    compName: ownerBinding.comp_name,
    channel: 'AIGC',
    initialPointsNum: 0,
  }))
}
```

Implementation notes:
- “团长创建结束后要传给业管平台”不能阻塞本地成员创建结果；业管同步失败由 outbox 重试和失败记录承接。
- 如果当前创建者不是该团队的业管主会员，不能伪造 `belongId`；应跳过同步并记录业务日志，或返回明确错误，执行前需按产品要求确认。
- `initialPointsNum` 当前按 0 入参；如果后续产品允许给副卡初始 A 豆，必须来自显式表单字段，并写入 outbox 的 `points_num`。

- [ ] **Step 4: 接入批量成员和邀请成员**

在 `apps/api/src/routes/teams/post-batch-members.ts` 和 `apps/api/src/routes/teams/post-invite-member.ts` 中复用同一 `buildMemberSubCardOutboxPayload`：

```ts
for (const member of createdMembers) {
  if (!member.phone) continue
  await enqueueBizMgmtOutboxEvent(buildMemberSubCardOutboxPayload({
    ownerBizMgmtUserId: ownerBinding.biz_mgmt_user_id,
    teamId,
    localUserId: member.id,
    phone: member.phone,
    userName: member.username ?? member.phone,
    compName: ownerBinding.comp_name,
    channel: 'AIGC',
    initialPointsNum: 0,
  }))
}
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sub-card-outbox`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/services/biz-mgmt-outbox.ts apps/api/src/routes/teams/post-create-member.ts apps/api/src/routes/teams/post-batch-members.ts apps/api/src/routes/teams/post-invite-member.ts apps/api/src/__tests__/biz-mgmt-member-sub-card-outbox.test.ts
git commit -m "feat: enqueue business management member sub card sync"
```

---

### Task 13: 验证与风险回归

**Files:**
- Modify only if tests reveal issues.

- [ ] **Step 1: DB 测试**

Run: `pnpm --filter @aigc/db test -- biz-mgmt-member-bindings-schema`

Expected: PASS。

Run: `pnpm --filter @aigc/db test -- biz-mgmt-a-bean-transactions-schema biz-mgmt-outbox-events-schema`

Expected: PASS。

- [ ] **Step 2: API 测试**

Run: `pnpm --filter @aigc/api test -- biz-mgmt-member-sync biz-mgmt-member-selection-routes biz-mgmt-a-bean biz-mgmt-generation-deduct biz-mgmt-member-sub-card-outbox`

Expected: PASS。

- [ ] **Step 3: Web lint**

Run: `pnpm --filter @aigc/web lint`

Expected: PASS。

- [ ] **Step 4: 类型构建**

Run: `pnpm --filter @aigc/types build`

Expected: PASS。

- [ ] **Step 5: Worker 测试**

Run: `pnpm --filter @aigc/worker test -- biz-mgmt-creation-result-sync biz-mgmt-outbox-dispatch`

Expected: PASS。

- [ ] **Step 6: 手工接口验收**

Use a mock business management response matching the sample phone `17714420972`:

```json
{
  "members": [
    { "userId": "AED8352BF32B429EAB0EE4C8295391BC", "phone": "17714420972", "userName": "个人账号", "compName": "个人", "userType": "1", "status": 1, "pointsNum": 500, "sumPointsNum": 800, "consumePointsNum": 0, "goodsId": "TOBYAI000009", "goodsName": "随心选兑换", "createTime": "2026-06-23 14:08:10" },
    { "userId": "23a234014dc244f2bed53cacdcf27ac9", "phone": "17714420972", "userName": "吃瓜", "compName": "牛奶", "userType": "2", "status": 1, "pointsNum": 1000, "sumPointsNum": 1000, "consumePointsNum": 0, "goodsId": "TOBYAI000008", "goodsName": "随心用膨胀福利活动", "createTime": "2026-06-22 14:14:56" },
    { "userId": "700f38a77e224fbeb52a11019f6e6581", "phone": "17714420972", "userName": "吃鱼达人", "compName": "酸奶", "userType": "2", "status": 1, "pointsNum": 1500, "sumPointsNum": 2000, "consumePointsNum": 500, "goodsId": "TOBYAI000008", "goodsName": "随心用膨胀福利活动", "createTime": "2026-06-21 17:03:47" }
  ]
}
```

Expected:
- 本地只创建 1 个 `users` 记录。
- 创建 3 个 `biz_mgmt_member_bindings`。
- `biz_mgmt_member_bindings` 不包含 `pointsNum`、`sumPointsNum`、`consumePointsNum` 对应字段，也不保存 A 豆余额、累计获得、累计消费。
- 创建 3 个 team，每个 team 有默认 workspace。
- 登录响应 `requireBizMgmtMemberSelection=true`。
- 选择“牛奶”后，profile 中 `currentBizMgmtUserId=23a234014dc244f2bed53cacdcf27ac9`，active team/workspace 对应牛奶身份。
- 如果该手机号的本地用户已存在，再次登录仍然调用业管查询；当业管新增第 4 个会员时，本地登录后新增第 4 条 `biz_mgmt_member_bindings`，并重新要求用户选择身份。
- `GET /credits/biz-mgmt/balance` 使用当前选中的 `biz_mgmt_user_id` 调用 `MEMBER-1004`，返回实时余额，不写入本地表。
- `GET /credits/biz-mgmt/ledger` 使用当前选中的 `biz_mgmt_user_id` 调用 `AIHUB_POINTS_CHANGE_QUERY`，返回业管流水，不读取 `credits_ledger`。
- 发起付费图片生成时，先调用 `MEMBER-1004` 实时查余额；余额不足时不创建或不投递生成任务。
- 余额足够时，调用 `AIHUB_POINTS_CHANGE` 扣减成功后才投递生成任务，并写入 1 条 `biz_mgmt_a_bean_transactions` 审计记录。
- 任务完成时写入 1 条 `biz_mgmt_outbox_events(event_type='creation_result_notify', task_status='completed')`；任务失败时写入 `task_status='failed'`。
- `biz-mgmt-notify-queue` 消费创作结果 outbox 后调用 `AIHUB_CREATION_RESULT_NOTIFY`；业管成功时标记 `succeeded` 并记录 `last_response/sent_at`；业管失败时递增 `attempt_count` 并设置 `next_attempt_at`，超过 `max_attempts` 后标记 `failed`。
- 团长创建团队成员后写入 1 条 `biz_mgmt_outbox_events(event_type='member_sub_card_sync')`，payload 包含 `phone/userName/compName/channel/belongId/initialPointsNum`，由队列调用 `MEMBER-1002`。
- 会员副卡通知失败不回滚本地成员创建，但必须保留 failed outbox 记录，包含用户信息、团队信息、手机号、payload、最近响应、最近错误和尝试次数。
- `biz_mgmt_a_bean_transactions` 只记录扣减审计，不包含余额、累计获得、累计消费字段；创作结果同步投递状态以 `biz_mgmt_outbox_events` 为准。
- `biz_mgmt_outbox_events` 失败记录必须能定位用户、任务、任务状态、任务 A 豆、事件类型和业管错误。
- `biz_mgmt_outbox_events` 成功记录也必须能定位用户、任务、任务状态、任务 A 豆、事件类型、成功响应和成功时间。

- [ ] **Step 7: 提交验证修正**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify business management account and a bean flow"
```

---

## Self Review

- Spec coverage: 覆盖本地手机号密码登录、每次登录无条件刷新业管会员、首次从业管拉取会员、同手机号多账号、身份选择、team/workspace 初始化、当前身份进入系统、A 豆余额实时查询、A 豆流水查询、生成前扣减、创作结果 outbox 同步、会员副卡 outbox 同步、失败重试和失败记录，并明确 A 豆余额和累计消费不落本地库。
- Placeholder scan: 无 `TBD`、`TODO`、`类似上面` 等占位。
- Type consistency: 后端使用 `biz_mgmt_user_id` 等 snake_case，前端同时接收 camelCase，避免现有代码风格断裂。
- Scope check: 已纳入 A 豆流水查询、A 豆扣减、创作结果同步、会员副卡同步和业管通知 outbox 重试；模型规格同步落库仍作为后续独立计划处理。




