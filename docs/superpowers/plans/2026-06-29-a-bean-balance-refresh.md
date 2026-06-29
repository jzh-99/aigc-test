# A 豆余额展示刷新策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 豆余额展示通过统一 SWR hook 实现 3 分钟轮询 + 窗口聚焦刷新，6 处展示点共用一份轮询（SWR 同 key 去重），不影响后端与创作后既有刷新逻辑。

**Architecture:** 新增共享 hook `useBizMgmtBalance()` 封装 SWR key 与刷新配置（`refreshInterval` / `revalidateOnFocus`），并导出 `mutateBizMgmtBalance()` 命令式刷新。6 个展示点把裸 `useSWR('/credits/biz-mgmt/balance')` 替换为该 hook，删除各处重复的 `BizMgmtBalance` 局部 interface。后端、A 豆按钮跳转语义、generation 页既有的创作后 `mutateBalance()` 调用均不动。

**Tech Stack:** Next.js 14 App Router、React 18、SWR（全局 `apiFetcher` 已配于 `apps/web/src/lib/swr-provider.tsx`）。

**关键约束（来自 spec 与用户确认）：**
- 余额不落本地（`AGENTS.md` 第 1 条），后端 `GET /credits/biz-mgmt/balance` 实时从业管查，**后端不改**。
- 数据归属统一走 SWR key，**不引入 store 字段、不让 /users/me 搭车返回**。
- 两个侧边栏 A 豆按钮 onClick **保持跳 /credits**，不改手动刷新。
- generation 页 `handleBatchCreated`/`handleBatchTerminal` 里的创作后刷新调用 **保留不动**。

---

## File Structure

- **Create:** `apps/web/src/hooks/use-biz-mgmt-balance.ts`
  - 单一职责：封装业管 A 豆余额的 SWR key + 刷新配置 + 命令式 mutate。供所有展示点复用。
- **Modify（替换 SWR 调用 + 删局部 interface + 删裸 `import useSWR`）：**
  - `apps/web/src/components/layout/credits-badge.tsx`（行 5、13-17、23）
  - `apps/web/src/components/layout/creative-side-rail.tsx`（行 5、26-30、78）
  - `apps/web/src/app/(dashboard)/credits/page.tsx`（行 4、20-22、28）
  - `apps/web/src/app/(dashboard)/generation/page.tsx`（行 14、22-25、96）—— **保留 `mutate` 解构**（行 143/150 仍用）
  - `apps/web/src/components/dashboard/stats-cards.tsx`（行 7、9-12、17）—— 保留 `isLoading` 解构
  - `apps/web/src/components/team/team-credits-settings.tsx`（行 4、25-27、31）

> 替换规则统一：每处删掉 `import useSWR from 'swr'`（若删后文件内不再有其它 SWR 使用——已逐一确认这 6 个文件 SWR 仅用于余额），删掉局部 `interface BizMgmtBalance`，`useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')` 改为 `useBizMgmtBalance()`。type 参数去掉（hook 内已带类型）。

---

## Task 1: 新增共享 hook `useBizMgmtBalance`

**Files:**
- Create: `apps/web/src/hooks/use-biz-mgmt-balance.ts`

- [ ] **Step 1: 创建 hook 文件**

```ts
import useSWR, { mutate } from 'swr'

const KEY = '/credits/biz-mgmt/balance'

interface BizMgmtBalance {
  balance: number
}

/**
 * 业管 A 豆余额展示 SWR。
 * - 数据源：GET /credits/biz-mgmt/balance（后端实时从业管 MEMBER-1004 现查，不落本地）。
 * - refreshInterval=3 分钟：常驻页面时自动刷新，捕获在别的端 / 业管后台充值或消费后的变化。
 *   SWR 同 key 去重，6 个展示点共用一份轮询，不会叠加请求。
 * - revalidateOnFocus：切回浏览器标签页时刷新一次。
 * - balance 来自业管权威，前端只做展示；扣减判据在后端创作前置校验（deductBizMgmtPointsForGeneration）。
 */
export function useBizMgmtBalance() {
  return useSWR<BizMgmtBalance>(KEY, {
    refreshInterval: 3 * 60 * 1000,
    revalidateOnFocus: true,
  })
}

/**
 * 命令式刷新余额（预留扩展点，便于后续手动刷新按钮等场景调用）。
 * 本期 A 豆按钮保持跳 /credits，不直接使用。
 */
export function mutateBizMgmtBalance() {
  return mutate(KEY)
}
```

- [ ] **Step 2: 类型检查该文件**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无新增报错（仅确认新文件本身合法；其余展示点尚未改造，仍各自定义局部 interface，不影响）。

