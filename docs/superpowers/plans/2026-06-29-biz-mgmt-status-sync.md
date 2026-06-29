# 业管会员 status 全量同步（1正常/2冻结/3删除）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业管会员状态变化（1正常/2冻结/3删除）正确同步到本地：filter 移除返回全量 status；sync 按 status 分流（1建team/2不动/3软删+清选中）；check 拒绝逻辑改为"无正常或冻结会员才拒绝"；profile 返回冻结身份让前端能看到但不能切换。

**Architecture:** 后端 status 透传链路：fetch 不过滤 → sync 按真实 status 分流处理 binding/team → profile 返回 status∈{1,2} 让前端区分。付费限制与"不可切换"由现有 select/getCurrentBizMgmtIdentity 只认 status=1 天然实现，不改。

**Tech Stack:** Fastify 4 + Kysely（后端）、node:test（测试）。

**关联 spec：** `docs/superpowers/specs/2026-06-29-biz-mgmt-status-sync-design.md`

---

## Files

- Modify: `apps/api/src/services/biz-mgmt-member-sync.ts`（filter 移除 + sync 分流）
- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`（拒绝逻辑）
- Modify: `apps/api/src/services/user-profile.ts`（返回冻结身份 + status 字段）
- Modify: `apps/api/src/__tests__/biz-mgmt-member-sync.test.ts`（新增 status 分流测试）
- Modify: `apps/api/src/__tests__/post-check-biz-mgmt.test.ts`（新增全部 status=3 拒绝测试）

---

## Task 1: fetchBizMgmtMembersByPhone 移除 filter，返回全量 status

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-member-sync.ts`

- [ ] **Step 1: 移除 status=1 过滤 + 更新注释**

将 `fetchBizMgmtMembersByPhone`（约 :95-107）：
```ts
/**
 * 用手机号调用业管 MEMBER-1001 查询会员列表并标准化。
 *
 * 只返回 status=1（正常）的会员；status 非 1 的会员不可被选为当前身份。
 */
export async function fetchBizMgmtMembersByPhone(phone: string): Promise<NormalizedBizMgmtMember[]> {
  const response = await queryTobyMemberLoginInfo({ phone })
  const members = (response.decryptedData as { members?: RawBizMgmtMember[] } | undefined)?.members ?? []
  // MEMBER-1001 返回的 pointsNum/sumPointsNum/consumePointsNum 属于业管实时权益数据。
  // 本服务只同步身份和权益商品信息，不能把 A 豆余额或累计消费落入本地库；
  // 付费生成前必须调用单独的 A 豆余额接口重新获取余额。
  return members.map(normalizeBizMgmtMember).filter((member) => member.status === 1)
}
```
改为：
```ts
/**
 * 用手机号调用业管 MEMBER-1001 查询会员列表并标准化。
 *
 * 返回 status=1/2/3 全部会员（真实 status 透传给 sync 分流处理）：
 * - status=1 正常：建/更新 team，可选可用。
 * - status=2 冻结：sync 记 binding.status=2，team 不动；profile 返回让前端能看到但不可切换；
 *   付费限制由 getCurrentBizMgmtIdentity 只认 status=1 天然实现。
 * - status=3 删除：已入库软删 team，未入库不入库。
 * 是否拒绝登录（全部 status=3）由 check-biz-mgmt 判断，不在本函数过滤。
 */
export async function fetchBizMgmtMembersByPhone(phone: string): Promise<NormalizedBizMgmtMember[]> {
  const response = await queryTobyMemberLoginInfo({ phone })
  const members = (response.decryptedData as { members?: RawBizMgmtMember[] } | undefined)?.members ?? []
  // MEMBER-1001 返回的 pointsNum/sumPointsNum/consumePointsNum 属于业管实时权益数据。
  // 本服务只同步身份和权益商品信息，不能把 A 豆余额或累计消费落入本地库；
  // 付费生成前必须调用单独的 A 豆余额接口重新获取余额。
  return members.map(normalizeBizMgmtMember)
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/services/biz-mgmt-member-sync.ts
git commit -m "refactor(biz-mgmt): fetchBizMgmtMembersByPhone 移除 status=1 过滤，返回全量 status"
```

---

