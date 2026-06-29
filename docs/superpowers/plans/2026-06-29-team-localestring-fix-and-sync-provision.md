# 团队管理 toLocaleString 修复 + check 同步建 team 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复登录后进团队管理页 toLocaleString 崩溃；把为每个业管账号建 team/workspace 的时机从「login 后异步」改为「check 阶段同步」，消除窗口期。

**Architecture:** 前端 member-list 移除对已退役 credit 字段的依赖（本地积分退役后后端不再返回）；后端建 team 责任完全移到 check-biz-mgmt（await 同步），login 不再异步 sync。

**Tech Stack:** Fastify 4 + Kysely（后端）、Next.js 14 + React + SWR（前端）。

**关联 spec：** `docs/superpowers/specs/2026-06-29-team-localestring-fix-and-sync-provision-design.md`

---

## Files

- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`（建 user 后同步建 team）
- Modify: `apps/api/src/routes/auth/post-login.ts`（移除异步 sync）
- Modify: `apps/web/src/components/team/member-list.tsx`（重构去 credit 字段）
- Modify: `apps/api/src/__tests__/post-check-biz-mgmt.test.ts`（新增 sync 断言）
- Modify: `apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`（login 不再 sync 断言）

---

## Task 1: 后端 check-biz-mgmt 同步建 team

**Files:**
- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`

- [ ] **Step 1: 导入 syncBizMgmtMembersForLocalUser**

将第 3 行：
```ts
import { ensureLocalUserForBizMgmtPhone, fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'
```
改为：
```ts
import { ensureLocalUserForBizMgmtPhone, syncBizMgmtMembersForLocalUser, fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'
```

- [ ] **Step 2: 业管有会员分支 —— 老用户补建 team + 新用户建 user 后建 team**

将第 77-92 行（业管有会员分支整段）：
```ts
    // 业管有会员：预建本地 user（本地无则建 + 生成一次性初始密码），再让前端进入密码步。
    // 建 user 责任在 check 阶段完成，login 阶段只校验密码；老用户不重建、不返密码。
    const db = getDb()
    const existingUser = await db
      .selectFrom('users')
      .select(['id'])
      .where('phone', '=', phone)
      .executeTakeFirst()
    if (existingUser) {
      // 老用户：本地已有 user，直接进密码步，不返密码
      return { exists: true }
    }
    // 新用户：业管有会员但本地无 user → 预建 user + 生成一次性初始密码
    const created = await ensureLocalUserForBizMgmtPhone(phone)
    // ensureLocalUserForBizMgmtPhone 内部已确认业管有 status=1 会员；oneTimePassword 仅新建时非空
    return { exists: true, one_time_password: created.oneTimePassword }
```
改为：
```ts
    // 业管有会员：预建本地 user（本地无则建 + 生成一次性初始密码），并【同步】为每个
    // 业管账号建好 team/workspace/binding，再让前端进入密码步。
    // 建 user 与建 team 责任都在 check 阶段同步完成，消除"已登录但 team 未建好"的窗口期；
    // login 阶段只校验密码。syncBizMgmtMembersForLocalUser 幂等，老用户重复登录不会重建已存在的 team。
    const db = getDb()
    const existingUser = await db
      .selectFrom('users')
      .select(['id'])
      .where('phone', '=', phone)
      .executeTakeFirst()
    const localUserId = existingUser?.id
    if (!localUserId) {
      // 新用户：业管有会员但本地无 user → 预建 user + 生成一次性初始密码
      const created = await ensureLocalUserForBizMgmtPhone(phone)
      // ensureLocalUserForBizMgmtPhone 内部已确认业管有 status=1 会员；oneTimePassword 仅新建时非空
      // 同步为每个业管账号建 team/workspace/binding
      await syncBizMgmtMembersForLocalUser(created.userId, phone)
      return { exists: true, one_time_password: created.oneTimePassword }
    }
    // 老用户：同步刷新业管绑定，补建缺失的 team/workspace（幂等，已有不重建）
    await syncBizMgmtMembersForLocalUser(localUserId, phone)
    return { exists: true }
```

- [ ] **Step 3: 更新顶部接口文档注释（补"同步建 team"说明）**

