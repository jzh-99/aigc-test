# check-biz-mgmt 阶段预建本地用户 + 初始密码前置展示 设计文档

> 目的：修复两步式登录中"进了密码步但本地 user 未建、初始密码也未展示"的设计错位。把建 user 责任从 login 移到 check-biz-mgmt，并在密码步向新用户展示一次性初始密码。
>
> 创建：2026-06-29

---

## 一、背景与问题

两步式登录当前时序存在**职责错位**：

| 步骤 | 用户动作 | 接口 | 现状（错误） | 问题 |
|------|---------|------|-------------|------|
| 1 | 输手机号点「下一步」 | `POST /auth/check-biz-mgmt` | 只查业管返回 `{exists:true}`，**不建 user、不返回初始密码** | 新用户进密码步时拿不到密码 |
| 2 | 输密码点「登录」 | `POST /auth/login` | 本地无 user 时才建 user + 生成初始密码，**放在登录响应里**返回 | 初始密码出现得太晚（用户还没输入密码就要拿到密码，矛盾） |

**根本矛盾**：初始密码是给新用户登录用的，但它在"登录成功响应"里才返回——用户必须先用密码登录才能看到密码，形成死循环。新用户根本不知道密码是什么，无法完成登录。

**用户预期（已确认）**：进密码步时（check-biz-mgmt 阶段）就应建好本地 user 并生成一次性初始密码，前端在密码步把初始密码展示出来，用户用这个密码登录。

## 二、现状证据（代码事实）

- `post-check-biz-mgmt.ts:74-75`：业管有会员分支只 `return { exists: true }`，不查本地 users、不建 user、不返回任何密码。
- `post-login.ts:161-170`：本地无 user 时调 `ensureLocalUserForBizMgmtPhone` 建 user + 生成 `oneTimePassword`。
- `post-login.ts:256-259`：登录响应里附 `one_time_password`（用户已登录才能看到）。
- `login/page.tsx:113-118`：只在 `handleSubmit`（点登录后）读 `res.one_time_password` 弹 toast；密码步**无任何密码展示**。

## 三、目标设计（改后时序）

```
第一步「下一步」
  POST /auth/check-biz-mgmt {phone}
    ├ 业管无会员/故障 → 清孤儿 + 401 BIZ_MGMT_NOT_FOUND（不变）
    └ 业管有会员 → 查本地 users.phone
         ├ 本地有 user（老用户）→ {exists:true}（不建、不返密码）
         └ 本地无 user（新用户）→ ensureLocalUserForBizMgmtPhone 建 user + 生成初始密码
              → {exists:true, one_time_password:'Biz-xxxx'}
  前端：进密码步；若返回 one_time_password，在密码框上方展示黄色提示框

第二步「登录」
  POST /auth/login {identifier, password}
    后端：查本地 users.phone（正常必存在，check 已建好）
      ├ 本地无 user → 401 BIZ_MGMT_NOT_FOUND（拒绝绕过 check）
      └ 本地有 user → bcrypt 校验密码
  （移除 login 内建 user + 返回初始密码逻辑）
```

## 四、已确认的设计决策

1. **初始密码传递**：check-biz-mgmt 返回 `{exists:true, one_time_password?}`，前端在密码步展示（用户原意）。
2. **老用户处理**：本地已有 user 时不重建、不返密码，只返 `{exists:true}`。
3. **建 user 责任**：完全移到 check-biz-mgmt；login 只管密码校验，不再建 user。
4. **跳过 check 直调 login**：本地无 user → 返回 BIZ_MGMT_NOT_FOUND 拒绝（防止绕过 check）。
5. **前端展示**：密码步用黄色提示框（与现有 suspended/kicked 提示风格一致），不用 toast。

## 五、文件改动清单

### 5.1 `apps/api/src/routes/auth/post-check-biz-mgmt.ts`（核心改动）

- 业管有会员分支（现 `:74-75`）：新增查本地 `users.phone`。
- 本地无 user → 调 `ensureLocalUserForBizMgmtPhone(phone)`，取 `oneTimePassword`。
- 响应从 `return { exists: true }` 改为：
  ```ts
  if (created.oneTimePassword) {
    return { exists: true, one_time_password: created.oneTimePassword }
  }
  return { exists: true }
  ```