## Task 2: syncBizMgmtMembersForLocalUser 按 status 分流

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-member-sync.ts`

- [ ] **Step 1: 循环内按 status 分流 + 移除 not in 冻结逻辑**

将 `syncBizMgmtMembersForLocalUser` 的事务体（约 :167-256，从 `await db.transaction().execute` 到对应 `})`）整体替换为：

```ts
  await db.transaction().execute(async (trx) => {
    for (const member of members) {
      const existingBinding = await trx
        .selectFrom('biz_mgmt_member_bindings')
        .select(['id', 'team_id', 'workspace_id'])
        .where('biz_mgmt_user_id', '=', member.bizMgmtUserId)
        .executeTakeFirst()

      // ── status=3（删除）：已入库软删 team/workspace，未入库跳过不建 ──────────
      if (member.status === 3) {
        if (existingBinding?.team_id) {
          // 软删该身份的 workspaces
          await trx
            .updateTable('workspaces')
            .set({ is_deleted: true, deleted_at: sql`now()` })
            .where('team_id', '=', existingBinding.team_id)
            .where('is_deleted', '=', false)
            .execute()
          // 软删 team
          await trx
            .updateTable('teams')
            .set({ is_deleted: true, deleted_at: sql`now()` })
            .where('id', '=', existingBinding.team_id)
            .execute()
        }
        // upsert binding 记 status=3（审计保留）；若是当前选中身份，清空 is_selected 避免悬空
        await upsertBinding(trx, localUserId, member, existingBinding, /* clearIfSelected */ true)
        continue
      }

      // ── status=2（冻结）：仅 upsert binding 记 status=2，不建/不删 team ─────────
      // team 若已存在则保留（前端能看到置灰工作区）；若不存在则不建（冻结身份不需要新 team）。
      if (member.status === 2) {
        await upsertBinding(trx, localUserId, member, existingBinding, false)
        continue
      }

      // ── status=1（正常）：现状逻辑，无 team 则建，有则刷新 ───────────────────
      let teamId = existingBinding?.team_id
      let workspaceId = existingBinding?.workspace_id

      // 若该 team 此前被软删过（曾 status=3），现在恢复 → 解除软删
      if (teamId) {
        await trx
          .updateTable('teams')
          .set({ is_deleted: false, deleted_at: null, name: member.teamName, team_type: member.userType === '1' ? 'personal' : 'company_a', updated_at: sql`now()` })
          .where('id', '=', teamId)
          .execute()
        await trx
          .updateTable('workspaces')
          .set({ is_deleted: false, deleted_at: null })
          .where('team_id', '=', teamId)
          .where('is_deleted', '=', true)
          .execute()
      }

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
      }

      if (!workspaceId) {
        const workspace = await trx
          .insertInto('workspaces')
          .values({ team_id: teamId, name: '默认工作区', description: null, created_by: localUserId })
          .returning('id')
          .executeTakeFirstOrThrow()
        workspaceId = workspace.id
        await trx
          .insertInto('workspace_members')
          .values({ workspace_id: workspaceId, user_id: localUserId, role: 'admin' })
          .execute()
      }

      await upsertBinding(trx, localUserId, member, existingBinding, false)
    }
  })
```

- [ ] **Step 2: 新增 upsertBinding 辅助函数（提取重复的 upsert 逻辑 + 处理清空 is_selected）**

在 `syncBizMgmtMembersForLocalUser` 函数**之前**新增辅助函数：

```ts
/**
 * upsert 业管会员绑定记录。
 * - 已存在则刷新身份快照（不含 A 豆数据）；不存在则插入。
 * - clearIfSelected=true 时，若该 binding 是当前选中（is_selected=true），清空 is_selected，
 *   用于 status=3 软删后避免悬空选中。
 */
