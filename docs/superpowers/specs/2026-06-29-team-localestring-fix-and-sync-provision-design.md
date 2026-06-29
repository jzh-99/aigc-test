# 团队管理 toLocaleString 崩溃修复 + check 阶段同步建 team 设计文档

> 目的：修复登录后进团队管理页报 `Cannot read properties of undefined (reading 'toLocaleString')`；并把为每个业管账号建 team/workspace 的时机从「login 后异步」改为「check 阶段同步」，消除窗口期。
>
> 创建：2026-06-29

---

## 一、问题

### 问题 A：团队管理页 toLocaleString 崩溃（bug）

**现象**：登录后点击「团队管理」→ 页面报错 `Cannot read properties of undefined (reading 'toLocaleString')`。

**根因**：前后端字段契约脱节。
- 本地积分系统退役后，后端 `teams/get-by-id.ts` 已**移除** `credits` 字段，members 也**不再返回** `credit_used`/`credit_quota`（注释 `:8-10` 明确声明）。
- 但前端 `components/team/member-list.tsx` 仍假设这些字段存在：
  - `Member` 接口（`:25-43`）声明 `credit_used: number`、`credit_quota: number | null`、`credits: {balance; frozen_credits}`。
  - `:312` `member.credit_used.toLocaleString()`、`:304` `member.credit_quota.toLocaleString()` 直接调用。
- 后端不返回 → 字段为 `undefined` → `undefined.toLocaleString()` 崩溃。

**与建 team 无关**：team 建了、成员也在，纯粹是前端读了后端已不返回的字段。

### 问题 B：team/workspace 建立有窗口期

**现象**：新用户登录后立刻进团队管理，可能出现 team/workspace 尚未建好。

**根因**：建 team 责任在 `syncBizMgmtMembersForLocalUser`，它只在 `post-login` 登录成功后用 `setImmediate` **异步**触发（`:209-216`），存在"已登录但 team 未建好"的窗口期。

## 二、现状（代码事实）

- `teams/get-by-id.ts:24-32`：members 仅返回 `user_id/account/username/avatar_url/role/joined_at/priority_boost`，**无任何 credit 字段**；team 无 `credits` 字段。
- `components/team/member-list.tsx`：整个组件深度依赖 credit 字段——配额列、已用/剩余列、编辑配额对话框、批量改配额、重置 A 豆。本地积分退役后这些功能已无数据支撑。
- `biz-mgmt-member-sync.ts:160-208`：`syncBizMgmtMembersForLocalUser(localUserId, phone)` 自带事务，遍历每个业管 member，按 `biz_mgmt_user_id` 复用/创建 team+workspace+binding，**幂等**。但内部 `:165` 又查一次业管（与 check 重复）。
- `post-login.ts:209-216`：登录后 `setImmediate` 异步调 sync。

## 三、已确认的设计决策

1. **本地 users 表**：一个手机号一个 user（不变）。
2. **team/workspace**：N 个业管账号 = N 个 team，**在 check 阶段同步建好**（不再异步、消除窗口期）。
3. **toLocaleString 修复**：前端 member-list 去掉对已废弃 credit 字段的依赖。
4. 本次范围：修 bug + 同步建 team。不做"同手机号多 user"重构。

## 四、方案

### 4.1 修 toLocaleString（前端 member-list 重构）

`components/team/member-list.tsx` 改造为「本地积分退役后」的纯成员管理：

- **Member 接口**：移除 `credit_quota`、`credit_used`、`quota_period`、`quota_reset_at`；保留 `user_id/account/username/avatar_url/role/joined_at`。
- **TeamData 接口**：移除 `credits` 字段。
- **移除整块功能**（依赖已废弃字段）：
  - 配额列、已用/剩余列（表格 `:265-267`、`:302-320`）。
  - 编辑配额对话框（`:369-421`）+ `handleUpdateQuota` + `editingMember/quotaValue/periodValue` state。
  - 批量改配额对话框（`:423-464`）+ `handleBatchUpdate` + 批量相关 state/工具栏。
  - 重置 A 豆（`handleResetCredits` + 对应按钮 `:337-347`）。
  - `formatResetInfo`、`periodLabel` 等辅助。
- **保留**：成员列表表格（用户名/账户/角色/加入时间/移除成员）、添加成员、批量添加、全选/移除操作（不涉及 credit 的部分）。
- 表格列精简为：选择框 / 用户名 / 账户 / 角色 / 加入时间 / 操作（移除）。

