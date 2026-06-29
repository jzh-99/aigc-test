# check-biz-mgmt 阶段预建本地用户 + 初始密码前置展示 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"建本地 user + 生成一次性初始密码"的责任从 `/auth/login` 移到 `/auth/check-biz-mgmt`，并在前端密码步用黄色提示框向新用户展示初始密码，让新用户能真正完成首次登录。

**Architecture:** 两步式登录职责重排 —— check-biz-mgmt 成为"业管判存亡 + 预建本地 user + 回传初始密码"的唯一入口；login 瘦身为纯密码校验（本地无 user 视为绕过，拒绝）。前端在密码步接收并展示初始密码。

**Tech Stack:** Fastify 4 + Kysely（后端）、Next.js 14 + React（前端）、bcryptjs（密码）。

**关联 spec：** `docs/superpowers/specs/2026-06-29-check-biz-mgmt-provision-user-design.md`

---

## Files

- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`（核心：建 user + 返初始密码）
- Modify: `apps/api/src/routes/auth/post-login.ts`（瘦身：移除建 user，只校验密码）
- Modify: `apps/web/src/app/(auth)/login/page.tsx`（密码步展示初始密码）
- Modify: `apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`（同步断言，避免回归）

注：`packages/types/src/api.ts` 无 check-biz-mgmt 响应类型，前端用内联类型扩展，无需改类型包。

---

## Task 1: 后端 check-biz-mgmt 预建本地 user + 返回初始密码

**Files:**
- Modify: `apps/api/src/routes/auth/post-check-biz-mgmt.ts`

- [ ] **Step 1: 改导入，加入 ensureLocalUserForBizMgmtPhone**

将第 3 行：
```ts
import { fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'
```
改为：
```ts
import { ensureLocalUserForBizMgmtPhone, fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'
```

- [ ] **Step 2: 更新顶部接口文档注释（返回约定 + 安全说明）**

将 `* 返回约定（前端据此切换视图）：` 那一段（含其下两条 `- 200` / `- 401`）替换为：
```markdown
 * 返回约定（前端据此切换视图）：
 * - 200 { exists: true }：业管有 ≥1 个 status=1 会员，且本地已存在该手机号 user（老用户）。前端进入密码步。
 * - 200 { exists: true, one_time_password: string }：业管有会员但本地无 user（新用户）。
 *   本接口此时【预建本地 user + 生成一次性初始密码】并随响应返回，前端进密码步后展示该密码供用户登录。
 * - 401 { error.code: 'BIZ_MGMT_NOT_FOUND' }：业管查无会员或接口故障（故障等同查无）。
 *   若本地存在该手机号孤儿 user，先物理清理其全部业务数据，再返回此码。
 *
 * 安全说明：仅返回布尔 exists 和（新用户）一次性初始密码，不返回会员明细，避免向未认证请求泄露
 * 账号信息（会员明细在 /auth/login 成功后随 profile 返回）。
 * 初始密码经 HTTPS 传输、用完即改（password_change_required=true），遗失联系管理员重置。
 * 频率限制复用全局 1200/min，登录接口另有 10/min 的更严限制。
```

- [ ] **Step 3: 业管有会员分支 —— 预建 user + 返回初始密码**

将第 74-75 行：
```ts
    // 业管有会员：前端进入密码步
    return { exists: true }
```
改为：
```ts
    // 业管有会员：预建本地 user（本地无则建 + 生成一次性初始密码），再让前端进入密码步。
    // 建 user 责任在 check 阶段完成，login 阶段只校验密码；老用户不重建、不返密码。
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

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/routes/auth/post-check-biz-mgmt.ts
git commit -m "feat(auth): check-biz-mgmt 预建本地 user 并返回一次性初始密码"
```

---

## Task 2: 后端 post-login 瘦身为纯密码校验

**Files:**
- Modify: `apps/api/src/routes/auth/post-login.ts`

- [ ] **Step 1: 移除 ensureLocalUserForBizMgmtPhone 导入**

将第 10-15 行的 import 块：
```ts
import {
  ensureLocalUserForBizMgmtPhone,
  syncBizMgmtMembersForLocalUser,
  fetchBizMgmtMembersByPhone,
  purgeLocalUserCascade,
} from '../../services/biz-mgmt-member-sync.js'
```
改为：
```ts
import {
  syncBizMgmtMembersForLocalUser,
  fetchBizMgmtMembersByPhone,
  purgeLocalUserCascade,
} from '../../services/biz-mgmt-member-sync.js'
```

- [ ] **Step 2: 移除 oneTimePassword 变量声明**

将第 118 行：
```ts
    let oneTimePassword: string | null = null
```
整行删除。

- [ ] **Step 3: 手机号分支 —— 移除建 user 逻辑，本地无 user 改为拒绝**

将第 154-171 行（分支③④ 业管有会员查本地那段）：
```ts
      // 分支③④：业管有会员，查本地 users.phone 决定创建或校验
      user = await db
        .selectFrom('users')
        .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
        .where('phone', '=', identifier)
        .executeTakeFirst()

      if (!user) {
        // 分支③：本地无 user，业管有会员 → 创建本地 user/team/workspace + 一次性初始密码
        const created = await ensureLocalUserForBizMgmtPhone(identifier)
        oneTimePassword = created.oneTimePassword
        user = await db
          .selectFrom('users')
          .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
          .where('id', '=', created.userId)
          .executeTakeFirst()
      }
      // 分支④：本地有 user，继续走下方密码校验
```
改为：
```ts
      // 业管有会员：查本地 users.phone。建 user 责任已在 check-biz-mgmt 完成，
      // 此处本地无 user 说明用户跳过了 check（异常路径），拒绝登录防止绕过。
      user = await db
        .selectFrom('users')
        .select(['id', 'account', 'username', 'password_hash', 'role', 'status', 'phone'])
        .where('phone', '=', identifier)
        .executeTakeFirst()

      if (!user) {
        // 跳过 check 直调 login（本地无 user）：拒绝
        return reply.status(401).send({
          success: false,
          error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
        })
      }
      // 本地有 user，继续走下方 bcrypt 密码校验
```

- [ ] **Step 4: 移除登录响应附初始密码**

将第 255-259 行：
```ts
    const authBody = buildAuthResponse(accessToken, profile)
    // 首次初始化（本地无用户、从业管创建）返回一次性初始密码，提示用户登录后修改
    return oneTimePassword
      ? { ...authBody, one_time_password: oneTimePassword, oneTimePassword }
      : authBody
```
改为：
```ts
    const authBody = buildAuthResponse(accessToken, profile)
    return authBody
```

- [ ] **Step 5: 同步更新顶部控制流注释**

将第 99-101 行注释中：
```
  //  2. 业管有会员（≥1 个 status=1）→ 查本地 users.phone：
  //       本地无 → ensureLocalUserForBizMgmtPhone 创建 user/team/workspace + 一次性初始密码
  //       本地有 → bcrypt 校验密码
```
改为：
```
  //  2. 业管有会员（≥1 个 status=1）→ 查本地 users.phone：
  //       本地无 → 拒绝（建 user 责任在 check-biz-mgmt，跳过 check 视为异常）
  //       本地有 → bcrypt 校验密码
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/routes/auth/post-login.ts
git commit -m "refactor(auth): post-login 移除建 user 逻辑，瘦身为纯密码校验"
```

---

## Task 3: 同步更新 post-login 契约测试

**Files:**
- Modify: `apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`

> 原测试断言 post-login 必须导入/调用 ensureLocalUserForBizMgmtPhone、必须有 oneTimePassword 关联。职责移走后这些断言会失败，需更新为反映新契约。

- [ ] **Step 1: 更新「必须导入 ensureLocalUserForBizMgmtPhone」断言**

将第 49-55 行整个 `it('必须导入 ensureLocalUserForBizMgmtPhone（本地用户初始化）', ...)` 测试块替换为反向断言：
```ts
  it('login 阶段不再建 user：禁止导入/调用 ensureLocalUserForBizMgmtPhone（建 user 责任已移到 check-biz-mgmt）', () => {
    assert.doesNotMatch(
      SOURCE,
      /ensureLocalUserForBizMgmtPhone/,
      '建 user 责任已移到 check-biz-mgmt，post-login 不应再导入/调用 ensureLocalUserForBizMgmtPhone',
    )
  })
```

- [ ] **Step 2: 更新「本地无 user 时必须调 ensureLocalUserForBizMgmtPhone」断言**

将第 107-129 行的 `describe('post-login 业管先行：分支③④ 业管有会员')` 块中的：
```ts
  it('本地无 user 时必须调 ensureLocalUserForBizMgmtPhone 并接收 oneTimePassword', () => {
    assert.match(
      SOURCE,
      /ensureLocalUserForBizMgmtPhone[\s\S]*oneTimePassword|oneTimePassword[\s\S]*ensureLocalUserForBizMgmtPhone/,
      '本地无 user 时必须调 ensureLocalUserForBizMgmtPhone 并取一次性初始密码',
    )
  })
```
替换为：
```ts
  it('本地无 user 时必须拒绝（返回 BIZ_MGMT_NOT_FOUND），不再建 user', () => {
    // 业管有会员分支查到本地无 user → 必须走拒绝路径，禁止建 user
    assert.match(
      SOURCE,
      /BIZ_MGMT_NOT_FOUND[\s\S]*用户不存在/,
      '本地无 user（跳过 check）必须返回 BIZ_MGMT_NOT_FOUND 拒绝，建 user 责任在 check-biz-mgmt',
    )
    assert.doesNotMatch(
      SOURCE,
      /ensureLocalUserForBizMgmtPhone/,
      'post-login 不应再调用 ensureLocalUserForBizMgmtPhone',
    )
  })
```

- [ ] **Step 3: 更新顶部 describe 注释（分支③语义变化）**

将第 16-19 行注释块中：
```
//   ③ 业管有会员 + 本地无 user → 创建本地 user/team/workspace + 初始密码
//   ④ 业管有会员 + 本地有 user → bcrypt 校验密码
```
改为：
```
//   ③ 业管有会员 + 本地无 user → 拒绝（建 user 责任在 check-biz-mgmt，跳过 check 视为异常）
//   ④ 业管有会员 + 本地有 user → bcrypt 校验密码
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @aigc/api exec tsx --test apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts
git commit -m "test(auth): 同步 post-login 契约测试，建 user 责任移到 check-biz-mgmt"
```

---

## Task 4: 前端密码步展示初始密码黄色提示框

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: 新增 initialPassword state**

在第 64 行 `const [suspended, setSuspended] = useState(false)` 之后新增：
```ts
  // 新用户：check-biz-mgmt 预建 user 后返回的一次性初始密码，在密码步展示给用户
  const [initialPassword, setInitialPassword] = useState<string | null>(null)
```

- [ ] **Step 2: handleNextStep 接收并保存初始密码**

将第 81-84 行：
```ts
    try {
      await apiPost<{ exists: boolean }>('/auth/check-biz-mgmt', { phone: identifier })
      // 业管有会员，进入密码步
      setStep('password')
```
改为：
```ts
    try {
      const res = await apiPost<{ exists: boolean; one_time_password?: string }>('/auth/check-biz-mgmt', { phone: identifier })
      // 业管有会员：新用户 check 会预建 user 并返回一次性初始密码，保存以便密码步展示
      setInitialPassword(res.one_time_password ?? null)
      // 业管有会员，进入密码步
      setStep('password')
```

- [ ] **Step 3: handleBack 清空 initialPassword**

将第 97-100 行：
```ts
  function handleBack() {
    setStep('phone')
    setPassword('')
  }
```
改为：
```ts
  function handleBack() {
    setStep('phone')
    setPassword('')
    setInitialPassword(null)
  }
```

- [ ] **Step 4: 密码步渲染黄色提示框（复用现有提示框风格）**

在第 211 行 `)}` （suspended 提示框结束）之后、第 213 行 `{step === 'phone' ? (` 之前插入：
```tsx
          {step === 'password' && initialPassword && (
            <div className="mb-5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm">
              <p className="font-semibold text-yellow-500 mb-1">首次登录初始密码</p>
              <p className="text-white/40 leading-relaxed">
                您的初始密码：<span className="font-mono text-yellow-400 select-all">{initialPassword}</span>
              </p>
              <p className="text-white/40 leading-relaxed mt-1">
                请用此密码登录，登录后请尽快修改密码；遗失请联系管理员重置。
              </p>
            </div>
          )}
```

- [ ] **Step 5: 移除 handleSubmit 里登录成功后弹初始密码 toast**

将第 111-118 行：
```ts
      // 首次从业管创建本地用户时，后端返回一次性初始密码，提示用户登录后修改
      const oneTimePassword = res.one_time_password ?? res.oneTimePassword
      if (oneTimePassword) {
        toast.info(`首次登录初始密码：${oneTimePassword}，登录后请尽快修改密码，遗失请联系管理员重置`, {
          duration: 12000,
        })
      }

```
整段删除（含尾随空行）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/\(auth\)/login/page.tsx
git commit -m "feat(web): 登录密码步展示一次性初始密码黄色提示框"
```

---

## Task 5: 端到端验证

**Files:** 无改动，仅校验。

- [ ] **Step 1: 运行 post-login 契约测试**

Run: `pnpm --filter @aigc/api exec tsx --test apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`
Expected: 全部 PASS。

- [ ] **Step 2: TypeScript 类型检查（api + web）**

Run: `pnpm --filter @aigc/api exec tsc --noEmit` 和 `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无类型错误。
（若 web 因本地 dev 缓存报无关错误，记录但不阻塞，遵循 AGENTS.md 本地验证边界。）

- [ ] **Step 3: 人工核对控制流完整性**

Read 改后的 `post-check-biz-mgmt.ts` 与 `post-login.ts`，确认：
1. check：业管有会员 → 查本地 → 无则建 user 返密码 / 有则只返 exists。
2. login：业管有会员 → 查本地 → 无则 401 / 有则 bcrypt 校验；不再导入 ensureLocalUserForBizMgmtPhone；不再有 oneTimePassword。
3. 前端：密码步有黄色提示框且仅在 initialPassword 非空时显示；handleSubmit 无初始密码 toast。

- [ ] **Step 4: 提交剩余（若有）**

```bash
git status
git log --oneline -6
```

---

## Self Review

- **Spec coverage**：
  - spec 5.1（check 建 user + 返密码）→ Task 1。覆盖。
  - spec 5.2（login 瘦身）→ Task 2。覆盖。
  - spec 5.3（前端展示）→ Task 4。覆盖。
  - spec 5.4（类型包）→ 已确认无该类型，跳过；前端用内联类型（Task 4 Step 2 内联）。覆盖。
  - spec 七验收标准 → Task 5 Step 3 逐条核对。覆盖。
  - 测试同步（spec 未单列但必要）→ Task 3。覆盖。
- **Placeholder scan**：无 TBD/TODO；所有代码片段为完整可粘贴内容。
- **Type consistency**：`one_time_password` 字段名前后端一致（snake_case，与现有 `one_time_password ?? oneTimePassword` 兼容）；`ensureLocalUserForBizMgmtPhone` 返回 `oneTimePassword` 与 check 响应映射一致。
- **YAGNI**：不改 `ensureLocalUserForBizMgmtPhone` 内部、不改 sync 逻辑、不改 SSO/邀请、不改类型包。
