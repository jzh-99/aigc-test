# 业管平台 A 豆流水接入设计

- 日期：2026-06-29
- 分支：feat-merge
- 关联：`docs/open-api/Toby业务管理平台-接口文档.md`（字段权威来源，本设计的附录）
- 关联代码：
  - 协议层 `apps/api/src/lib/toby-open-api.ts`（`queryTobyPointsChangeList`，签名/加密/解密均已完成，不动）
  - 服务层 `apps/api/src/services/biz-mgmt-a-bean.ts`（`queryCurrentBizMgmtLedger`，当前透传，待映射）
  - 路由 `apps/api/src/routes/credits/get-biz-mgmt-ledger.ts`

## 1. 背景与问题

业管平台 A 豆硬切换已完成，本地积分系统（`credits_ledger`）已退役。业管 A 豆流水的权威数据来自业管 `AIHUB_POINTS_CHANGE_QUERY` 接口（`/api/toby/points/external/change-list`）。

**现状盘点（探索结论）**：

- **后端基础设施已完整**：协议层 `toby-open-api.ts` 的 `queryTobyPointsChangeList()` 完成签名+DES 加解密；服务层 `biz-mgmt-a-bean.ts` 的 `queryCurrentBizMgmtLedger()` 按当前选中会员身份查询、有查询参数规范化；路由 `get-biz-mgmt-ledger.ts` 暴露 `GET /credits/biz-mgmt/ledger`；已有单元测试覆盖查询参数规范化。
- **后端的缺口**：`queryCurrentBizMgmtLedger` 当前 `return response.decryptedData ?? {}` 是**透传**，没有把业管原始字段（`changeNo/changeType/changePointsNum/balancePointsNum/createTime` 等）映射成定型的中性契约。项目内没有任何业管字段契约定义。
- **前端的缺口**：A 豆管理页 `apps/web/src/app/(dashboard)/credits/page.tsx` **只显示余额**，页面文案写着"如需查看完整流水请前往业务管理平台"，根本没接入流水接口。
- **旧组件已成孤儿**：`apps/web/src/components/credits/ledger-card.tsx` 字段（`module/model/provider/prompt/canvas_id/username/personal-team 切换`）深度绑定已退役的本地 `credits_ledger` 表，Grep 验证当前无任何引用，是死代码且会误导。

**问题**："开始使用业管平台 A 豆流水接口"= 把业管 `AIHUB_POINTS_CHANGE_QUERY` 的真实字段映射成统一契约，并在 A 豆管理页展示流水，同时清理退役的旧组件。

## 2. 业管 AIHUB_POINTS_CHANGE_QUERY 真实字段契约

来源：`docs/open-api/Toby业务管理平台-接口文档.md`（第 2 章 A 豆流水查询接口）。

**请求参数**（已实现，完全匹配）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | String | 是 | 会员编号 |
| changeType | String | 否 | 变动类型 1扣减/2返还/3赠送/4过期/5充值，支持逗号分割，为空查全部 |
| pageNum | Integer | 是 | >0 |
| pageSize | Integer | 是 | >0 且 ≤100 |

**响应 responseJson 解密后字段**：

外层：

| 字段 | 类型 | 说明 |
|---|---|---|
| total | long | 总条数 |
| pageNum | int | 页码 |
| pageSize | int | 页大小 |
| records | JSONObject | 流水列表（文档标 JSONObject，但配合 total/pageNum，实际可能为对象或数组，需双形态防御） |

每条 record：

| 字段 | 类型 | 说明 |
|---|---|---|
| changeNo | String | 流水号 |
| userId | String | 会员编号 |
| changeType | Integer | 1扣减/2返还/3赠送/4过期/5充值，支持逗号分割 |
| changeTypeName | String | 类型描述 |
| changePointsNum | BigDecimal | 变动数 |
| balancePointsNum | BigDecimal | 变动后 A 豆余额 |
| bizNo | String | 关联业务单号（创作单号、订购单号等） |
| changeReason | String | 变动原因 |
| source | String | 来源渠道 1B端/2C端/3H端/4业务管理平台 |
| operateUser | String | 操作人 |
| remark | String | 备注 |
| createTime | Date | `yyyy-MM-dd HH:mm:ss` |

