# Security & UX Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 14 security vulnerabilities and UX issues identified in the account logic audit.

**Architecture:** Fixes are organized by severity — critical security first, then permission logic, then UX improvements. Each task is independent and results in a working commit.

**Tech Stack:** Fastify (API), Kysely (SQL), React/Next.js (Web), BullMQ (Worker), Redis (SSE pub/sub)

---

## Task 1: SSE Endpoint — Add Authorization Check

**Priority:** CRITICAL — data leakage
**Files:**
- Modify: `apps/api/src/routes/sse.ts:77`

**Problem:** `GET /sse/batches/:id` has zero auth. Anyone with a batch ID can see other users' prompts/images in real-time.

**Step 1: Add authorization to SSE endpoint**

In `sse.ts`, after extracting `batchId`, add auth check before sending any data. The SSE route is registered under the same Fastify instance that has the `jwtAuthPlugin`, so `request.user` is available. Verify ownership or workspace membership:

```typescript
app.get<{ Params: { id: string } }>('/sse/batches/:id', async (request, reply) => {
  const { id: batchId } = request.params
  const userId = request.user.id

  // Verify the user can access this batch
  const db = getDb()
  const batch = await db
    .selectFrom('task_batches')
    .select(['user_id', 'workspace_id'])
    .where('id', '=', batchId)
    .executeTakeFirst()

  if (!batch) {
    return reply.notFound('Batch not found')
  }

  // Allow if: batch owner, admin, or workspace member
  let authorized = batch.user_id === userId || request.user.role === 'admin'
  if (!authorized && batch.workspace_id) {
    const wsMember = await db
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', batch.workspace_id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    authorized = !!wsMember
  }

  if (!authorized) {
    return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this batch' } })
  }

  // ... rest of SSE logic (set headers, subscribe, etc.)
```

**Step 2: Verify the auth plugin runs on /sse routes**