> 说明：配额/A 豆相关功能整体下线，因为本地积分已退役、后端无数据、业管 A 豆由业管平台管理（非本页职责）。若后续要在本页展示业管 A 豆，需另接业管余额接口，不在本次范围。

### 4.2 check 阶段同步建 team（后端）

`post-check-biz-mgmt.ts` 业管有会员分支（新用户建 user 之后 / 老用户查到 user 之后），**同步调用** `syncBizMgmtMembersForLocalUser(localUserId, phone)`，为每个业管账号建好 team/workspace/binding。

- 新用户：`ensureLocalUserForBizMgmtPhone` 建 user → 取 `created.userId` → `await syncBizMgmtMembersForLocalUser(created.userId, phone)`。
- 老用户：查到 `existingUser.id` → `await syncBizMgmtMembersForLocalUser(existingUser.id, phone)`（幂等，补建缺失的 team、刷新绑定）。
- 因为是 `await`（同步），check 响应返回时 team/workspace 已建好，进团队管理页不会再有空窗。

`post-login.ts`：移除登录后 `setImmediate(syncBizMgmtMembersForLocalUser)` 异步调用（建 team 责任已完全移到 check）。保留业管查询、密码校验、孤儿清理等。

### 4.3 消除重复业管查询（可选优化）

`syncBizMgmtMembersForLocalUser` 内部 `:165` 会再查一次业管。check 已查过一次。为避免一次登录查业管 2 次，可让 sync 接受已查到的 members 作为参数。**本次作为可选优化**：若改动复杂则保留两次查询（业管接口能承受），优先保证正确性。

## 五、文件改动清单

### 5.1 `apps/web/src/components/team/member-list.tsx`（重构）

- 移除 Member/TeamData 中 credit 相关字段。
- 移除配额/已用/A 豆相关 UI、对话框、state、handler、辅助函数。
- 保留成员列表 + 添加/批量添加/移除功能。
- 表格列精简。

### 5.2 `apps/api/src/routes/auth/post-check-biz-mgmt.ts`

- 业管有会员分支：建 user（或查到老 user）后，`await syncBizMgmtMembersForLocalUser(userId, phone)` 同步建 team。
- 新增导入 `syncBizMgmtMembersForLocalUser`。

### 5.3 `apps/api/src/routes/auth/post-login.ts`

- 移除 `setImmediate(() => syncBizMgmtMembersForLocalUser(...))` 块（`:209-216`）。
- 移除 `syncBizMgmtMembersForLocalUser` 导入（若不再使用）。
- 保留业管查询、bcrypt 校验、孤儿清理、session/token 等。

### 5.4 `apps/api/src/__tests__/post-login-biz-mgmt-first.test.ts`

- 原"异步刷新不变量"测试断言 post-login 必须 `setImmediate(syncBizMgmtMembersForLocalUser)`。建 team 移到 check 后，此断言需更新：post-login 不再调 sync（改到 check）。
- 新增/调整 check 相关测试（若存在 check 测试文件）。

## 六、不变量（必须保持）

- 业管仍是账号唯一判官。
- 一个手机号一个本地 user。
- 多业管账号 = 多 team（通过 biz_mgmt_member_bindings 关联到同一 user）。
- `syncBizMgmtMembersForLocalUser` 幂等（已建的 team 不重复建）。
- 邮箱登录、SSO、邀请不受影响。

## 七、验收标准

- [ ] 登录后进团队管理页**不再报 toLocaleString 错误**，成员列表正常显示（用户名/账户/角色/加入时间）。
- [ ] 新用户走完「下一步」(check) 后：users 表有该 phone 的 user；该 user 名下有 N 个 team（N=业管返回的账号数），每个 team 有 workspace + binding。
- [ ] 老用户走 check：已有 team 不重复建，缺失的补建。
- [ ] login 不再异步调 sync；建 team 完全在 check 完成。
- [ ] post-login 契约测试同步更新且通过。
- [ ] 移除成员、添加成员（不涉及 credit）功能仍正常。

## 八、不做（YAGNI）

- 不做"同手机号多 user"重构。
- 不在本页接业管 A 豆余额展示（另议）。
- 不改 `syncBizMgmtMembersForLocalUser` 内部建 team 逻辑（仅改调用时机）。
- 不改 SSO/邀请/工作区管理。