## 3. 方案选择

三方案对比，已选**方案 A**：

- **方案 A（已选）：重做统一契约组件**。后端把业管 record 映射成中性契约 + 分页元数据；前端新建轻量 `biz-mgmt-ledger-card.tsx`；删除旧孤儿 `ledger-card.tsx`。
- **方案 B（排除）：前端直接吃业管原始字段**。后端零改动。与用户选择的"后端映射成统一契约"冲突，排除。
- **方案 C（排除）：改造复用现有 `ledger-card.tsx`**。字段深度绑定已退役本地积分模型，改造成本 ≈ 重写且残留无用概念（personal/team 切换在业管模型不存在），排除。

**前端交互范围**：带 `changeType` 类型筛选（tab 形式）+ 分页。

## 4. 统一契约（核心）

### 4.1 changeType 枚举双向映射

写死在服务层，有测试：

```ts
const CHANGE_TYPE_MAP = {
  1: { type: 'deduct',   sign: -1 },  // 扣减
  2: { type: 'refund',   sign: +1 },  // 返还
  3: { type: 'gift',     sign: +1 },  // 赠送
  4: { type: 'expire',   sign: -1 },  // 过期
  5: { type: 'recharge', sign: +1 },  // 充值
} as const
```

- 业管返回未知 changeType（不在 1-5）→ `type: 'unknown'`，`sign: +1`（保守取正，避免误显示扣减），`typeName` 用业管原始 `changeTypeName` 兜底。**不抛错**（业管未来加类型不应导致整页崩）。

### 4.2 字段映射规则

| 业管原始字段 | 统一契约字段 | 处理 |
|---|---|---|
| changeNo | id | 直接透传，作 key |
| changeType (1/2/3/4/5) | type | 映射成中性枚举 deduct/refund/gift/expire/recharge |
| changeTypeName | typeName | 优先用业管文案，缺失时 fallback 中文 |
| changePointsNum | amount | `Math.abs(Number(changePointsNum)) * sign`；业管可能给字符串 `"10.00"` 或数字；缺失/非法 → `0` |
| balancePointsNum | balanceAfter | `Number()`；缺失 → `null` |
| bizNo | bizNo | 字符串字段，空串/null/undefined 统一归一化为 `null` |
| changeReason | reason | 同上归一化 |
| source | source | `Number()` 透传数字（前端只展示，不强映射中文渠道，避免硬编码）；缺失 → `null` |
| operateUser | operator | 字符串归一化为 `null` |
| remark | remark | 字符串归一化为 `null` |
| createTime | createdAt | `yyyy-MM-dd HH:mm:ss` → 先 `new Date(createTime.replace(' ', 'T'))` 转 ISO；失败 → 原样透传字符串；缺失 → `''` |

### 4.3 records 归一化（双形态防御）

```ts
const raw = decryptedData.records
const records = Array.isArray(raw)
  ? raw
  : (raw && typeof raw === 'object' ? Object.values(raw) : [])
```

- 业管文档标 `records JSONObject`，但配合 `total/pageNum/pageSize`，实际形态不确定，对象和数组都防御。
- `records` 为 null/undefined → 空数组（配合 `total: 0`）。

### 4.4 分页元数据 fallback

- `total` 缺失 → `data.length`（单页可见数，前端 totalPages 至少为 1）。
- `pageNum`/`pageSize` 缺失 → 用请求入参 `pageNum`/`pageSize` 回填（保证前端分页控件状态正确）。
- `totalPages = Math.max(1, Math.ceil(total / pageSize))`。

### 4.5 错误处理（沿用现有惯例）

- 未选业管身份 → `getCurrentBizMgmtIdentity` 抛错 → 路由 400 `{ success: false, error: { code: 'BIZ_MGMT_IDENTITY_REQUIRED', message } }`，与 balance 接口完全一致。
- 业管 `code !== '0000'` → 服务层抛 `Error(response.message || '业管 A 豆流水查询失败')` → 路由 400。
- **不引入新错误码**。

### 4.6 最终返回结构