Check that the SSE route is NOT listed in `PUBLIC_ROUTES` in `jwt-auth.ts`. Currently `PUBLIC_ROUTES` only has `/api/v1/healthz`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/accept-invite` — so SSE routes are already authenticated. Confirm this by looking at the route prefix registration.

**Step 3: Commit**

```
fix(api): add authorization check to SSE batch endpoint
```

---

## Task 2: Credit Freeze — Fix Race Condition

**Priority:** CRITICAL — money loss
**Files:**
- Modify: `apps/api/src/services/credit.ts:14-27`

**Problem:** Member quota check (line 16-27) runs BEFORE `FOR UPDATE` lock (line 30). Concurrent requests can both pass the quota check before either acquires the lock, causing quota overuse.

**Step 1: Move quota check after the lock**

Restructure `freezeCredits` so the `FOR UPDATE` lock on `credit_accounts` is acquired first, then check member quota with a `FOR UPDATE` on `team_members` too:

```typescript
export async function freezeCredits(
  teamId: string,
  userId: string,
  amount: number,
): Promise<{ creditAccountId: string }> {
  const db = getDb()

  return await db.transaction().execute(async (trx: any) => {
    // 1. Lock the team credit account FIRST
    const account = await sql<{ id: string; balance: number; frozen_credits: number }>`
      SELECT id, balance, frozen_credits
      FROM credit_accounts
      WHERE team_id = ${teamId} AND owner_type = 'team'
      FOR UPDATE
    `.execute(trx)

    const row = account.rows[0]
    if (!row) throw new Error('Team credit account not found')

    if (row.balance - row.frozen_credits < amount) {
      throw new Error('Insufficient team credits')
    }

    // 2. Lock and check member quota
    const member = await sql<{ credit_quota: number | null; credit_used: number }>`
      SELECT credit_quota, credit_used
      FROM team_members
      WHERE team_id = ${teamId} AND user_id = ${userId}
      FOR UPDATE
    `.execute(trx)

    const memberRow = member.rows[0]
    if (memberRow?.credit_quota !== null && memberRow?.credit_quota !== undefined) {
      if ((memberRow.credit_used ?? 0) + amount > memberRow.credit_quota) {
        throw new Error('Member credit quota exceeded')
      }
    }

    // 3. Freeze from team pool
    await trx.updateTable('credit_accounts').set({
      frozen_credits: sql`frozen_credits + ${amount}`,
    }).where('id', '=', row.id).execute()

    // 4. Update member usage
    await trx.updateTable('team_members').set({
      credit_used: sql`credit_used + ${amount}`,
    }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()

    // 5. Ledger entry
    await trx.insertInto('credits_ledger').values({
      credit_account_id: row.id,
      user_id: userId,
      amount: -amount,
      type: 'freeze',
      description: 'Credits frozen for image generation',
    }).execute()

    return { creditAccountId: row.id }
  })
}
```

**Step 2: Commit**

```
fix(api): fix race condition in credit freeze by locking rows before checking quotas
```

---

## Task 3: Admin Credit Deduction — Account for Frozen Credits

**Priority:** HIGH
**Files:**
- Modify: `apps/api/src/routes/admin.ts:382-417`

**Problem:** Admin deduction checks `balance` but ignores `frozen_credits`. Available = balance - frozen. Deducting more than available will break in-flight generation tasks.

**Step 1: Fetch frozen_credits and check available balance**

```typescript
const creditAccount = await db
  .selectFrom('credit_accounts')
  .select(['id', 'balance', 'frozen_credits'])
  .where('team_id', '=', request.params.id)
  .where('owner_type', '=', 'team')
  .executeTakeFirst()

// ... in the deduction branch:
const deduction = Math.abs(amount)
const available = Number(creditAccount.balance) - Number(creditAccount.frozen_credits)
if (available < deduction) {
  return reply.badRequest(
    `可扣减余额不足。当前余额: ${creditAccount.balance}, 冻结中: ${creditAccount.frozen_credits}, 可用: ${available}, 请求扣减: ${deduction}`
  )
}
```

**Step 2: Also update the frontend topup-dialog to show frozen_credits**

In `topup-dialog.tsx`, update the props interface and display to show frozen credits when relevant, so admin knows how much is available.

**Step 3: Commit**

```
fix(api): account for frozen credits when admin deducts team balance
```

---

## Task 4: Admin Generation — Fix Credit Tracking

**Priority:** HIGH
**Files:**
- Modify: `apps/api/src/routes/generate.ts:34-62`

**Problem:** Admin bypasses workspace membership check. If admin is not a `team_member`, `freezeCredits` will fail to find `team_members` row -> `credit_used` update hits 0 rows silently. Also, admin has no quota so can drain any team's credits.

**Step 1: Ensure admin is a team member before generating**

When admin generates, verify they exist in `team_members` for that team. If not, skip the generation or require explicit team membership. Simplest fix: admin must be in the team to generate (they already have their own admin team).

```typescript
// After getting teamId, verify membership for ALL users (including admin):
const teamMember = await db
  .selectFrom('team_members')
  .select('user_id')
  .where('team_id', '=', teamId)
  .where('user_id', '=', userId)
  .executeTakeFirst()

if (!teamMember) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Must be a team member to generate images' },
  })
}
```

Keep the admin workspace membership bypass (admin can see all workspaces), but require team membership for credit accounting.

**Step 2: Commit**

```
fix(api): require team membership for generation to ensure credit tracking
```

---

## Task 5: Member Removal — Handle In-Flight Tasks

**Priority:** HIGH
**Files:**
- Modify: `apps/api/src/routes/teams.ts:146-190`

**Problem:** Removing a team member who has frozen credits (in-flight tasks) causes accounting errors when tasks complete/fail.

**Step 1: Block removal if member has frozen tasks**

Before deleting the member, check if they have any pending/processing tasks in the team:

```typescript
// After checking member exists and is not owner:
const pendingBatches = await db
  .selectFrom('task_batches')
  .select(db.fn.count('id').as('count'))
  .where('team_id', '=', request.params.id)
  .where('user_id', '=', request.params.uid)
  .where('status', 'in', ['pending', 'processing'])
  .executeTakeFirstOrThrow()

if (Number(pendingBatches.count) > 0) {
  return reply.status(409).send({
    success: false,
    error: {
      code: 'HAS_PENDING_TASKS',
      message: '该成员有进行中的生成任务，请等待任务完成后再移除',
    },
  })
}
```

**Step 2: Commit**

```
fix(api): prevent removing team members with in-flight generation tasks
```

---

## Task 6: Workspace Member Role — Validate Against Team Role Hierarchy

**Priority:** MEDIUM
**Files:**
- Modify: `apps/api/src/routes/workspaces.ts:78-136`

**Problem:** A team `viewer` can be added to a workspace as `admin`, granting higher-than-expected privileges.

**Step 1: Cap workspace role at team role level**

After verifying team membership, fetch the team role and cap the workspace role:

```typescript
const teamMember = await db
  .selectFrom('team_members')
  .select(['user_id', 'role'])
  .where('team_id', '=', workspace.team_id)
  .where('user_id', '=', user_id)
  .executeTakeFirst()

if (!teamMember) {
  return reply.status(400).send({
    success: false,
    error: { code: 'NOT_TEAM_MEMBER', message: 'User must be a team member first' },
  })
}