async function upsertBinding(
  trx: Transaction<Database>,
  localUserId: string,
  member: NormalizedBizMgmtMember,
  existing: { id: string; team_id: string | null; workspace_id: string | null } | undefined,
  clearIfSelected: boolean,
): Promise<void> {
  // 先处理"清空悬空选中"：仅对已存在且当前选中的 binding
  if (clearIfSelected && existing) {
    await trx
      .updateTable('biz_mgmt_member_bindings')
      .set({ is_selected: false, updated_at: sql`now()` })
      .where('id', '=', existing.id)
      .where('is_selected', '=', true)
      .execute()
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
      team_id: existing?.team_id ?? null,
      workspace_id: existing?.workspace_id ?? null,
      last_synced_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .onConflict((oc) =>
      oc.column('biz_mgmt_user_id').doUpdateSet({
        local_user_id: localUserId,
        phone: member.phone,
        user_name: member.userName,
        user_type: member.userType,
        status: member.status,
        comp_name: member.compName,
        goods_id: member.goodsId,
        goods_name: member.goodsName,
        biz_mgmt_created_at: member.bizMgmtCreatedAt ? sql`${member.bizMgmtCreatedAt}::timestamptz` : null,
        last_synced_at: sql`now()`,
        updated_at: sql`now()`,
      }),
    )
    .execute()
}
```

> 注意：导入需补 `Transaction`, `Database` 类型（从 `@aigc/db` 或 kysely）。确认文件顶部已有 `import { sql } from 'kysely'`，补 `import type { Database } from '@aigc/db'` 和 `import type { Transaction } from 'kysely'`。

- [ ] **Step 3: 更新 sync 函数顶部注释（反映 status 分流）**

将 `syncBizMgmtMembersForLocalUser` 上方注释（约 :149-159）中：
```markdown
 * - 同一 biz_mgmt_user_id 复用既有 team_id / workspace_id，避免每次登录重复建团队。
 * - 本次从业管未返回的旧绑定不硬删除，只把 status 标记为非 1（这里置 2=冻结），
 *   防止业管临时异常导致本地权限被误删；恢复后下次登录会重新置回 status=1。
```
改为：
```markdown
 * - 同一 biz_mgmt_user_id 复用既有 team_id / workspace_id，避免每次登录重复建团队。
 * - 按业管真实 status 分流：status=1 建/更新 team；status=2 仅更新 binding 不动 team；
 *   status=3 已入库软删 team、清空 is_selected，未入库不入库。
 * - 不再用"未返回推断冻结"（旧 not in 逻辑已移除），改用业管权威 status。
```

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/services/biz-mgmt-member-sync.ts
git commit -m "feat(biz-mgmt): sync 按业管 status 分流（1建team/2不动/3软删+清选中）"
```

---

## Task 3: check-biz-mgmt 拒绝逻辑改为"无 status=1/2 会员才拒绝"

**Files:**
- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`

- [ ] **Step 1: 拒绝判断改为"无正常或冻结会员"**

将业管查无分支（约 :62-77）：
```ts
    if (members.length === 0) {
      // 业管查无（或故障）：若本地存在该手机号孤儿 user，物理清理后拒绝
      const db = getDb()
      const existingUser = await db
        .selectFrom('users')
        .select(['id'])
        .where('phone', '=', phone)
        .executeTakeFirst()
      if (existingUser) {
        await purgeLocalUserCascade(existingUser.id)
      }
      return reply.status(401).send({
        success: false,
        error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
      })
    }
```
改为（增加"全部 status=3 也拒绝"判断）：
```ts
    // 业管查无（空数组/故障）或全部会员 status=3（删除）→ 视为账户不存在
    const hasUsableMember = members.some((m) => m.status === 1 || m.status === 2)
    if (members.length === 0 || !hasUsableMember) {
      // 若本地存在该手机号孤儿 user，物理清理后拒绝
      const db = getDb()
      const existingUser = await db
        .selectFrom('users')
        .select(['id'])
        .where('phone', '=', phone)
        .executeTakeFirst()
      if (existingUser) {
        await purgeLocalUserCascade(existingUser.id)
      }
      return reply.status(401).send({
        success: false,
        error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
      })
    }
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/routes/auth/post-check-biz-mgmt.ts
git commit -m "feat(auth): check-biz-mgmt 全部 status=3 时拒绝登录（视为账户不存在）"
```

---

## Task 4: user-profile 返回冻结身份（status∈{1,2}）+ 带 status 字段

**Files:**
- Modify: `apps/api/src/services/user-profile.ts`

- [ ] **Step 1: 查询改为 status in (1,2)，select 带 status**

将 `user-profile.ts` 业管绑定查询段（约 :90-133）：
```ts
  // ─── 业务管理平台会员身份选择 ───────────────────────────────────────────
  // 只查 status=1（正常）的业管绑定用于账号选择；为空表示该用户无业管身份
  // （例如内部账号），不影响本地登录主流程。
  // 注意：本查询不读取 A 豆余额——业管余额是权威来源，必须实时调用单独余额接口。
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

  const selectedBinding = bizMgmtRows.find((row) => row.is_selected)
  const bizMgmtMembers = bizMgmtRows.map((row) => ({
    biz_mgmt_user_id: row.biz_mgmt_user_id,
    bizMgmtUserId: row.biz_mgmt_user_id,
    team_id: row.team_id,
    teamId: row.team_id,
    workspace_id: row.workspace_id,
    workspaceId: row.workspace_id,
    user_name: row.user_name,
    userName: row.user_name,
    user_type: row.user_type as '1' | '2',
    userType: row.user_type as '1' | '2',
    comp_name: row.comp_name,
    compName: row.comp_name,
    goods_id: row.goods_id,
    goodsId: row.goods_id,
    goods_name: row.goods_name,
    goodsName: row.goods_name,
    is_selected: row.is_selected,
    isSelected: row.is_selected,
  }))
```
改为：
```ts
  // ─── 业务管理平台会员身份选择 ───────────────────────────────────────────
  // 返回 status=1（正常）和 status=2（冻结）的业管绑定：
  // - 正常身份可选可用；冻结身份前端能看到（工作区列表置灰）但 select 接口只认 status=1 不可切换。
  // - status=3（删除）不返回。
  // 注意：本查询不读取 A 豆余额——业管余额是权威来源，必须实时调用单独余额接口。
  const bizMgmtRows = await db
    .selectFrom('biz_mgmt_member_bindings')
    .select([
      'biz_mgmt_user_id',
      'team_id',
      'workspace_id',
      'user_name',
      'user_type',
      'status',
      'comp_name',
      'goods_id',
      'goods_name',
      'is_selected',
    ])
    .where('local_user_id', '=', userId)
    .where('status', 'in', [1, 2])
    .orderBy('user_type', 'asc')
    .orderBy('created_at', 'asc')
    .execute()

  const selectedBinding = bizMgmtRows.find((row) => row.is_selected)
  const bizMgmtMembers = bizMgmtRows.map((row) => ({
    biz_mgmt_user_id: row.biz_mgmt_user_id,
    bizMgmtUserId: row.biz_mgmt_user_id,
    team_id: row.team_id,
    teamId: row.team_id,
    workspace_id: row.workspace_id,
    workspaceId: row.workspace_id,
    user_name: row.user_name,
    userName: row.user_name,
    user_type: row.user_type as '1' | '2',
    userType: row.user_type as '1' | '2',
    status: row.status as 1 | 2,
    comp_name: row.comp_name,
    compName: row.comp_name,
    goods_id: row.goods_id,
    goodsId: row.goods_id,
    goods_name: row.goods_name,
    goodsName: row.goods_name,
    is_selected: row.is_selected,
    isSelected: row.is_selected,
  }))
```

- [ ] **Step 2: 提交**

```bash
git add apps/api/src/services/user-profile.ts
git commit -m "feat(profile): 返回冻结业管身份(status=2)并透传 status 字段，前端可见不可切换"
```

---

## Task 5: 同步测试 + 验证

**Files:**
- Modify: `apps/api/src/__tests__/biz-mgmt-member-sync.test.ts`
- Modify: `apps/api/src/__tests__/post-check-biz-mgmt.test.ts`

- [ ] **Step 1: biz-mgmt-member-sync.test.ts 新增 status 分流断言**

在文件末尾追加：
```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SYNC_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'biz-mgmt-member-sync.ts'),
  'utf8',
)