```ts
interface BizMgmtLedgerResult {
  data: BizMgmtLedgerRow[]
  total: number
  pageNum: number
  pageSize: number
}
```

## 5. 后端改动

类型 `BizMgmtLedgerRow` / `BizMgmtLedgerResult` 定义在 `services/biz-mgmt-a-bean.ts` 内导出（沿用现有 `normalizeBizMgmtPointsLedgerQuery` 同文件惯例）。前端自行定义同构 interface（前端已有 `LedgerRow` 先例，无需跨包共享类型）。

### 5.1 `services/biz-mgmt-a-bean.ts`（核心）

- 新增类型 `BizMgmtLedgerRow` + `BizMgmtLedgerResult`。
- 新增 `CHANGE_TYPE_MAP` 常量。
- 新增纯函数 `mapTobyPointsChangeRecord(record): BizMgmtLedgerRow`：字段映射 + amount 正负号 + 类型枚举 + 字符串归一化 + createTime 转换。
- 改造 `queryCurrentBizMgmtLedger`：调用现有 `queryTobyPointsChangeList` → 拿 `decryptedData` → records 归一化成数组 → 逐条 `mapTobyPointsChangeRecord` → 组装 `{ data, total, pageNum, pageSize }`（分页元数据 fallback）。

### 5.2 `routes/credits/get-biz-mgmt-ledger.ts`

- 几乎不动，仍返回 `queryCurrentBizMgmtLedger` 结果（结构从透传业管对象变成 `{ data, total, pageNum, pageSize }`）。
- 注释从"直接返回业管数据"改为"映射成统一契约"。

### 5.3 `__tests__/biz-mgmt-a-bean.test.ts`

- 现有 3 个测试（`buildBizMgmtDeductRequestNo`/`normalizeBizMgmtPointsBalance`/`normalizeBizMgmtPointsLedgerQuery`）**保留不动**。
- 新增 `mapTobyPointsChangeRecord` 纯函数单测：5 种已知 changeType 的 amount 正负号、1 个未知 changeType 兜底、typeName fallback、amount 缺失为 0、字符串字段空串归 null、createTime 正常转换 + 非法兜底。
- 新增 records 归一化测试：array 形态、object 形态、null、缺失。
- 新增分页元数据 fallback 测试：total 缺失、pageNum/pageSize 缺失。

**不动的部分**：Toby 协议层 `toby-open-api.ts`、`queryTobyPointsChangeList`、`normalizeBizMgmtPointsLedgerQuery`。

## 6. 前端改动

### 6.1 `app/(dashboard)/credits/page.tsx`（主页面）

- 新增状态：`pageNum`（默认 1）、`changeType` 筛选（默认空=全部）。
- 新增 SWR：`useSWR(['/credits/biz-mgmt/ledger', changeType, pageNum], fetcher)`，key 带查询参数（依赖变化自动重查），url 形如 `/credits/biz-mgmt/ledger?changeType=1&pageNum=1&pageSize=20`（changeType 为空时不带该参数）。
- 页面结构调整：
  - 保留：标题、余额卡片、`SettingsManagementNav`、充值弹窗。
  - **移除**："说明"卡片里"如需查看完整流水请前往业务管理平台"。
  - **新增**：流水区块（`BizMgmtLedgerCard`）。
- 未选业管身份（接口 400）时：流水区块显示"请先选择业管会员身份"提示（沿用余额卡片错误处理风格）。

### 6.2 `components/credits/biz-mgmt-ledger-card.tsx`（新组件）

基于中性契约新建轻量组件，**不复用旧 `ledger-card.tsx`**。参考旧组件视觉规范（Badge 颜色 class、tab 切换样式、tabular-nums 数字对齐、ChevronLeft/ChevronRight + Button 分页），保证 UI 一致。

结构：
- changeType 筛选：tab 形式 `全部 / 扣减 / 返还 / 赠送 / 过期 / 充值`，对应 `''/1/2/3/4/5`。
- 列表行：类型 Badge + 变动原因 + 业务单号（可选）+ 操作人（可选）+ 时间，右侧 amount（正绿负红）。
- 分页：底部 `第 X/Y 页，共 N 条` + 上下页按钮。
- 加载态：`Loader2` 旋转；空态："暂无记录"。