- 新增导入：`ensureLocalUserForBizMgmtPhone`。
- 更新顶部接口文档注释（返回约定加 `one_time_password?` + 安全说明）。

### 5.2 `apps/api/src/routes/auth/post-login.ts`（瘦身）

- 移除 `ensureLocalUserForBizMgmtPhone` 导入（`:11`）。
- 手机号登录分支：业管判存亡后查本地 user；**本地无 user → 返回 BIZ_MGMT_NOT_FOUND**（兜底防绕过）；本地有 user → bcrypt 校验。
- 移除 `oneTimePassword` 变量（`:118`）及其赋值（`:164`）。
- 移除登录响应附初始密码（`:256-259`），改为 `return authBody`。
- 删除相关注释（建 user + 初始密码相关）。
- 保留：业管查询、孤儿清理（业管查无分支）、异步同步、邮箱登录、账户锁定、频率限制。

### 5.3 `apps/web/src/app/(auth)/login/page.tsx`（前端展示）

- `handleNextStep`（`:74-94`）：接收 check 返回的 `one_time_password`，存入新 state `initialPassword`。
- 新增 state：`const [initialPassword, setInitialPassword] = useState<string | null>(null)`。
- 密码步视图（`:249` 起的 form）：若 `initialPassword` 非空，在密码输入框上方渲染黄色提示框（复用 suspended 提示框的 className 风格），文案含初始密码 + "请用此密码登录后尽快修改"。
- `handleSubmit`（`:113-118`）：移除登录成功后弹初始密码 toast 的逻辑（已在密码步展示）。
- 返回第一步（`handleBack`）：清空 `initialPassword`。

### 5.4 `packages/types/src/api.ts`

- check-biz-mgmt 响应类型加可选字段：`one_time_password?: string`（若该接口有显式类型；若无，跳过，前端用内联类型）。

## 六、不变量（必须保持）

- 业管仍是账号唯一判官（手机号登录无条件先查业管）。
- 业管查询失败/查无 → 清孤儿 + 401 BIZ_MGMT_NOT_FOUND。
- 本地积分系统退役：不建 credit_accounts，A 豆余额由业管管理。
- 邮箱登录走旧逻辑，不受影响。
- 账户锁定、频率限制等安全机制保留。
- `ensureLocalUserForBizMgmtPhone` 内部不变（它已封装"查业管→本地无则建→返回密码"）。

## 七、验收标准

- [ ] 新用户：输手机号点下一步 → 业管有会员 → 本地建好 user（users 表有该 phone）→ 前端进密码步并显示黄色提示框含初始密码。
- [ ] 老用户：输手机号点下一步 → 业管有会员 → 本地已有 user → 进密码步，无初始密码提示。
- [ ] 新用户用显示的初始密码点登录 → 登录成功，跳转改密页（password_change_required=true）。
- [ ] login 不再建 user；跳过 check 直调 login（本地无 user）→ 401 BIZ_MGMT_NOT_FOUND。
- [ ] 业管查无/故障 → check 返回 401 BIZ_MGMT_NOT_FOUND + 清孤儿。
- [ ] 邮箱登录不受影响。

## 八、风险与权衡

- **初始密码随 HTTP 响应返回给未认证客户端**：存在中间人窃取风险。缓解：HTTPS、初始密码用完即改（password_change_required=true）、提示遗失联系管理员重置。用户已确认接受此方案。
- **重复查业管消除**：原 login 建 user 时 `ensureLocalUserForBizMgmtPhone` 内部会再查一次业管；移到 check 后，业管只查一次（check 查），login 不再查业管建 user，减少一次业管调用。

## 九、不做（YAGNI）

- 不改 `ensureLocalUserForBizMgmtPhone` 内部实现（它已正确）。
- 不改 `syncBizMgmtMembersForLocalUser`（team/workspace 异步同步逻辑不变）。
- 不改 SSO、邀请等其他登录链路。