将注释中：
```markdown
 * - 200 { exists: true, one_time_password: string }：业管有会员但本地无 user（新用户）。
 *   本接口此时【预建本地 user + 生成一次性初始密码】并随响应返回，前端进密码步后展示该密码供用户登录。
```
改为：
```markdown
 * - 200 { exists: true, one_time_password: string }：业管有会员但本地无 user（新用户）。
 *   本接口此时【预建本地 user + 生成一次性初始密码 + 同步为每个业管账号建 team/workspace/binding】
 *   并随响应返回初始密码，前端进密码步后展示该密码供用户登录。
 * - 200 { exists: true }：业管有会员且本地已有 user（老用户）。本接口同步刷新业管绑定、补建缺失 team。
```

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/auth/post-check-biz-mgmt.ts
git commit -m "feat(auth): check-biz-mgmt 同步为每个业管账号建 team/workspace，消除窗口期"
```

---

## Task 2: 后端 post-login 移除异步 sync

**Files:**
- Modify: `apps/api/src/routes/auth/post-login.ts`

- [ ] **Step 1: 移除 setImmediate 异步 sync 块**

将第 206-216 行：
```ts
    // 业管会员同步：改为异步触发，不阻塞登录响应。
    // 关键不变量：每次手机号登录成功后都要刷新业管绑定，发现用户新增的管理/公司账号；
    // 但业管查询耗时不应拖慢登录，故用 setImmediate 移出请求关键路径，失败只记日志。
    if (user.phone) {
      setImmediate(() => {
        syncBizMgmtMembersForLocalUser(user!.id, user!.phone!).catch((err) => {
          // 异步同步失败不影响已完成的登录，只记日志便于排查
          request.log.error({ err, userId: user!.id }, '业管会员异步同步失败（不影响登录）')
        })
      })
    }

```
整段删除（含尾随空行）。

- [ ] **Step 2: 移除 syncBizMgmtMembersForLocalUser 导入**

将第 10-14 行：
```ts
import {
  syncBizMgmtMembersForLocalUser,
  fetchBizMgmtMembersByPhone,
  purgeLocalUserCascade,
} from '../../services/biz-mgmt-member-sync.js'
```
改为：
```ts
import {
  fetchBizMgmtMembersByPhone,
  purgeLocalUserCascade,
} from '../../services/biz-mgmt-member-sync.js'
```

- [ ] **Step 3: 更新顶部控制流注释（移除"异步刷新"项）**

将第 102 行：
```
  //  3. 登录成功后异步刷新业管绑定（setImmediate，不 await，不阻塞登录性能）。
```
改为：
```
  //  3. 登录只校验密码 + 签发 token；业管绑定刷新与建 team 已在 check-biz-mgmt 完成。
```

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/auth/post-login.ts
git commit -m "refactor(auth): post-login 移除异步 sync，建 team 责任完全交给 check-biz-mgmt"
```

---

## Task 3: 前端 member-list 重构（去 credit 字段）

**Files:**
- Modify: `apps/web/src/components/team/member-list.tsx`

> 整体重写为本地积分退役后的纯成员管理。保留：成员列表表格（用户名/账户/角色/加入时间）、添加成员、批量添加、移除成员。移除：配额列、已用/剩余列、编辑配额对话框、批量改配额、重置 A 豆、所有 credit 相关 state/handler/辅助。

- [ ] **Step 1: 整体替换文件内容**

用以下完整内容替换 `apps/web/src/components/team/member-list.tsx` 全文：