Props：

```ts
interface BizMgmtLedgerRow {
  id: string
  type: 'deduct' | 'refund' | 'gift' | 'expire' | 'recharge' | 'unknown'
  typeName: string
  amount: number
  balanceAfter: number | null
  bizNo: string | null
  reason: string | null
  source: number | null
  operator: string | null
  remark: string | null
  createdAt: string
}

interface Props {
  data: { data: BizMgmtLedgerRow[]; total: number; pageNum: number; pageSize: number } | undefined
  loading: boolean
  hasIdentity: boolean
  changeType: string
  setChangeType: (t: string) => void
  pageNum: number
  totalPages: number
  setPage: (p: number) => void
}
```

### 6.3 `components/credits/ledger-card.tsx`（删除）

确认无引用（Grep 验证仅自身定义），删除。字段对的是已退役本地 `credits_ledger`，是死代码且会误导。

## 7. 附带交付物：PDF→MD 接口文档

把 `docs/open-api/Toby业务管理平台-接口文档.pdf` 转成结构化 markdown，放在 `docs/open-api/Toby业务管理平台-接口文档.md`（PDF 同目录同名）。

转换要求：

1. **目录结构**：9 个接口各一个 `##` 章节（会员信息查询/A 豆流水查询/A 豆扣减/创作结果同步/订购同步/会员副卡变动/模型规格同步/个人会员注册/会员 A 豆余额查询）+ `## 通用约定`（加密签名）。
2. **每个接口三段式**：`### 接口定义`（名称/描述/URL 测试+正式/方式）、`### 请求参数`（表格：参数名/类型/说明/必填）、`### 响应参数`（外层 + `responseJson` 解密后字段表格 + 成功示例 JSON）。
3. **修正 PDF 渲染瑕疵**：重叠字符（`TToobbyy` → `Toby`、`JOSN` → `JSON`、`11..` → `1.`、`1 1.` → `11.`）、断行粘连的表格还原成标准 markdown 表格、`BigDecimal`/`Bigdecimal`/`BigDecim\nal` 统一为 `BigDecimal`。
4. **保留全部字段语义**：不省略任何字段，类型/必填/枚举值/默认值原样保留（尤其 `changeType` 1-5 枚举、`source` 1-4 渠道、`status` 枚举完整）。
5. **顶部加元信息头**：文档来源（PDF 路径）、转换日期、协议层封装位置 `apps/api/src/lib/toby-open-api.ts`、服务编码常量位置。

放置位置：`docs/open-api/`（已有 `MIGRATION.md`，是接口文档的天然归处）。spec（设计决策记录）与接口文档（参考资料）语义不同，分开存放。

该 md 转换是独立交付物，不阻塞 A 豆流水接入的实现（实现已基于提取的字段定义），作为本 spec 的附录（字段权威来源）。

## 8. 非目标 / YAGNI

- 不引入跨包共享类型（前后端各自定义同构 interface，沿用现有惯例）。
- 不映射 source 渠道为中文（前端只透传展示，避免硬编码业管渠道枚举）。
- 不为旧 `ledger-card.tsx` 的字段做迁移适配（直接删，它对的是已退役本地表）。
- 不改 Toby 协议层（签名/加密已完成且已验证）。
- 不引入新错误码（沿用 balance 接口的 `BIZ_MGMT_IDENTITY_REQUIRED`）。
- 流水第一版只做 changeType 筛选 + 分页，不做时间范围筛选、导出、搜索。

## 9. 验证方式

- 后端：`pnpm --filter @aigc/api test` 跑 `__tests__/biz-mgmt-a-bean.test.ts`，新增的映射/归一化/fallback 测试全绿。
- 前端：按 AGENTS.md「本地验证边界」约定，前端改动完成后即可结束反馈，不执行构建/浏览器刷新/重启 6006 等预览动作。
- 文档：`docs/open-api/Toby业务管理平台-接口文档.md` 生成后人工抽检字段完整性（9 接口齐全、changeType/source/status 枚举完整、无重叠字符残留）。