// Cap workspace role: can't exceed team role
const TEAM_TO_WS_CAP: Record<string, string> = {
  owner: 'admin',   // team owner can be ws admin (max ws role)
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
}
const WS_ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }
const maxWsRole = TEAM_TO_WS_CAP[teamMember.role] ?? 'viewer'
const requestedRole = (role ?? 'editor') as string
const effectiveRole = WS_ROLE_RANK[requestedRole] > WS_ROLE_RANK[maxWsRole] ? maxWsRole : requestedRole
```

Then use `effectiveRole` in the insert.

**Step 2: Commit**

```
fix(api): cap workspace role based on team role hierarchy
```

---

## Task 7: Error Messages — Chinese Localization

**Priority:** MEDIUM — UX
**Files:**
- Modify: `apps/api/src/services/credit.ts` (3 error messages)
- Modify: `apps/api/src/routes/generate.ts` (error response handling)

**Problem:** Credit errors return English like "Member credit quota exceeded" — editor sees raw English in toast.

**Step 1: Localize credit service errors**

```typescript
// credit.ts
throw new Error('个人积分配额已用尽，请联系团队负责人增加配额')
// instead of 'Member credit quota exceeded'

throw new Error('团队积分余额不足')
// instead of 'Insufficient team credits'

throw new Error('未找到团队积分账户')
// instead of 'Team credit account not found'
```

**Step 2: Localize generate.ts errors**

```typescript
// generate.ts - workspace membership
error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' }

// viewer check
error: { code: 'FORBIDDEN', message: '查看者无权生成图片' }

// model not found
reply.notFound(`模型 "${model}" 未找到或已停用`)
```

**Step 3: Commit**

```
fix: localize error messages to Chinese for end-user-facing errors
```

---

## Task 8: completePipeline — Fix credit_used Discrepancy

**Priority:** MEDIUM
**Files:**
- Modify: `apps/worker/src/pipelines/complete.ts:36-45`

**Problem:** `freezeCredits` increments `credit_used += estimatedCredits`, but if `actualCredits != estimatedCredits` on completion, `credit_used` remains wrong. Need to adjust the delta.

**Step 1: Add credit_used adjustment in completePipeline**

After the credit account update, add a `team_members.credit_used` adjustment:

```typescript
// After the credit_accounts update:
// Adjust member credit_used: was incremented by estimated at freeze, correct to actual
if (actualCredits !== estimatedCredits) {
  const delta = actualCredits - estimatedCredits  // negative if actual < estimated
  await trx.updateTable('team_members').set({
    credit_used: sql`credit_used + ${delta}`,
  }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()
}
```

**Step 2: Commit**

```
fix(worker): adjust member credit_used when actual differs from estimated
```

---

## Task 9: Password Minimum Length — Strengthen to 8

**Priority:** LOW
**Files:**
- Modify: `apps/api/src/routes/auth.ts:126`

**Step 1: Change minimum password length**

```typescript
if (password.length < 8) {
  return reply.badRequest('密码长度至少为 8 个字符')
}
```

**Step 2: Commit**

```
fix(api): increase minimum password length to 8 characters
```

---

## Task 10: Refresh Token Rotation

**Priority:** LOW
**Files:**
- Modify: `apps/api/src/routes/auth.ts:71-101`

**Problem:** Refresh token is never rotated — if stolen, valid for full 7 days.

**Step 1: Rotate refresh token on each use**

After validating the old token, revoke it and issue a new one:

```typescript
// POST /auth/refresh
// ... after validating stored token ...

// Revoke old token
await db.updateTable('refresh_tokens')
  .set({ revoked_at: sql`NOW()` })
  .where('id', '=', stored.token_id)
  .execute()

// Issue new refresh token
const newRefreshToken = signRefreshToken()
const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex')

await db.insertInto('refresh_tokens').values({
  user_id: stored.id,
  token_hash: newTokenHash,
  expires_at: sql`NOW() + INTERVAL '7 days'`,
}).execute()

reply.setCookie('refresh_token', newRefreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60,
})

const accessToken = signAccessToken({ id: stored.id, email: stored.email, role: stored.role })
const profile = await buildUserProfile(db, stored.id)
return { access_token: accessToken, user: profile }
```

**Step 2: Commit**

```
fix(api): rotate refresh token on each use to limit stolen token window
```

---

## Task 11: Login Rate Limiting

**Priority:** LOW
**Files:**
- Modify: `apps/api/src/routes/auth.ts` (add rate limit to login)
- Modify: `apps/api/src/app.ts` or server entry (register plugin if needed)

**Problem:** No rate limiting on auth endpoints — brute force possible.

**Step 1: Check if @fastify/rate-limit is installed**

```bash
cd apps/api && cat package.json | grep rate-limit
```

If not installed:

```bash
cd apps/api && pnpm add @fastify/rate-limit
```

**Step 2: Add rate limit to login endpoint**

```typescript
import rateLimit from '@fastify/rate-limit'