```tsx
'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiDelete, ApiError } from '@/lib/api-client'
import { InviteDialog } from './invite-dialog'
import { BatchInviteDialog } from './batch-invite-dialog'
import { useConfirm } from '@/hooks/use-confirm'
import { toast } from 'sonner'
import { UserPlus, Trash2, Users } from 'lucide-react'

// 本地积分系统已退役：credit_used / credit_quota / credits 等字段后端不再返回。
// 本组件只做纯成员管理（列表/添加/批量添加/移除），A 豆流水后续对接业管平台。
interface Member {
  user_id: string
  account: string
  username: string
  avatar_url: string | null
  role: string
  joined_at: string
}

interface TeamData {
  id: string
  name: string
  members: Member[]
}

const roleBadgeVariant = {
  owner: 'default',
  admin: 'secondary',
  editor: 'outline',
  viewer: 'outline',
} as const

const roleLabel: Record<string, string> = {
  owner: '组长',
  admin: '管理员',
  editor: '编辑',
  viewer: '查看',
}

export function MemberList({ teamId }: { teamId: string }) {
  const confirm = useConfirm()
  const { data, error, mutate } = useSWR<TeamData>(`/teams/${teamId}`, {
    // Skip retry on 429 (rate-limited) — prevent hammering the server when overloaded
    onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
      if (err instanceof ApiError && err.status === 429) return
      if (retryCount >= 3) return
      setTimeout(() => revalidate({ retryCount }), 5000)
    },
  })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [batchInviteOpen, setBatchInviteOpen] = useState(false)

  // Delayed mutate: give the DB a moment to commit before re-fetching
  const delayedMutate = (ms = 400) => new Promise<void>(res => setTimeout(() => { mutate(); res() }, ms))

  if (!data && !error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  async function handleRemoveMember(member: Member) {
    if (!await confirm({ title: '移除成员', description: `确定要移除 ${member.username} 吗？`, confirmText: '移除' })) return
    try {
      await apiDelete(`/teams/${teamId}/members/${member.user_id}`)
      toast.success('成员已移除')
      delayedMutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">成员列表</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setBatchInviteOpen(true)}>
              <Users className="h-4 w-4 mr-2" />
              批量添加
            </Button>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              添加成员
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">用户名</th>
                  <th className="text-left py-2 px-2 font-medium">账户</th>
                  <th className="text-left py-2 px-2 font-medium">角色</th>
                  <th className="text-left py-2 px-2 font-medium">加入时间</th>
                  <th className="text-right py-2 px-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.members.map((member) => {
                  const joinedAt = member.joined_at ? new Date(member.joined_at) : null
                  return (
                    <tr key={member.user_id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{member.username}</td>
                      <td className="py-2 px-2 text-muted-foreground">{member.account}</td>
                      <td className="py-2 px-2">
                        <Badge variant={roleBadgeVariant[member.role as keyof typeof roleBadgeVariant] ?? 'outline'}>
                          {roleLabel[member.role] ?? member.role}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {joinedAt ? `${joinedAt.getFullYear()}-${String(joinedAt.getMonth() + 1).padStart(2, '0')}-${String(joinedAt.getDate()).padStart(2, '0')}` : '-'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {member.role !== 'owner' && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="移除成员"
                              onClick={() => handleRemoveMember(member)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <InviteDialog
        teamId={teamId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => delayedMutate(600)}
      />

      {/* Batch Invite Dialog */}
      <BatchInviteDialog
        teamId={teamId}
        open={batchInviteOpen}
        onOpenChange={setBatchInviteOpen}
        onSuccess={() => delayedMutate(800)}
      />
    </>
  )
}
```

- [ ] **Step 2: 检查 team-credits-settings 是否也被团队管理页引用（确认 toLocaleString 是否还有其他来源）**

Run: 读 `apps/web/src/components/team/team-credits-settings.tsx`，确认它是否也调 `.toLocaleString()` 并依赖已废弃字段。
- 若是且它仍在 `team/page.tsx:64` 被渲染 → 本次范围内的 toLocaleString 主因是 member-list（已修），team-credits-settings 的 A 豆设置 tab 属于"A 豆流水对接业管"的后续工程，本次**不展开**，但记录待办。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/team/member-list.tsx
git commit -m "fix(web): member-list 移除已退役 credit 字段依赖，修复 toLocaleString 崩溃"
```

---

## Task 4: 同步测试（check + login）

**Files:**
- Modify: `apps/api/src/__tests__/post-check-biz-mgmt.test.ts`
- Modify: `apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`

- [ ] **Step 1: post-check-biz-mgmt.test.ts 新增 sync 断言**

在 `post-check-biz-mgmt.test.ts` 的 `describe` 块末尾（第 75 行 `})` 之前）新增两个测试：
```ts
  it('必须导入并调用 syncBizMgmtMembersForLocalUser（同步为每个业管账号建 team）', () => {
    assert.match(SOURCE, /syncBizMgmtMembersForLocalUser/, 'check 必须调 syncBizMgmtMembersForLocalUser 同步建 team')
  })

  it('syncBizMgmtMembersForLocalUser 必须用 await 同步调用（不能用 setImmediate 异步）', () => {
    assert.match(
      SOURCE,
      /await\s+syncBizMgmtMembersForLocalUser/,
      '建 team 必须 await 同步完成，消除"已登录但 team 未建好"的窗口期',
    )
    assert.doesNotMatch(
      SOURCE,
      /setImmediate[^]*syncBizMgmtMembersForLocalUser/,
      'check 中禁止用 setImmediate 异步建 team',
    )
  })
