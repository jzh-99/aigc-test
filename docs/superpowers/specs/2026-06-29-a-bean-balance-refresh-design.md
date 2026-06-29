# A 豆余额展示刷新策略 设计文档

- 日期：2026-06-29
- 状态：已确认，待实现
- 关联约定：`AGENTS.md` 第 1 条「A 豆不落本地」、第 5/6 条

## 1. 背景与现状

AIGC 平台的 A 豆余额权威在业管平台（biz-mgmt），本地**从不持久化余额**（`AGENTS.md` 第 1 条）。
当前前端 6 处展示点各自调用裸 `useSWR('/credits/biz-mgmt/balance')`：

| 展示点 | 文件 |
|---|---|
| 侧边栏徽标 | `apps/web/src/components/layout/credits-badge.tsx:23` |
| 创意侧边栏（rail）底部按钮 | `apps/web/src/components/layout/creative-side-rail.tsx:78` |
| /credits 页 | `apps/web/src/app/(dashboard)/credits/page.tsx:28` |
| /generation 页（含余额不足 alert） | `apps/web/src/app/(dashboard)/generation/page.tsx:96` |
| 仪表盘统计卡 | `apps/web/src/components/dashboard/stats-cards.tsx:17` |
| 团队积分设置 | `apps/web/src/components/team/team-credits-settings.tsx:31` |

**问题**：这些 `useSWR` 都没有配置 `refreshInterval` 和 `revalidateOnFocus`，意味着：

- 余额数字只在**首次进入页面/组件挂载**时拉一次，之后永不刷新；
- 用户在业管后台充值、在别的设备消费后，本端数字长期停留在旧值；
- /generation 页「余额不足，请充值」提示（`balance <= 0` 判断），在用户充值后不会自动消失，必须手动刷新整页。

后端侧已正确：`queryCurrentBizMgmtBalance`（`apps/api/src/services/biz-mgmt-a-bean.ts:95`）每次实时查业管 MEMBER-1004，生成前置校验（`deductBizMgmtPointsForGeneration:151-153`）在建任务前实时查余额、不足即抛 402。**后端不需要改动**。

## 2. 目标与非目标

**目标**
1. A 豆余额展示能定期自动刷新，反映业管权威值的变化（充值/消费）。
2. 用户切回浏览器标签页时刷新一次（低成本高价值，SWR 内置）。
3. 统一所有展示点的刷新配置，避免行为割裂。

**非目标（已与用户确认）**
- ❌ **不做** 后端 team/user 表加余额列 —— 违反 `AGENTS.md` 第 1 条。
- ❌ **不做** 创作成功后命令式刷新展示余额 —— 用户明确不要；后端创作前已实时查余额，展示靠轮询兜底即可。
- ❌ **不做** 改变 A 豆按钮点击语义 —— 两个侧边栏按钮保持「跳 /credits」，不改为手动刷新。
- ❌ **不做** 后端余额查询/前置校验改动 —— 已实现且正确。

## 3. 方案

### 3.1 数据归属：统一走 SWR key（用户已选）

不引入 Zustand store 字段、不让 `/users/me` 搭车返回余额。所有展示继续指向同一个 SWR key
`/credits/biz-mgmt/balance`，但把刷新配置收口到一个共享 hook。

**为什么 SWR key 模式可行**：SWR 对同一 key 的多个 `useSWR` 调用会**自动共享请求并去重**，
即使 6 个组件都调用该 hook，`refreshInterval` 也只触发**一次**轮询，不会产生 6 倍流量。

### 3.2 新增共享 hook

`apps/web/src/hooks/use-biz-mgmt-balance.ts`：

```ts
import useSWR, { mutate } from 'swr'

const KEY = '/credits/biz-mgmt/balance'

interface BizMgmtBalance {
  balance: number
}

/**
 * 业管 A 豆余额展示 SWR。
 * - 数据源：GET /credits/biz-mgmt/balance（后端实时从业管 MEMBER-1004 现查，不落本地）。
 * - refreshInterval=3 分钟：常驻页面时自动刷新，捕获在别的端/业管后台充值或消费后的变化。
 *   SWR 同 key 去重，6 个展示点共用一份轮询，不会叠加请求。
 * - revalidateOnFocus：切回浏览器标签页时刷新一次。
 * - balance 来自业管权威，前端只做展示，不作为扣减判据（扣减判据在后端创作前置校验）。
 */
export function useBizMgmtBalance() {
  return useSWR<BizMgmtBalance>(KEY, {
    refreshInterval: 3 * 60 * 1000,
    revalidateOnFocus: true,
  })
}

/**
 * 命令式刷新余额（保留导出，便于后续按需在手动按钮等场景调用）。
 * 本期 A 豆按钮保持跳 /credits，不直接使用；预留扩展点。
 */
export function mutateBizMgmtBalance() {
  return mutate(KEY)
}
```