// In authRoutes, before defining routes:
await app.register(rateLimit, {
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
  errorResponseBuilder: () => ({
    success: false,
    error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
  }),
})
```

Apply only to `/auth/login` and `/auth/accept-invite` (the password endpoints).

**Step 3: Commit**

```
feat(api): add rate limiting to login and accept-invite endpoints
```

---

## Task 12: Editor Credit Quota Display Enhancement

**Priority:** MEDIUM — UX
**Files:**
- Modify: `apps/web/src/components/layout/credits-badge.tsx`
- Modify: `apps/web/src/components/dashboard/stats-cards.tsx`

**Problem:** Editor only sees "可用积分: 800" but doesn't know quota is 1000 and used is 200. No context.

**Step 1: Show quota breakdown in credits-badge expanded mode**

```typescript
// In expanded (non-collapsed) mode for editors:
if (!isOwnerOrAdmin && me?.credit_quota !== null) {
  return (
    <div className={cn('flex items-center gap-2 rounded-md bg-muted px-3 py-2')}>
      <Coins className="h-4 w-4 text-accent-orange shrink-0" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">可用积分</span>
        <span className="text-sm font-medium">{displayValue.toLocaleString()}</span>
        <span className="text-xs text-muted-foreground">
          配额 {me.credit_quota.toLocaleString()} · 已用 {(me.credit_used ?? 0).toLocaleString()}
        </span>
      </div>
    </div>
  )
}
```

**Step 2: Show same breakdown in stats-cards**

Add a subtitle line under the credit number showing "配额 X · 已用 Y".

**Step 3: Commit**

```
feat(web): show credit quota breakdown for editors in sidebar and dashboard
```

---

## Task 13: Workspace Switch — Clear Stale Results

**Priority:** LOW — UX
**Files:**
- Modify: `apps/web/src/app/(dashboard)/image/page.tsx`

**Problem:** Switching workspace keeps the old batch result grid from the previous workspace.

**Step 1: Clear currentBatch on workspace change**

```typescript
const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

// Clear results when workspace changes
useEffect(() => {
  setCurrentBatch(null)
}, [activeWorkspaceId])
```

**Step 2: Commit**

```
fix(web): clear generation results when switching workspace
```

---

## Task 14: Invite Token — Allow Re-Generation

**Priority:** LOW — UX
**Files:**
- Modify: `apps/api/src/routes/teams.ts:41-120`

**Problem:** Once an invite is created, there's no way to re-send or regenerate it. The token is shown once and lost.

**Step 1: Allow POST to same email to regenerate invite**

If the user already exists as a team member but status is `suspended` (haven't accepted), regenerate the invite token instead of returning 409:

```typescript
if (existing) {
  // Check if user is still suspended (hasn't accepted invite yet)
  const targetUser = await db.selectFrom('users')
    .select(['id', 'status'])
    .where('id', '=', user.id)
    .executeTakeFirst()

  if (targetUser?.status === 'suspended') {
    // Regenerate invite token
    const inviteToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex')

    await db.insertInto('email_verifications').values({
      user_id: user.id,
      token_hash: tokenHash,
      type: 'verify_email',
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    return reply.status(200).send({
      user_id: user.id,
      email,
      role: memberRole,
      invite_token: inviteToken,
      regenerated: true,
    })
  }

  return reply.status(409).send({
    success: false,
    error: { code: 'ALREADY_MEMBER', message: '该用户已是团队成员' },
  })
}
```

**Step 2: Commit**

```
feat(api): allow regenerating invite token for pending members
```

---

## Execution Order

| Order | Task | Severity | Est. Complexity |
|-------|------|----------|----------------|
| 1     | Task 1: SSE auth | CRITICAL | Low |
| 2     | Task 2: Credit race condition | CRITICAL | Medium |
| 3     | Task 3: Frozen credits in deduction | HIGH | Low |
| 4     | Task 4: Admin generation credit tracking | HIGH | Low |
| 5     | Task 5: Member removal guard | HIGH | Low |
| 6     | Task 7: Error message i18n | MEDIUM | Low |
| 7     | Task 8: credit_used discrepancy | MEDIUM | Low |
| 8     | Task 6: WS role cap | MEDIUM | Low |
| 9     | Task 12: Editor quota display | MEDIUM | Low |
| 10    | Task 13: Clear stale results | LOW | Low |
| 11    | Task 9: Password length | LOW | Trivial |
| 12    | Task 10: Token rotation | LOW | Low |
| 13    | Task 11: Rate limiting | LOW | Medium |
| 14    | Task 14: Invite re-generation | LOW | Low |

Total: 14 tasks, estimated ~14 commits.