```

- [ ] **Step 2: post-login-biz-mgmt-first.test.ts 反转 sync 断言**

将原"异步刷新不变量" describe 块（约第 131-148 行）：
```ts
// ─── 不变量：业管同步异步化（不阻塞登录）──────────────────────────────────
describe('post-login 业管先行：异步刷新不变量', () => {
  it('syncBizMgmtMembersForLocalUser 必须异步调用（不 await，不阻塞登录响应）', () => {
    // 关键：不能用 await syncBizMgmtMembersForLocalUser，否则业管慢会拖慢登录
    // 应使用 setImmediate / queueMicrotask / .catch() 等异步触发
    assert.match(
      SOURCE,
      /setImmediate\([^)]*syncBizMgmtMembersForLocalUser|queueMicrotask\([^)]*syncBizMgmtMembersForLocalUser|syncBizMgmtMembersForLocalUser[^;]*\.catch/,
      'syncBizMgmtMembersForLocalUser 必须异步触发（setImmediate/queueMicrotask/.catch），不能用 await 阻塞登录',
    )
    // 反向断言：不允许出现 "await syncBizMgmtMembersForLocalUser"
    assert.doesNotMatch(
      SOURCE,
      /await\s+syncBizMgmtMembersForLocalUser/,
      '禁止 await syncBizMgmtMembersForLocalUser，会阻塞登录响应',
    )
  })
})
```
替换为：
```ts
// ─── 不变量：建 team 责任移到 check，login 不再 sync ────────────────────────
describe('post-login 业管先行：login 不再建 team', () => {
  it('login 禁止调用 syncBizMgmtMembersForLocalUser（建 team 责任已移到 check-biz-mgmt）', () => {
    assert.doesNotMatch(
      SOURCE,
      /syncBizMgmtMembersForLocalUser/,
      '建 team 责任已移到 check-biz-mgmt，post-login 不应再调用 syncBizMgmtMembersForLocalUser',
    )
  })
})
```

- [ ] **Step 3: 运行两个测试验证通过**

Run:
```bash
cd apps/api
node --test --import tsx src/__tests__/post-check-biz-mgmt.test.ts
node --test --import tsx src/__tests__/post-login-biz-mgmt-first.test.ts
```
Expected: 两个文件全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/__tests__/post-check-biz-mgmt.test.ts apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts
git commit -m "test(auth): 同步 check/login 契约，建 team 责任移到 check 同步执行"
```

---

## Task 5: 端到端验证

**Files:** 无改动，仅校验。

- [ ] **Step 1: 跑全部 auth 相关测试**

Run:
```bash
cd apps/api
node --test --import tsx src/__tests__/post-check-biz-mgmt.test.ts src/__tests__/post-login-biz-mgmt-first.test.ts src/__tests__/biz-mgmt-member-sync.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 2: TypeScript 类型检查（api + web）**

Run:
```bash
pnpm --filter @aigc/api exec tsc --noEmit
pnpm --filter @aigc/web exec tsc --noEmit 2>&1 | grep -iE "member-list|team" | head
```
Expected: api EXIT=0；web 无 member-list/team 相关错误。
（遵循 AGENTS.md 本地验证边界：web 若因 dev 缓存报无关错误，记录但不阻塞。）

- [ ] **Step 3: 人工核对控制流**

Read 改后的 post-check-biz-mgmt.ts 与 post-login.ts，确认：
1. check：业管有会员 → 查本地 → 无则建 user + sync 建 team + 返密码 / 有则 sync 建 team + 返 exists。
2. login：不再有 syncBizMgmtMembersForLocalUser、不再有 setImmediate sync；保留业管查询/校验/孤儿清理。
3. member-list：无 credit_used/credit_quota/credits 任何引用；表格列为 用户名/账户/角色/加入时间/操作。

- [ ] **Step 4: 最终提交确认**

```bash
git status
git log --oneline -6
```

---

## Self Review

- **Spec coverage**：
  - spec 4.1（member-list 去 credit）→ Task 3。覆盖。
  - spec 4.2（check 同步建 team）→ Task 1。覆盖。
  - spec 5.3（login 移除异步 sync）→ Task 2。覆盖。
  - spec 5.4（测试同步）→ Task 4。覆盖。
  - spec 七验收标准 → Task 5 Step 3 逐条核对。覆盖。
- **Placeholder scan**：无 TBD/TODO；member-list 为完整可粘贴全文；其余为精确 old/new 片段。
- **Type consistency**：`syncBizMgmtMembersForLocalUser(userId, phone)` 签名一致；`Member` 接口去 credit 后与后端 `get-by-id.ts` 返回字段对齐（user_id/account/username/avatar_url/role/joined_at）。
- **YAGNI**：不做同手机号多 user；不接业管 A 豆流水；不改 sync 内部建 team 逻辑；不改 SSO/邀请/工作区。
- **风险**：member-list 删除了配额/重置 A 豆功能（用户已确认下线）；team-credits-settings 的 A 豆 tab 待后续对接业管时处理（Task 3 Step 2 记录）。