test('fetchBizMgmtMembersByPhone 不再过滤 status=1，返回全量 status', () => {
  // 旧代码有 .filter((member) => member.status === 1)，移除后不应出现
  assert.doesNotMatch(
    SYNC_SOURCE,
    /\.filter\(\s*\(\s*member\s*\)\s*=>\s*member\.status\s*===\s*1\s*\)/,
    'fetchBizMgmtMembersByPhone 不应再过滤 status===1，需返回全量 status 给 sync 分流',
  )
})

test('sync 按 status 分流：status=3 软删 team，status=2 不软删，status=1 建 team', () => {
  // status=3 分支必须软删 team（is_deleted=true）
  assert.match(SYNC_SOURCE, /member\.status\s*===\s*3[\s\S]*is_deleted.*true/, 'status=3 必须软删 team')
  // status=3 必须清空悬空 is_selected
  assert.match(SYNC_SOURCE, /member\.status\s*===\s*3[\s\S]*is_selected.*false|clearIfSelected/, 'status=3 必须清空 is_selected')
  // 旧的 not in 冻结逻辑必须移除
  assert.doesNotMatch(SYNC_SOURCE, /'not in'[\s\S]*biz_mgmt_member_bindings.*status.*2/, '不应再用 not in 推断冻结')
})