> 注：保留 `mutateBizMgmtBalance` 导出但不立即使用，是因为「手动刷新」是明确的潜在扩展点，
> 且 SWR 全局 mutate 的 key 与 hook 内 key 必须严格一致，集中导出能避免后续散落写错 key。
> 如果 lint 视为未使用告警，实现时按需删除或保留（取决于团队 lint 严格度）。

### 3.3 改造 6 处展示点

每处把：

```tsx
interface BizMgmtBalance { balance: number }
const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')
```

改为：

```tsx
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
const { data: balanceData } = useBizMgmtBalance()
```

并删除各文件内重复定义的 `BizMgmtBalance` 局部 interface（统一用 hook 内的类型）。

各展示点读值逻辑（`balanceData?.balance ?? 0`）保持不变，因此：
- /generation 页 `lowCredits = (balance ?? 0) <= 0` 判断逻辑不变，但**顺带收益**：用户充值后，
  余额不足提示最多 3 分钟内随轮询自动消失，无需手动刷新整页。

### 3.4 不改动项

- 后端：`apps/api/src/routes/credits/get-biz-mgmt-balance.ts`、`services/biz-mgmt-a-bean.ts`、
  所有生成路由的前置扣减校验 —— 全部不动。
- 侧边栏两个 A 豆按钮的 `onClick` —— 保持 `router.push('/credits')`，不改为手动刷新。
- 创作成功回调 —— 不加 `mutateBizMgmtBalance()`。

## 4. 数据流

```
后端业管 MEMBER-1004
        │ (实时查，不落本地)
        ▼
GET /credits/biz-mgmt/balance  ── 同一 SWR key ──┐
        │                                          │ refreshInterval=3min（去重，仅 1 份）
        ▼                                          │ revalidateOnFocus
useBizMgmtBalance()  ◄──── 6 个展示点共用 ────────┘
        │
        ▼
credits-badge / creative-side-rail / credits 页 /
generation 页 / stats-cards / team-credits-settings
```

## 5. 风险与权衡

| 风险 | 评估 |
|---|---|
| 3 分钟轮询增加业管接口压力 | 低。SWR 同 key 去重，全局只有 1 份轮询；业管 MEMBER-1004 本就是查询接口，3 分钟一次可接受。 |
| 轮询时用户身份已切换（切了业管会员） | 低。身份切换走 `POST /auth/select-biz-mgmt-member`，切换后 SWR key 未变，但后端按当前选中会员查；可接受（余额展示会随下一次轮询/聚焦自然更新）。本期不特殊处理。 |
| `mutateBizMgmtBalance` 导出未使用 | 低。lint 若告警则删除，保留为扩展点。 |
| 余额数字短暂滞后（最多 3 分钟） | 可接受。余额非实时扣减判据（判据在后端创作前置校验，已实时），展示滞后不影响业务正确性。 |

## 6. 验证

- 改完后启动 web，观察浏览器 Network：只有一个周期性 `/credits/biz-mgmt/balance` 请求（约 3 分钟一次），多个展示点同时挂载时不会产生多份。
- 切走浏览器标签再切回，触发一次刷新。
- /generation 页余额为 0 时显示「余额不足」提示；在业管后台充值后（或 mock 后端返回非 0），3 分钟内提示自动消失。
- 按 `AGENTS.md`「本地验证边界」，前端改动完成后即结束，不强制刷新预览。

## 7. 影响面清单

- 新增：`apps/web/src/hooks/use-biz-mgmt-balance.ts`
- 修改（6 处替换 + 删局部 interface）：
  - `apps/web/src/components/layout/credits-badge.tsx`
  - `apps/web/src/components/layout/creative-side-rail.tsx`
  - `apps/web/src/app/(dashboard)/credits/page.tsx`
  - `apps/web/src/app/(dashboard)/generation/page.tsx`
  - `apps/web/src/components/dashboard/stats-cards.tsx`
  - `apps/web/src/components/team/team-credits-settings.tsx`