> 说明：本期为纯前端展示数据刷新策略，无单元测试覆盖（SWR 行为依赖全局 provider + 网络请求，项目内展示型组件无既有测试惯例）。验证以类型检查 + 浏览器 Network 观察为准（见 spec 第 6 节）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-biz-mgmt-balance.ts
git commit -m "feat(web): 新增 useBizMgmtBalance hook——A豆余额统一轮询+聚焦刷新"
```

---

## Task 2: credits-badge 改用 hook

**Files:**
- Modify: `apps/web/src/components/layout/credits-badge.tsx`

- [ ] **Step 1: 替换 import**

把第 5 行 `import useSWR from 'swr'` 改为：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

- [ ] **Step 2: 删局部 interface**

删除第 13-17 行的局部 interface 块（含其上两行注释）：

```ts
// 业管 A 豆余额响应：{ balance: number }
// 本地积分系统已退役，余额权威在业管，统一从 /credits/biz-mgmt/balance 现查。
interface BizMgmtBalance {
  balance: number
}
```

- [ ] **Step 3: 替换 SWR 调用**

把第 23 行：

```ts
  const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  // 余额统一指向业管 A 豆余额接口（不区分团队/个人，业管以当前选中会员身份查询）
  const { data: balanceData } = useBizMgmtBalance()
```

> 行 32 `const balance = balanceData?.balance ?? 0` 及以下渲染逻辑不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/credits-badge.tsx
git commit -m "refactor(web): credits-badge 改用 useBizMgmtBalance（3分钟轮询+聚焦刷新）"
```

---

## Task 3: creative-side-rail 改用 hook

**Files:**
- Modify: `apps/web/src/components/layout/creative-side-rail.tsx`

- [ ] **Step 1: 替换 import**

把第 5 行 `import useSWR from 'swr'` 改为：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

- [ ] **Step 2: 删局部 interface**

删除第 26-30 行的局部 interface 块（含其上两行注释）：

```ts
// 业管 A 豆余额响应：{ balance: number }
// 本地积分系统已退役，余额权威在业管，统一从 /credits/biz-mgmt/balance 现查。
interface BizMgmtBalance {
  balance: number
}
```

- [ ] **Step 3: 替换 SWR 调用**

把第 78 行（行 77 的注释保留）：

```ts
  const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  const { data: balanceData } = useBizMgmtBalance()
```

> 行 79 `const remainingCredits = balanceData?.balance ?? 0` 及底部 A 豆按钮渲染（行 235-246，onClick 保持 `router.push('/credits')` 不动）不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/creative-side-rail.tsx
git commit -m "refactor(web): creative-side-rail 改用 useBizMgmtBalance"
```

---

## Task 4: credits 页改用 hook

**Files:**
- Modify: `apps/web/src/app/(dashboard)/credits/page.tsx`

- [ ] **Step 1: 替换 import**

把第 4 行 `import useSWR from 'swr'` 改为：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

- [ ] **Step 2: 删局部 interface**

删除第 20-22 行的局部 interface 块：

```ts
interface BizMgmtBalance {
  balance: number
}
```

> 其上方第 12-19 行的 JSDoc 注释（A 豆管理页说明）保留，但需把其中「GET /credits/biz-mgmt/balance → { balance }」的说明保留即可（数据源未变）。

- [ ] **Step 3: 替换 SWR 调用**

把第 27-28 行：

```ts
  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useBizMgmtBalance()
```

> 行 30 `const balance = balanceData?.balance ?? 0` 及以下渲染不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/credits/page.tsx"
git commit -m "refactor(web): credits 页改用 useBizMgmtBalance"
```

---

## Task 5: generation 页改用 hook（保留 mutate）

**Files:**
- Modify: `apps/web/src/app/(dashboard)/generation/page.tsx`

> ⚠️ **本任务特殊**：该页解构了 `mutate: mutateBalance`，且 `mutateBalance()` 在 `handleBatchTerminal`（行 143）、`handleBatchCreated`（行 150）被调用。替换后 `mutate` 来自 hook 返回值，变量名保持 `mutateBalance` 不变，调用处无需改动。

- [ ] **Step 1: 替换 import**

把第 14 行 `import useSWR from 'swr'` 改为：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

- [ ] **Step 2: 删局部 interface**

删除第 22-25 行的局部 interface 块（含其上注释）：

```ts
// 业管 A 豆余额响应。本地积分系统已退役，余额来自业管平台统一查询。
interface BizMgmtBalance {
  balance: number
}
```

- [ ] **Step 3: 替换 SWR 调用（保留 mutate 解构）**

把第 95-96 行：

```ts
  // 余额统一指向业管 A 豆余额接口（本地积分系统已退役）
  const { data: balanceData, mutate: mutateBalance } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  // 余额统一指向业管 A 豆余额接口（本地积分系统已退役）
  const { data: balanceData, mutate: mutateBalance } = useBizMgmtBalance()
```