test('normalizeBizMgmtMember 保留 status 1/2/3（不再强制过滤）', () => {
  // status=3 的会员应能被 normalize（不抛错）
  const result = normalizeBizMgmtMember({
    userId: 'X', phone: '1', userName: 'u', compName: 'c', userType: '1', status: 3,
  })
  assert.equal(result.status, 3)
})
```

> 注意：文件顶部已有 `import { fileURLToPath } from 'node:url'`？读文件确认；若没有，补上 `import { fileURLToPath } from 'node:url'`。`readFileSync`/`dirname`/`join` 需补导入。

- [ ] **Step 2: post-check-biz-mgmt.test.ts 新增"全部 status=3 拒绝"断言**

在 describe 块末尾追加：
```ts
  it('业管返回全部 status=3（删除）时必须拒绝登录（视为账户不存在）', () => {
    assert.match(
      SOURCE,
      /status\s*===\s*1\s*\|\|\s*m\.status\s*===\s*2|status.*1.*status.*2/,
      'check 必须判断"无 status=1 或 2 的会员"才拒绝，全部 status=3 视为账户不存在',
    )
  })
```

- [ ] **Step 3: 运行测试**

Run:
```bash
cd apps/api
node --test --import tsx src/__tests__/biz-mgmt-member-sync.test.ts src/__tests__/post-check-biz-mgmt.test.ts src/__tests__/post-login-biz-mgmt-first.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 4: TypeScript 类型检查**

Run: `pnpm --filter @aigc/api exec tsc --noEmit`
Expected: EXIT=0（重点确认 upsertBinding 的 Transaction/Database 类型、user-profile 的 status 字段类型）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/__tests__/biz-mgmt-member-sync.test.ts apps/api/src/__tests__/post-check-biz-mgmt.test.ts
git commit -m "test(biz-mgmt): status 全量同步 + 分流 + 全部删除拒绝 契约测试"
```

---

## Self Review

- **Spec coverage**：
  - spec 2.1（filter 移除）→ Task 1。覆盖。
  - spec 2.2（sync 分流）→ Task 2。覆盖（含 status=3 软删+清 is_selected、status=2 不动、status=1 含恢复软删）。
  - spec 2.3（check 拒绝）→ Task 3。覆盖。
  - spec 2.4（付费限制现状）→ 不改代码，Task 5 测试不涉及（天然实现）。
  - spec 2.5（profile 透传）→ Task 4。覆盖。
  - spec 风险点 7（悬空 is_selected）→ Task 2 Step 2 的 clearIfSelected 处理。覆盖。
- **Placeholder scan**：无 TBD；代码片段完整可粘贴。
- **Type consistency**：`NormalizedBizMgmtMember.status: 1|2|3`（schema 已是）；upsertBinding 签名 `(trx, localUserId, member, existing, clearIfSelected)`；profile status 字段 `as 1|2`。
- **YAGNI**：不改 select/getCurrentBizMgmtIdentity（天然实现）；不改前端置灰 UI（后端先透传 status）；不做物理删除。
- **风险**：Task 2 status=1 分支新增"恢复软删 team"逻辑（曾 status=3 后又回 1），需确认 teams 表 updated_at 字段存在（schema 有）；upsertBinding 提取后 status=3 路径 team_id 取自 existing（可能为 null，软删分支已判 existingBinding?.team_id）。
