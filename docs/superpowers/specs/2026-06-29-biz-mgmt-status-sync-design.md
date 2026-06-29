# 业管会员 status 全量同步（1正常/2冻结/3删除）设计文档

> 目的：修复业管会员状态变化（正常/冻结/删除）未正确同步到本地的问题。现状 filter 丢弃 status≠1 的会员，导致冻结/删除语义丢失、失效 team 残留、无法区分冻结与删除。
>
> 创建：2026-06-29

---

## 一、问题

### 1.1 status 语义（业管权威，用户确认）

| status | 业管含义 | 本地应做 |
|--------|---------|---------|
| 1 | 正常 | 建/更新 team，可选可用 |
| 2 | 冻结 | 同步展示，能登录能选中，但**限制付费能力**（生成/扣 A 豆拒绝）|
| 3 | 删除 | 已入库→软删 team；未入库→不入库；全部 status=3→拒绝登录 |

### 1.2 现状 bug

- `fetchBizMgmtMembersByPhone:106` `.filter(m => m.status === 1)` → status=2/3 全被丢弃，**进不了 sync**。
- `syncBizMgmtMembersForLocalUser:248-256` 用 `not in members` 推断冻结，把所有"本次未返回的"一律置 status=2 → **无法区分冻结(2)和删除(3)**。
- upsert 只处理本次返回（status=1）的会员，**永远无法把业管最新的 2/3 同步进 binding.status**。
- 会员被冻结/删除后，**team 永久残留**（不软删、不清理）。
- binding.status 字段长期不准。

### 1.3 已天然实现的部分（无需改）

- `getCurrentBizMgmtIdentity:79` 已 `.where('status','=',1)` → status=2/3 的 binding 查不到 → 生成/扣 A 豆抛错 402。**付费能力限制现状已实现**。
- 全部 status=3 → 拒绝登录：现状 filter 后 members=[] → check 返回 BIZ_MGMT_NOT_FOUND。但改 filter 后此判断需调整（见 3.3）。

## 二、目标设计

### 2.1 fetchBizMgmtMembersByPhone：不再过滤，返回全量

移除 `.filter(m => m.status === 1)`，返回 status=1/2/3 全部会员，真实 status 透传给 sync。

### 2.2 syncBizMgmtMembersForLocalUser：按 status 分流

遍历全部返回的会员，按 status 分流处理：

- **status=1（正常）**：现状逻辑不变（无 binding/team 则建，有则 upsert 刷新）。
- **status=2（冻结）**：
  - upsert binding（记 status=2）
  - **不建 team**（若已存在 team，保留不动——用户能看到置灰工作区）
  - 不软删
- **status=3（删除）**：
  - **未入库**（无 binding）→ 不建 binding、不建 team（跳过）
  - **已入库**（有 binding）→ 软删其 team（`teams.is_deleted=true, deleted_at=NOW()`）、软删 workspace；binding 保留并 upsert status=3（审计用）
- **移除老的 `not in` 冻结逻辑**（:248-256）：不再用"未返回"推断，改用业管真实 status。

### 2.3 check-biz-mgmt 拒绝逻辑调整

现状 `members.length === 0` 判断在 filter 之后。移除 filter 后，"全部 status=3"时 members 非空，不会触发拒绝。

改为：**当没有任何 status ∈ {1,2} 的会员时**（即全部 status=3），才拒绝 + 清孤儿。
- 有至少一条 status=1 或 2 → 进密码步（建 user）
- 全部 status=3 → 视为账户不存在 → 401 BIZ_MGMT_NOT_FOUND + 清孤儿

### 2.4 付费能力限制（现状已实现，无需改）

`getCurrentBizMgmtIdentity` 只认 status=1。status=2 的身份被选中后，生成接口调它 → 查不到 → 402 引导重选。符合"能登录但限制付费"。

## 三、文件改动清单

### 3.1 `apps/api/src/services/biz-mgmt-member-sync.ts`

- `fetchBizMgmtMembersByPhone:106`：移除 `.filter(m => m.status === 1)`。更新注释（不再"只返回 status=1"）。
- `syncBizMgmtMembersForLocalUser`：
  - 循环内按 member.status 分流（1 建/更新，2 仅 upsert binding 不动 team，3 已入库则软删 team+workspace）。
  - 移除 :248-256 的 `not in` 冻结批量更新。
- `normalizeBizMgmtMember`：status 类型已是 `1|2|3`，无需改。

### 3.2 `apps/api/src/routes/auth/post-check-biz-mgmt.ts`

- 拒绝判断：`members.length === 0` 改为 `!members.some(m => m.status === 1 || m.status === 2)`（无正常/冻结会员才拒绝）。
- 业管查无（fetch 返回空数组）仍走原拒绝分支。

### 3.3 `apps/api/src/routes/auth/post-login.ts`

- 登录时本地无 user 的兜底拒绝逻辑不变（建 user 在 check 完成）。
- 无需改 status 相关（login 不查业管建 user）。

### 3.4 测试

- `biz-mgmt-member-sync.test.ts`：新增 status=2/3 分流测试（文本扫描 sync 源码，断言 status=3 软删 team、status=2 不软删）。
- `post-check-biz-mgmt.test.ts`：新增"全部 status=3 → 拒绝"断言。
- `post-login-biz-mgmt-first.test.ts`：可能需微调（确认不回归）。

## 四、不变量

- 业管仍是账号唯一判官。
- 一个手机号一个 user（users 表不动）。
- status=3 全部 → 拒绝登录（提示账户不存在）。
- `getCurrentBizMgmtIdentity` 只认 status=1（付费限制天然生效）。
- 邮箱/SSO/邀请登录不受影响。

## 五、验收标准

- [ ] 业管返回 status=1 会员 → 建/更新 team，binding.status=1。
- [ ] 业管返回 status=2 会员 → upsert binding.status=2，team 不动（不建不删），登录可选中但生成返回 402。
- [ ] 业管返回 status=3 会员（已入库）→ 软删其 team（is_deleted=true, deleted_at=同步时间）+ 软删 workspace，binding.status=3 保留。
- [ ] 业管返回 status=3 会员（未入库）→ 不建 binding/team。
- [ ] 业管返回全部 status=3 → check 返回 401 BIZ_MGMT_NOT_FOUND + 清孤儿。
- [ ] 业管返回有 status=1 或 2 → check 进密码步。
- [ ] 会员 A 从 status=1 变 status=2 → 下次 sync 后 binding.status=2，team 保留，生成被限。
- [ ] 会员 B 从 status=1 变 status=3 → 下次 sync 后 team 软删，binding.status=3。

## 六、不做（YAGNI）

- 不改 users 表（不加 is_deleted）。
- 不改前端置灰 UI（本次只做后端 status 同步 + 付费限制；前端工作区置灰另议）。
- 不改 select-account 选择逻辑（status=2 能选，但生成受限）。
- 不做物理删除（一律软删，保留审计）。

## 七、风险

- **status=3 软删 team 后，用户当前选中该身份** → profile 里 current biz_mgmt 身份指向已软删 team。需确认 select 接口/profile 不会因 team 软删报错。本次范围内：sync 时若发现 is_selected 的 binding 变成 status=3，应清空 is_selected（避免悬空选中）。