> 行 143 `mutateBalance()`、行 150 `mutateBalance()`、行 158 `lowCredits` 判断均不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/generation/page.tsx"
git commit -m "refactor(web): generation 页改用 useBizMgmtBalance，保留创作后 mutate 调用"
```

---

## Task 6: stats-cards 改用 hook（保留 isLoading）

**Files:**
- Modify: `apps/web/src/components/dashboard/stats-cards.tsx`

> 该页解构了 `isLoading: isBalanceLoading`，替换后保留。

- [ ] **Step 1: 替换 import**

把第 7 行 `import useSWR from 'swr'` 改为：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

- [ ] **Step 2: 删局部 interface**

删除第 9-12 行的局部 interface 块（含其上注释）：

```ts
// 业管 A 豆余额响应。本地积分系统已退役，余额来自业管平台统一查询。
interface BizMgmtBalance {
  balance: number
}
```

- [ ] **Step 3: 替换 SWR 调用**

把第 16-17 行：

```ts
  // 余额统一指向业管 A 豆余额接口（不区分团队/个人）
  const { data: balanceData, isLoading: isBalanceLoading } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  // 余额统一指向业管 A 豆余额接口（不区分团队/个人）
  const { data: balanceData, isLoading: isBalanceLoading } = useBizMgmtBalance()
```

> 行 20 `const creditValue = balanceData?.balance ?? 0` 及以下渲染不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/stats-cards.tsx
git commit -m "refactor(web): stats-cards 改用 useBizMgmtBalance"
```

---

## Task 7: team-credits-settings 改用 hook

**Files:**
- Modify: `apps/web/src/components/team/team-credits-settings.tsx`

> ⚠️ **本任务特殊**：该文件**第 30 行还有一个 `useSWR<TeamInfo>(`/teams/${teamId}`)`**（团队信息查询），不能删。只删 `import useSWR` 是**错的**——必须保留 `import useSWR`，因为团队信息仍在用。

- [ ] **Step 1: 添加 hook import（保留 useSWR import）**

第 4 行 `import useSWR from 'swr'` **保留不动**。在其后新增一行 import：

```ts
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
```

> 完整 import 区：第 4 行 `import useSWR`（供第 30 行 `useSWR<TeamInfo>` 用），新增 `import { useBizMgmtBalance }`（供第 31 行余额用）。

- [ ] **Step 2: 删局部 interface（仅删 BizMgmtBalance，保留 TeamInfo）**

删除第 25-27 行的局部 interface 块：

```ts
interface BizMgmtBalance {
  balance: number
}
```

> ⚠️ 第 21-23 行的 `interface TeamInfo` **必须保留**，不要误删。

- [ ] **Step 3: 替换余额 SWR 调用（团队信息 SWR 不动）**

把第 31 行：

```ts
  const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```ts
  const { data: balanceData } = useBizMgmtBalance()
```

> 第 30 行 `const { data, mutate } = useSWR<TeamInfo>(`/teams/${teamId}`)` **不动**。行 35 `const balance = balanceData?.balance ?? 0` 不变。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/team/team-credits-settings.tsx
git commit -m "refactor(web): team-credits-settings 余额改用 useBizMgmtBalance"
```

---

## Task 8: 全量类型检查 + lint

**Files:** 无修改，仅校验。

- [ ] **Step 1: 全量类型检查**

Run: `pnpm --filter @aigc/web exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 2: lint（仅 web）**

Run: `pnpm --filter @aigc/web exec eslint src/hooks/use-biz-mgmt-balance.ts src/components/layout/credits-badge.tsx src/components/layout/creative-side-rail.tsx src/components/dashboard/stats-cards.tsx src/components/team/team-credits-settings.tsx "src/app/(dashboard)/credits/page.tsx" "src/app/(dashboard)/generation/page.tsx"`
Expected: 无报错。`mutateBizMgmtBalance` 若被 eslint 判为「已定义未使用」，按 spec 保留（预留扩展点）；如团队 lint 规则严格，可加 `// eslint-disable-next-line` 或在 plan 外单独决定是否删除导出。

- [ ] **Step 3: 最终提交（若有 lint 自动修复）**

如 lint 修改了文件：

```bash
git add -A
git commit -m "style(web): A豆余额刷新策略 lint 收尾"
```

否则跳过本步。

---

## 自检（Self-Review）

**1. Spec 覆盖：**
- 3.1 数据归属走 SWR key → Task 1 hook 以 SWR key 实现 ✅
- 3.2 新增 hook（refreshInterval + revalidateOnFocus + mutate 导出）→ Task 1 ✅
- 3.3 改造 6 处展示点 → Task 2-7（credits-badge / creative-side-rail / credits / generation / stats-cards / team-credits-settings）✅
- 3.4 后端不改、按钮跳转不改 → 各 Task 均注明不动 ✅
- generation 页既有创作后刷新保留 → Task 5 Step 3 明确保留 `mutate` 解构 ✅
- team-credits-settings 的 TeamInfo SWR 不误删 → Task 7 单独标注 ⚠️ ✅

**2. 占位符扫描：** 无 TBD/TODO；每个 step 均含完整代码或精确文件路径行号 ✅

**3. 类型一致性：** hook 返回 `useSWR<BizMgmtBalance>` 的标准返回，各处解构的 `data` / `mutate` / `isLoading` 字段名与 hook 返回一致；`BizMgmtBalance` 类型仅定义在 hook 文件内，各展示点删除局部定义后统一引用 ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-29-a-bean-balance-refresh.md`.
