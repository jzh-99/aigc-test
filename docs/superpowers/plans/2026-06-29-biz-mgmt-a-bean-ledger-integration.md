# 业管 A 豆流水接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把业管 `AIHUB_POINTS_CHANGE_QUERY` 流水字段映射成统一契约，在 A 豆管理页展示带类型筛选和分页的流水列表，并清理已退役的旧流水组件，同时把 PDF 接口文档转成 markdown。

**Architecture:** 后端在现有透传基础上加纯映射函数（不碰协议层），把业管 record 映射成中性 `BizMgmtLedgerRow` + 分页元数据；前端在 `credits/page.tsx` 用 SWR 接入 `/credits/biz-mgmt/ledger`，新建轻量 `biz-mgmt-ledger-card.tsx`（tab 筛选 + 分页），删除绑定已退役本地表的旧 `ledger-card.tsx`。PDF→MD 作为独立交付物。

**Tech Stack:** Fastify 4 + Kysely（后端）、Next.js 14 + SWR + Radix/Tailwind（前端）、node:test（后端测试）。

**Spec:** `docs/superpowers/specs/2026-06-29-biz-mgmt-a-bean-ledger-integration-design.md`

**测试命令约定：** 本计划所有后端测试用 `node --import tsx/esm --test <文件>` 或直接 `npx tsx --test <文件>` 在 `apps/api` 目录下运行（项目用 node:test，无统一 test 脚本）。前端无单元测试基础设施（用 Playwright E2E），本次按 AGENTS.md「本地验证边界」不做浏览器验证。

---

## 文件结构

| 文件 | 责任 | 操作 |
|---|---|---|
| `apps/api/src/services/biz-mgmt-a-bean.ts` | 加 `BizMgmtLedgerRow`/`BizMgmtLedgerResult` 类型、`CHANGE_TYPE_MAP`、`mapTobyPointsChangeRecord` 纯函数；改造 `queryCurrentBizMgmtLedger` 从透传改映射 | Modify |
| `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts` | 新增映射/归一化/fallback 单测，保留现有 3 个测试 | Modify |
| `apps/api/src/routes/credits/get-biz-mgmt-ledger.ts` | 注释从"直接返回业管数据"改"映射成统一契约" | Modify |
| `apps/web/src/components/credits/biz-mgmt-ledger-card.tsx` | 新轻量流水组件（tab 筛选 + 分页，基于中性契约） | Create |
| `apps/web/src/app/(dashboard)/credits/page.tsx` | 接入 SWR 流水、加状态、移除"去业管看流水"文案、挂载新组件 | Modify |
| `apps/web/src/components/credits/ledger-card.tsx` | 旧孤儿组件（绑定已退役本地表），删除 | Delete |
| `docs/open-api/Toby业务管理平台-接口文档.md` | PDF 转结构化 md（9 接口 + 通用约定） | Create |

---

## Task 1: 后端 — changeType 枚举映射 + amount 正负号（纯函数 + 测试）

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-a-bean.ts`（文件末尾追加）
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`

本任务先把类型 + `CHANGE_TYPE_MAP` + 单条 record 映射纯函数加好，并覆盖 5 种已知 changeType 的正负号。records 归一化和查询函数改造留到 Task 2。

- [ ] **Step 1: 写失败测试（5 种 changeType 的 amount 正负号）**

在 `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts` 顶部 import 块加入 `mapTobyPointsChangeRecord`：

```ts
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
  mapTobyPointsChangeRecord,
} from '../services/biz-mgmt-a-bean.js'
```

在文件末尾追加测试：

```ts
test('ledger record maps 5 known changeTypes with correct amount sign', () => {
  const base = {
    changeNo: 'c1',
    userId: 'u1',
    changeTypeName: '类型名',
    bizNo: 'biz1',
    changeReason: '原因',
    source: '1',
    operateUser: 'op',
    remark: '备注',
    createTime: '2026-06-21 10:00:00',
  }
  // changeType 1 扣减 → 负
  assert.deepEqual(
    mapTobyPointsChangeRecord({ ...base, changeType: 1, changePointsNum: '10.00', balancePointsNum: '90.00' }),
    {
      id: 'c1', type: 'deduct', typeName: '类型名', amount: -10, balanceAfter: 90,
      bizNo: 'biz1', reason: '原因', source: 1, operator: 'op', remark: '备注', createdAt: '2026-06-21 10:00:00',
    },
  )
  // changeType 2 返还 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 2, changePointsNum: 5, balancePointsNum: 95 }).amount,
    5,
  )
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 2, changePointsNum: 5 }).type, 'refund',
  )
  // changeType 3 赠送 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 3, changePointsNum: 50 }).amount, 50,
  )
  // changeType 4 过期 → 负
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 4, changePointsNum: 3 }).amount, -3,
  )
  // changeType 5 充值 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 5, changePointsNum: 100 }).amount, 100,
  )
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: FAIL，报 `mapTobyPointsChangeRecord is not a function`（import 失败）。

- [ ] **Step 3: 实现类型 + CHANGE_TYPE_MAP + mapTobyPointsChangeRecord**

在 `apps/api/src/services/biz-mgmt-a-bean.ts` 的 `import` 块之后、`export interface CurrentBizMgmtIdentity` 之前，插入类型定义：

```ts
/**
 * 业管 A 豆流水中性契约（统一映射后的形态，前端只面对此结构）。
 * 来源：业管 AIHUB_POINTS_CHANGE_QUERY 解密后 record 经 mapTobyPointsChangeRecord 映射。
 */
export interface BizMgmtLedgerRow {
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

/** 流水查询结果：中性 record 列表 + 分页元数据（缺失项已 fallback）。 */
export interface BizMgmtLedgerResult {
  data: BizMgmtLedgerRow[]
  total: number
  pageNum: number
  pageSize: number
}

/**
 * 业管 changeType → 中性枚举 + amount 符号映射。
 * 1扣减(负) / 2返还(正) / 3赠送(正) / 4过期(负) / 5充值(正)。
 * 未知 changeType → unknown + 保守取正，避免误显示扣减，typeName 用业管原文兜底。
 */
const CHANGE_TYPE_MAP: Record<number, { type: BizMgmtLedgerRow['type']; sign: 1 | -1 }> = {
  1: { type: 'deduct', sign: -1 },
  2: { type: 'refund', sign: 1 },
  3: { type: 'gift', sign: 1 },
  4: { type: 'expire', sign: -1 },
  5: { type: 'recharge', sign: 1 },
}

/** 中文 fallback：业管 changeTypeName 缺失时按枚举给出中文。 */
const CHANGE_TYPE_NAME_FALLBACK: Record<number, string> = {
  1: '扣减',
  2: '返还',
  3: '赠送',
  4: '过期',
  5: '充值',
}

/** 业管 record 原始形态（宽松类型，字段缺失容错）。 */
interface TobyPointsChangeRecord {
  changeNo?: string | null
  changeType?: number | string | null
  changeTypeName?: string | null
  changePointsNum?: number | string | null
  balancePointsNum?: number | string | null
  bizNo?: string | null
  changeReason?: string | null
  source?: number | string | null
  operateUser?: string | null
  remark?: string | null
  createTime?: string | null
}
```

然后在文件末尾（`deductBizMgmtPointsForGeneration` 之后）追加纯映射函数：

```ts
/**
 * 把单条业管流水 record 映射成中性 BizMgmtLedgerRow。
 * 纯函数，无副作用，便于单测。
 * - amount：Math.abs(Number(changePointsNum)) * sign（扣减/过期为负）
 * - changePointsNum 缺失/非法 → amount: 0（不崩，记录仍展示）
 * - 字符串字段空串/null/undefined 统一归一化为 null
 * - createTime 'yyyy-MM-dd HH:mm:ss'（无时区，业管本地时间）原样透传为 createdAt；
 *   前端 new Date(createdAt) 会按本地时区解析渲染正确，避免转 ISO 丢失本地时区语义；
 *   createTime 缺失 → createdAt 空串
 */
export function mapTobyPointsChangeRecord(record: TobyPointsChangeRecord): BizMgmtLedgerRow {
  const rawType = Number(record.changeType)
  const mapped = CHANGE_TYPE_MAP[rawType]
  const type: BizMgmtLedgerRow['type'] = mapped ? mapped.type : 'unknown'
  const sign: 1 | -1 = mapped ? mapped.sign : 1

  const rawPoints = Number(record.changePointsNum)
  const amount = (Number.isFinite(rawPoints) ? Math.abs(rawPoints) : 0) * sign

  const rawBalance = Number(record.balancePointsNum)
  const balanceAfter = Number.isFinite(rawBalance) ? rawBalance : null

  const rawSource = Number(record.source)
  const source = Number.isFinite(rawSource) ? rawSource : null

  const typeName = (record.changeTypeName && String(record.changeTypeName).trim()) ||
    CHANGE_TYPE_NAME_FALLBACK[rawType] || '未知'

  // createTime 无时区（业管本地时间），原样透传；缺失为空串
  const createdAt = record.createTime != null ? String(record.createTime).trim() : ''

  return {
    id: String(record.changeNo ?? ''),
    type,
    typeName,
    amount,
    balanceAfter,
    bizNo: normalizeNullableString(record.bizNo),
    reason: normalizeNullableString(record.changeReason),
    source,
    operator: normalizeNullableString(record.operateUser),
    remark: normalizeNullableString(record.remark),
    createdAt,
  }
}

/** 字符串归一化：空串/null/undefined → null；否则 trim 后返回。 */
function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS（4 个测试全绿：原 3 个 + 新 1 个）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/biz-mgmt-a-bean.ts apps/api/src/__tests__/biz-mgmt-a-bean.test.ts
git commit -m "feat(api): 业管 A 豆流水 record 纯映射函数 + 5 种 changeType 正负号单测"
```

---

## Task 2: 后端 — 兜底与归一化（未知类型/缺字段/字符串/时间）

**Files:**
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`

补充 `mapTobyPointsChangeRecord` 的边界单测。不改实现（Task 1 实现已覆盖这些边界）。

- [ ] **Step 1: 写边界测试**

在 `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts` 末尾追加：

```ts
test('ledger record tolerates unknown changeType with positive sign and original typeName', () => {
  const row = mapTobyPointsChangeRecord({
    changeNo: 'c2', changeType: 99, changeTypeName: '新活动',
    changePointsNum: '7', balancePointsNum: '88',
  })
  assert.equal(row.type, 'unknown')
  assert.equal(row.amount, 7) // 保守取正
  assert.equal(row.typeName, '新活动') // 业管原文兜底
})

test('ledger record uses Chinese fallback when changeTypeName missing', () => {
  const row = mapTobyPointsChangeRecord({ changeNo: 'c3', changeType: 1, changePointsNum: 2 })
  assert.equal(row.typeName, '扣减')
})

test('ledger record treats missing changePointsNum as amount 0', () => {
  const row = mapTobyPointsChangeRecord({ changeNo: 'c4', changeType: 1, changePointsNum: null })
  assert.equal(row.amount, 0)
  assert.equal(row.balanceAfter, null) // balancePointsNum 也缺失
})

test('ledger record normalizes empty/nullable string fields to null', () => {
  const row = mapTobyPointsChangeRecord({
    changeNo: 'c5', changeType: 5, changePointsNum: 10,
    bizNo: '', changeReason: '   ', operateUser: undefined, remark: '备注',
  })
  assert.equal(row.bizNo, null)
  assert.equal(row.reason, null)
  assert.equal(row.operator, null)
  assert.equal(row.remark, '备注')
})

test('ledger record passes through createTime as-is (no timezone, no ISO conversion)', () => {
  const ok = mapTobyPointsChangeRecord({ changeNo: 'c6', changeType: 1, changePointsNum: 1, createTime: '2026-06-21 10:00:00' })
  assert.equal(ok.createdAt, '2026-06-21 10:00:00') // 业管本地时间原样透传，不转 ISO（避免时区偏移）
  const bad = mapTobyPointsChangeRecord({ changeNo: 'c7', changeType: 1, changePointsNum: 1, createTime: 'not-a-date' })
  assert.equal(bad.createdAt, 'not-a-date') // 非法值也原样透传，前端 new Date() 解析失败时自行兜底
  const missing = mapTobyPointsChangeRecord({ changeNo: 'c8', changeType: 1, changePointsNum: 1 })
  assert.equal(missing.createdAt, '') // 缺失为空串
})
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS（9 个测试全绿：Task 1 的 4 个 + 本任务 5 个）。实现未改，测试应直接通过——若失败说明 Task 1 实现有遗漏，回去补。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/__tests__/biz-mgmt-a-bean.test.ts
git commit -m "test(api): 业管流水 record 映射边界单测（未知类型/缺字段/时间转换）"
```

---

## Task 3: 后端 — records 归一化（数组/对象/空形态）

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-a-bean.ts`
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`

业管文档标 `records JSONObject`，但配合 `total/pageNum`，实际可能是数组或对象。本任务加归一化纯函数 + 测试。

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts` 顶部 import 块加入 `normalizeTobyRecords`：

```ts
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
  mapTobyPointsChangeRecord,
  normalizeTobyRecords,
} from '../services/biz-mgmt-a-bean.js'
```

末尾追加测试：

```ts
test('normalizeTobyRecords accepts array form', () => {
  const arr = [{ changeNo: 'a' }, { changeNo: 'b' }]
  assert.deepEqual(normalizeTobyRecords(arr), arr)
})

test('normalizeTobyRecords accepts object form (object values)', () => {
  const obj = { x: { changeNo: 'a' }, y: { changeNo: 'b' } }
  assert.deepEqual(normalizeTobyRecords(obj), [{ changeNo: 'a' }, { changeNo: 'b' }])
})

test('normalizeTobyRecords returns empty array for null/undefined/non-object', () => {
  assert.deepEqual(normalizeTobyRecords(null), [])
  assert.deepEqual(normalizeTobyRecords(undefined), [])
  assert.deepEqual(normalizeTobyRecords('string'), [])
  assert.deepEqual(normalizeTobyRecords(123), [])
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: FAIL，报 `normalizeTobyRecords is not a function`。

- [ ] **Step 3: 实现 normalizeTobyRecords**

在 `apps/api/src/services/biz-mgmt-a-bean.ts` 的 `mapTobyPointsChangeRecord` 函数之后（`normalizeNullableString` 之前或之后均可，保持相邻）追加：

```ts
/**
 * 归一化业管 records 字段为数组。
 * 业管文档标 records 为 JSONObject，但配合 total/pageNum 实际形态不确定，
 * 数组与对象两种都防御；null/undefined/非对象 → 空数组。
 */
export function normalizeTobyRecords(raw: unknown): TobyPointsChangeRecord[] {
  if (Array.isArray(raw)) return raw as TobyPointsChangeRecord[]
  if (raw && typeof raw === 'object') return Object.values(raw) as TobyPointsChangeRecord[]
  return []
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS（13 个测试全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/services/biz-mgmt-a-bean.ts apps/api/src/__tests__/biz-mgmt-a-bean.test.ts
git commit -m "feat(api): 业管流水 records 双形态归一化（数组/对象）"
```

---

## Task 4: 后端 — 改造 queryCurrentBizMgmtLedger 从透传改映射

**Files:**
- Modify: `apps/api/src/services/biz-mgmt-a-bean.ts`（`queryCurrentBizMgmtLedger` 函数）
- Test: `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts`

把现有透传函数改成调用 `normalizeTobyRecords` + `mapTobyPointsChangeRecord`，组装带 fallback 的分页元数据。

- [ ] **Step 1: 写失败测试（分页元数据 fallback）**

在 `apps/api/src/__tests__/biz-mgmt-a-bean.test.ts` 顶部 import 块加入 `buildBizMgmtLedgerResult`：

```ts
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
  mapTobyPointsChangeRecord,
  normalizeTobyRecords,
  buildBizMgmtLedgerResult,
} from '../services/biz-mgmt-a-bean.js'
```

末尾追加测试：

```ts
test('buildBizMgmtLedgerResult maps records and falls back missing pagination meta', () => {
  // 业管完整返回
  const full = buildBizMgmtLedgerResult({
    decryptedData: {
      total: 30,
      pageNum: 2,
      pageSize: 20,
      records: [{ changeNo: 'r1', changeType: 1, changePointsNum: '5', changeTypeName: '扣减', createTime: '2026-06-21 10:00:00' }],
    },
    requestPageNum: 2,
    requestPageSize: 20,
  })
  assert.equal(full.total, 30)
  assert.equal(full.pageNum, 2)
  assert.equal(full.pageSize, 20)
  assert.equal(full.data.length, 1)
  assert.equal(full.data[0].id, 'r1')
  assert.equal(full.data[0].amount, -5)

  // 业管缺 total/pageNum/pageSize → fallback
  const sparse = buildBizMgmtLedgerResult({
    decryptedData: {
      records: [{ changeNo: 'r2', changeType: 5, changePointsNum: 10 }],
        },
    requestPageNum: 1,
    requestPageSize: 20,
  })
  assert.equal(sparse.total, 1) // fallback 用 data.length
  assert.equal(sparse.pageNum, 1) // fallback 用请求入参
  assert.equal(sparse.pageSize, 20)

  // decryptedData 整体缺失 → 空结果
  const empty = buildBizMgmtLedgerResult({
    decryptedData: null,
    requestPageNum: 1,
    requestPageSize: 20,
  })
  assert.deepEqual(empty, { data: [], total: 0, pageNum: 1, pageSize: 20 })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: FAIL，报 `buildBizMgmtLedgerResult is not a function`。

- [ ] **Step 3: 实现 buildBizMgmtLedgerResult 并改造 queryCurrentBizMgmtLedger**

在 `apps/api/src/services/biz-mgmt-a-bean.ts` 的 `normalizeTobyRecords` 之后追加：

```ts
/**
 * 把业管 AIHUB_POINTS_CHANGE_QUERY 的解密响应组装成 BizMgmtLedgerResult。
 * - records 双形态归一化后逐条映射成中性 BizMgmtLedgerRow
 * - 分页元数据缺失时 fallback：total 用 data.length，pageNum/pageSize 用请求入参
 */
export function buildBizMgmtLedgerResult(input: {
  decryptedData: unknown
  requestPageNum: number
  requestPageSize: number
}): BizMgmtLedgerResult {
  const payload = (input.decryptedData && typeof input.decryptedData === 'object'
    ? input.decryptedData
    : {}) as { records?: unknown; total?: number; pageNum?: number; pageSize?: number }

  const data = normalizeTobyRecords(payload.records).map(mapTobyPointsChangeRecord)
  const total = typeof payload.total === 'number' ? payload.total : data.length
  const pageNum = typeof payload.pageNum === 'number' ? payload.pageNum : input.requestPageNum
  const pageSize = typeof payload.pageSize === 'number' ? payload.pageSize : input.requestPageSize

  return { data, total, pageNum, pageSize }
}
```

然后把现有 `queryCurrentBizMgmtLedger` 函数整体替换为（保留函数签名注释，改实现）：

```ts
/**
 * 查询当前选中业管会员的 A 豆流水（AIHUB_POINTS_CHANGE_QUERY）。
 * 业管原始 record 经 buildBizMgmtLedgerResult 映射成中性 BizMgmtLedgerResult，
 * 不读取本地 credits_ledger。未选择身份时 getCurrentBizMgmtIdentity 抛错。
 */
export async function queryCurrentBizMgmtLedger(input: {
  localUserId: string
  changeType?: string
  pageNum?: number
  pageSize?: number
}): Promise<BizMgmtLedgerResult> {
  const identity = await getCurrentBizMgmtIdentity(input.localUserId)
  const requestPageNum = Math.max(1, Math.trunc(input.pageNum ?? 1))
  const requestPageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 20)))
  const response = await queryTobyPointsChangeList(
    normalizeBizMgmtPointsLedgerQuery({
      bizMgmtUserId: identity.bizMgmtUserId,
      changeType: input.changeType,
      pageNum: requestPageNum,
      pageSize: requestPageSize,
    }),
  )
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆流水查询失败')
  return buildBizMgmtLedgerResult({
    decryptedData: response.decryptedData,
    requestPageNum,
    requestPageSize,
  })
}
```

注意：原实现直接复用 `normalizeBizMgmtPointsLedgerQuery` 处理 pageNum/pageSize，新实现先在本函数算好 `requestPageNum`/`requestPageSize`（与 normalize 结果一致），用于 fallback 回填，避免业管缺字段时分页状态错乱。

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS（14 个测试全绿）。

- [ ] **Step 5: 更新路由注释**

修改 `apps/api/src/routes/credits/get-biz-mgmt-ledger.ts` 顶部注释，把"直接返回业管数据"改为映射口径：

```ts
/**
 * GET /credits/biz-mgmt/ledger — 查询当前选中业管会员的 A 豆流水。
 *
 * 权威约束：流水来自业管 AIHUB_POINTS_CHANGE_QUERY，经服务层映射成统一中性契约
 * （BizMgmtLedgerRow + 分页元数据），不读取本地 credits_ledger。未选择业管身份时返回 400。
 */
```

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/services/biz-mgmt-a-bean.ts apps/api/src/__tests__/biz-mgmt-a-bean.test.ts apps/api/src/routes/credits/get-biz-mgmt-ledger.ts
git commit -m "feat(api): 业管 A 豆流水查询从透传改为统一契约映射 + 分页元数据 fallback"
```

---

## Task 5: 后端 — 类型检查全量回归

**Files:** 无（仅验证）

- [ ] **Step 1: 跑 api 包 TypeScript 类型检查**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 无类型错误（EXIT 0）。重点关注 `queryCurrentBizMgmtLedger` 改动后返回类型 `Promise<BizMgmtLedgerResult>` 与路由层兼容。

- [ ] **Step 2: 跑全部后端流水相关测试**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS，14 个测试全绿（原 3 个 + 新增 11 个）。

- [ ] **Step 3: 若有类型/测试错误则修复，否则无需提交（本任务为验证关卡，无代码变更）**

---

## Task 6: 前端 — 新建 BizMgmtLedgerCard 组件

**Files:**
- Create: `apps/web/src/components/credits/biz-mgmt-ledger-card.tsx`

新建轻量流水组件。视觉规范参考旧 `ledger-card.tsx`（Badge 颜色、tab 切换、tabular-nums、ChevronLeft/Right + Button 分页），但字段基于中性契约。

- [ ] **Step 1: 创建组件文件**

创建 `apps/web/src/components/credits/biz-mgmt-ledger-card.tsx`：

```tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronLeft, ChevronRight, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 业管 A 豆流水中性契约（与后端 BizMgmtLedgerRow 同构）。 */
export interface BizMgmtLedgerRow {
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

// changeType 筛选 tab：值对应业管 changeType，'' 为全部
const TYPE_TABS: { label: string; value: string }[] = [
  { label: '全部', value: '' },
  { label: '扣减', value: '1' },
  { label: '返还', value: '2' },
  { label: '赠送', value: '3' },
  { label: '过期', value: '4' },
  { label: '充值', value: '5' },
]

// amount 颜色：正数绿、负数红、0/未知中性
const AMOUNT_COLOR: Record<BizMgmtLedgerRow['type'], string> = {
  deduct: 'text-red-500',
  expire: 'text-muted-foreground',
  refund: 'text-green-600',
  gift: 'text-green-600',
  recharge: 'text-green-600',
  unknown: 'text-foreground',
}

// Badge 配色：扣减/过期偏冷，返还/赠送/充值偏绿
const TYPE_BADGE_CLASS: Record<BizMgmtLedgerRow['type'], string> = {
  deduct: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  expire: 'border-border bg-muted/50 text-muted-foreground',
  refund: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  gift: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  recharge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  unknown: 'border-border bg-muted/50 text-muted-foreground',
}

export function BizMgmtLedgerCard({
  data, loading, hasIdentity, changeType, setChangeType, pageNum, totalPages, setPage,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">A豆流水</CardTitle>
          <div className="flex gap-1 text-sm">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setChangeType(tab.value)}
                className={cn(
                  'px-3 py-1 rounded-md transition-colors whitespace-nowrap',
                  changeType === tab.value
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!hasIdentity ? (
          <p className="text-center text-muted-foreground py-10 text-sm">请先选择业管会员身份</p>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.data.length ? (
          <p className="text-center text-muted-foreground py-10 text-sm">暂无记录</p>
        ) : (
          <>
            <div className="divide-y divide-border/70">
              {data.data.map((row) => (
                <LedgerRowItem key={row.id} row={row} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  第 {pageNum} / {totalPages} 页，共 {data.total} 条
                </span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={pageNum <= 1} onClick={() => setPage(pageNum - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={pageNum >= totalPages} onClick={() => setPage(pageNum + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LedgerRowItem({ row }: { row: BizMgmtLedgerRow }) {
  const amountText = `${row.amount > 0 ? '+' : ''}${row.amount.toLocaleString()}`
  const createdAt = row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : ''
  // 时间解析失败时 new Date 会得 Invalid Date，toLocaleString 输出 "Invalid Date"，回退原值
  const displayTime = createdAt === 'Invalid Date' ? row.createdAt : createdAt

  return (
    <div className="px-6 py-4 transition-colors hover:bg-muted/30">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn('h-5 rounded-full px-2 text-[11px] font-medium shrink-0', TYPE_BADGE_CLASS[row.type])}
            >
              {row.typeName}
            </Badge>
            {row.operator && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <UserRound className="h-3 w-3" />
                {row.operator}
              </span>
            )}
          </div>

          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {row.reason || row.typeName}
          </p>

          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            {row.bizNo && (
              <span className="min-w-0 max-w-[260px] truncate rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px]">
                {row.bizNo}
              </span>
            )}
            {displayTime && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                {displayTime}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-[72px] justify-end">
          <span className={cn('text-base font-semibold tabular-nums tracking-tight', AMOUNT_COLOR[row.type])}>
            {amountText}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/credits/biz-mgmt-ledger-card.tsx
git commit -m "feat(web): 新建业管 A 豆流水组件 biz-mgmt-ledger-card（tab 筛选 + 分页）"
```

---

## Task 7: 前端 — credits/page.tsx 接入流水并移除旧文案

**Files:**
- Modify: `apps/web/src/app/(dashboard)/credits/page.tsx`

接入 SWR 流水、加状态、移除"去业管看流水"文案、挂载 `BizMgmtLedgerCard`。

- [ ] **Step 1: 改造 credits/page.tsx**

整体替换 `apps/web/src/app/(dashboard)/credits/page.tsx` 内容：

```tsx
'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Coins } from 'lucide-react'
import { TopupModal } from '@/components/credits/topup-modal'
import { SettingsManagementNav } from '@/components/layout/settings-management-nav'
import { BizMgmtLedgerCard } from '@/components/credits/biz-mgmt-ledger-card'
import Link from 'next/link'

/**
 * A 豆管理页。
 *
 * 硬切换后本地积分系统已退役，余额与流水均来自业管平台：
 * - 余额：GET /credits/biz-mgmt/balance → { balance }（业管 MEMBER-1004 现查）
 * - 流水：GET /credits/biz-mgmt/ledger（业管 AIHUB_POINTS_CHANGE_QUERY 现查，经服务层映射成统一契约）
 * 不再区分团队/个人账户，业管以当前选中会员身份查询。
 */
interface BizMgmtBalance {
  balance: number
}

interface BizMgmtLedgerResponse {
  data: Array<{
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
  }>
  total: number
  pageNum: number
  pageSize: number
}

const PAGE_SIZE = 20

export default function CreditsPage() {
  const [topupOpen, setTopupOpen] = useState(false)
  const [changeType, setChangeType] = useState('')
  const [page, setPage] = useState(1)

  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useSWR<BizMgmtBalance>('/credits/biz-mgmt/balance')

  // 流水：SWR key 带查询参数，changeType/page 变化自动重查。
  // useSWR 的 key 数组形式：fetcher 默认取首元素作 path。
  const ledgerQuery = changeType
    ? `/credits/biz-mgmt/ledger?changeType=${changeType}&pageNum=${page}&pageSize=${PAGE_SIZE}`
    : `/credits/biz-mgmt/ledger?pageNum=${page}&pageSize=${PAGE_SIZE}`
  const { data: ledgerData, isLoading: ledgerLoading, error: ledgerError } =
    useSWR<BizMgmtLedgerResponse>(ledgerQuery)

  const balance = balanceData?.balance ?? 0
  const totalPages = ledgerData
    ? Math.max(1, Math.ceil(ledgerData.total / (ledgerData.pageSize || PAGE_SIZE)))
    : 1

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">A豆管理</h1>
        <p className="text-muted-foreground">查看当前可用A豆余额（数据来自业务管理平台）</p>
      </div>

      <SettingsManagementNav showBack />

      {/* 当前可用 A 豆（业管权威余额） */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">可用A豆</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-accent-orange" />
            <span className="text-2xl font-bold">{balance.toLocaleString()}</span>
          </div>
          <Button size="sm" onClick={() => setTopupOpen(true)}>充值A豆</Button>
        </CardContent>
      </Card>

      {/* 业管 A 豆流水（统一契约，带类型筛选 + 分页） */}
      <BizMgmtLedgerCard
        data={ledgerData}
        loading={ledgerLoading}
        // 接口 400（未选身份）时 error 非 null，hasIdentity 为 false 显示"请先选择业管会员身份"
        hasIdentity={!ledgerError}
        changeType={changeType}
        setChangeType={(t) => {
          setChangeType(t)
          setPage(1) // 切换类型时重置回第一页
        }}
        pageNum={page}
        totalPages={totalPages}
        setPage={setPage}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>A 豆余额与消费流水由业务管理平台统一管理。</p>
          <p>充值成功后，A 豆将由业管平台实时入账。</p>
        </CardContent>
      </Card>

      <Link href="/team" className="block">
        <Card className="border-accent-orange/30 hover:border-accent-orange/60 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-accent-orange" />
              <div>
                <p className="text-sm font-medium">团队成员管理</p>
                <p className="text-xs text-muted-foreground">查看团队成员与权限</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
      />
    </div>
  )
}
```

关键变更：
- 新增 `BizMgmtLedgerResponse` 类型（与后端 `BizMgmtLedgerResult` 同构）
- 新增 `changeType`/`page` 状态，切换类型时重置回第 1 页
- 流水 SWR key 随 `changeType`/`page` 变化自动重查
- `hasIdentity={!ledgerError}`：接口 400 时 `error` 非 null，组件显示"请先选择业管会员身份"
- "说明"卡片移除"如需查看完整流水请前往业务管理平台"那句

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/app/\(dashboard\)/credits/page.tsx
git commit -m "feat(web): A 豆管理页接入业管流水（SWR + 类型筛选 + 分页），移除去业管看流水文案"
```

---

## Task 8: 前端 — 删除旧孤儿组件 ledger-card.tsx

**Files:**
- Delete: `apps/web/src/components/credits/ledger-card.tsx`

旧组件字段绑定已退役的本地 `credits_ledger` 表（`module/model/provider/prompt/canvas_id/username/personal-team` 切换），Grep 已验证无引用，是死代码。

- [ ] **Step 1: 再次确认无引用**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -i "ledger-card" || echo "no references to ledger-card in type check"
```

同时用 Grep 工具确认：搜 `apps/web/src` 下 `ledger-card` 与 `LedgerCard`，应只在 `components/credits/ledger-card.tsx` 自身命中（无 import）。

Expected: 无任何 `import ... from '.../ledger-card'` 引用。

- [ ] **Step 2: 删除文件**

```bash
git rm apps/web/src/components/credits/ledger-card.tsx
```

- [ ] **Step 3: 类型检查确认无断裂**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无类型错误（若报错说明有遗漏引用，需回退删除并补查引用点）。

- [ ] **Step 4: 提交**

```bash
git commit -m "refactor(web): 删除已退役的本地积分流水组件 ledger-card（绑定已废弃 credits_ledger 表）"
```

---

## Task 9: 文档 — PDF 接口文档转 markdown

**Files:**
- Create: `docs/open-api/Toby业务管理平台-接口文档.md`

把 PDF 转成结构化 markdown。源字段已从 PDF 提取（25 页），需修正重叠字符渲染瑕疵（`TToobbyy`→`Toby`、`JOSN`→`JSON`、`11..`→`1.`、`BigDecim\nal`→`BigDecimal`），还原断行表格。

- [ ] **Step 1: 创建 markdown 文档**

创建 `docs/open-api/Toby业务管理平台-接口文档.md`：

````markdown
# Toby 业务管理平台接口文档（Markdown 版）

> - **来源**：`docs/open-api/Toby业务管理平台-接口文档.pdf`（人工转换并修正 PDF 重叠字符渲染瑕疵）
> - **转换日期**：2026-06-29
> - **协议层封装**：`apps/api/src/lib/toby-open-api.ts`（DES/CBC/PKCS5Padding 加解密 + MD5 签名）
> - **服务编码常量**：`TOBY_SERVICE_CODES`（`apps/api/src/lib/toby-open-api.ts`）
> - **说明**：所有接口均为 POST + JSON，请求体 `{ appID, requestJson }`，`requestJson` 为加密后的业务参数；响应 `data` 为 `{ appID, responseJson }`，`responseJson` 解密后含业务字段 + 验签字段（`appID/timestamp/serviceCode/signature`）。

## 通用约定

### 签名规则

- 签名值 = 对 `appID/appSecret/timestamp/serviceCode` 按 key 排序后拼接（`key=value&...`）做 MD5。
- `timestamp` 为秒级时间戳，参与签名。
- 签名有效期：默认 600 秒（`TOBY_SIGNATURE_VALID_SECONDS` 环境变量可调）。

### 加解密

- 算法：DES/CBC/PKCS5Padding
- IV：固定 `12345678`
- 密钥：取 `TOBY_OUTBOUND_PRIVATE_KEY`（出站）/ `TOBY_INBOUND_PRIVATE_KEY`（入站）前 8 字节

### 服务编码（serviceCode）

| 常量名 | serviceCode | 接口 |
|---|---|---|
| memberLoginInfo | MEMBER-1001 | 会员信息查询 |
| memberSubCard | MEMBER-1002 | 会员副卡变动同步 |
| memberRegister | MEMBER-1003 | 个人会员注册 |
| memberPoints | MEMBER-1004 | 会员 A 豆余额查询 |
| pointsChangeQuery | AIHUB_POINTS_CHANGE_QUERY | A 豆流水查询 |
| pointsChange | AIHUB_POINTS_CHANGE | A 豆扣减 |
| creationResultNotify | AIHUB_CREATION_RESULT_NOTIFY | 创作结果同步 |
| subscribe | SUBSCRIBE_SERVICE_CODE_1001 | 订购同步 |
| specificationConfig | SPECIFICATION-CONFIG | 模型规格同步 |

---

## 1. 会员信息查询接口

### 1.1 接口定义

- **接口名称**：会员信息查询
- **接口描述**：根据手机号查询会员信息，同一手机号可能关联多条会员记录，返回会员信息列表；未查询到会员时返回会员不存在。
- **承载协议**：HTTPS
- **请求方式**：POST
- **数据格式**：JSON
- **测试 URL**：`http://61.155.229.73:18080/api/toby/member/query-by-phone`

### 1.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 服务编码，固定为 `MEMBER-1001` | 是 |
| phone | String | 手机号 | 是 |

### 1.3 响应参数

外层：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| code | String | `0000` 成功；`1000` 参数/验签/业务规则异常；`1001` 会员不存在；`9999` 系统异常 |
| message | String | 响应描述 |
| data | Object | 成功时为 `{ appID, responseJson }` |

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| members | Array | 会员信息列表 |
| members[].userId | String | 会员编号 |
| members[].phone | String | 手机号 |
| members[].userName | String | 会员名称 |
| members[].compName | String | 公司名称（个人会员为空；仅公司会员有值） |
| members[].userType | String | 会员类型：1-个人，2-公司 |
| members[].status | Integer | 当前状态：1-正常，2-冻结，3-删除 |
| members[].pointsNum | BigDecimal | A 豆余额；为空时按 0 返回 |
| members[].sumPointsNum | BigDecimal | 累计获得 A 豆；为空时按 0 返回 |
| members[].consumePointsNum | BigDecimal | 累计消耗 A 豆；为空时按 0 返回（过期不统计） |
| members[].goodsId | String | 最近一条已完成订购记录的商品 ID |
| members[].goodsName | String | 最近一条已完成订购记录的商品名称 |
| members[].createTime | Date | 注册时间 |

成功结果示例：

```json
{
  "members": [
    {
      "userId": "8f3d...",
      "phone": "13800000000",
      "userName": "张三",
      "compName": "个人",
      "userType": "1",
      "status": 1,
      "pointsNum": 0.00,
      "sumPointsNum": 100.00,
      "consumePointsNum": 10.22,
      "goodsId": "goods001",
      "goodsName": "模型规格名称",
      "createTime": "2026-06-21 10:00:00"
    }
  ]
}
```

---

## 2. A 豆流水查询接口

> **本项目使用入口**：服务层 `queryCurrentBizMgmtLedger`（`apps/api/src/services/biz-mgmt-a-bean.ts`）→ 协议层 `queryTobyPointsChangeList`。

### 2.1 接口定义

- **接口名称**：A 豆流水查询
- **接口描述**：查询 A 豆变动流水，包含订购、创作、返还等场景的增加/扣减记录
- **承载协议**：HTTPS
- **请求方式**：POST
- **数据格式**：JSON
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/change-list`

### 2.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_POINTS_CHANGE_QUERY` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| changeType | String | 变动类型：1 扣减；2 返还；3 赠送；4 过期；5 充值（支持逗号分割） | 否，为空表示查询全部流水（不分类） |
| pageNum | Integer | 页码，必须大于 0 | 是 |
| pageSize | Integer | 每页条数，必须大于 0 且不大于 100 | 是 |

### 2.3 响应参数

外层：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| code | String | `0000` 成功 |
| message | String | 信息描述 |
| data | String | JSON 字符串 `{ appID, responseJson }` |

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| total | long | 总条数 |
| pageNum | int | 页码 |
| pageSize | int | 页大小 |
| records | JSONObject | 流水列表 |
| records[].changeNo | String | 流水号 |
| records[].userId | String | 会员编号，用户唯一标识 |
| records[].changeType | Integer | 变动类型：1 扣减；2 返还；3 赠送；4 过期；5 充值，支持逗号分割 |
| records[].changeTypeName | String | 类型对应描述 |
| records[].changePointsNum | BigDecimal | 变动数 |
| records[].balancePointsNum | BigDecimal | 变动后 A 豆余额 |
| records[].bizNo | String | 关联业务单号（创作单号、订购单号等） |
| records[].changeReason | String | 变动原因 |
| records[].source | String | 来源渠道：1 B 端；2 C 端；3 H 端；4 业务管理平台 |
| records[].operateUser | String | 操作人 |
| records[].remark | String | 备注 |
| records[].createTime | Date | `yyyy-MM-dd HH:mm:ss` |

> **本项目映射说明**：`apps/api/src/services/biz-mgmt-a-bean.ts` 的 `mapTobyPointsChangeRecord` 把 `changeType 1-5` 映射为中性枚举 `deduct/refund/gift/expire/recharge`，`amount` 按 sign 取正负（扣减/过期为负）；未知 changeType 兜底为 `unknown` + 保守取正。`records` 经 `normalizeTobyRecords` 归一化（数组/对象双形态）。

---

## 3. A 豆扣减接口

### 3.1 接口定义

- **接口名称**：A 豆扣减
- **接口描述**：A 豆的所有扣减情况，同步给到业务管理平台
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/change`

### 3.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_POINTS_CHANGE` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| source | Integer | 1 B 端；2 C 端；3 H 端；4 业务管理平台 | 是 |
| workNo | String | 创作单号 | 是 |
| pointsNum | BigDecimal | 扣减数 | 是 |
| remark | String | 备注 | 否 |

### 3.3 响应参数

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 请求号 |
| workNo | String | 创作单号 |
| status | String | `DEDUCTED` 已扣减 |
| balancePointsNum | BigDecimal | 变动后余额 |
| idempotent | Boolean | 是否幂等返回，true 表示本次直接返回历史处理结果 |

---

## 4. 创作结果同步接口

### 4.1 接口定义

- **接口名称**：创作结果同步
- **接口描述**：会员在应用页面进行创作的结果，从 AI 中台收到结果后同步给到业务管理平台
- **承载协议**：HTTP
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/result-notify`

### 4.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_CREATION_RESULT_NOTIFY` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| workNo | String | 创作单号 | 是 |
| success | Boolean | 创作结果：true 成功；false 失败 | 是 |
| remark | String | 备注 | 否 |

### 4.3 响应参数

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| workNo | String | 创作单号 |
| status | String | `DEDUCTED` 已扣减；`SUCCESS` 已成功；`REFUNDED` 已返还 |
| balancePointsNum | BigDecimal | 变动后余额 |
| idempotent | Boolean | 是否幂等返回 |

---

## 5. 订购同步接口

### 5.1 接口定义

- **接口名称**：订购同步接口
- **接口描述**：用户在应用端完成订购/领取权益后，同步订购关系至业管
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/subscribe/external/dealExSubscribe`

### 5.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 接口编码 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| exOrderNo | String | 唯一幂等订单号 | 是 |
| phone | String | 手机号码 | 是 |
| channel | Integer | 用户注册渠道：1 B 端；2 C 端；3 H 端 | 是 |
| source | String | 订购来源渠道（4 位大写字符，例如 权益中心 `QYZX`、本地权益 `BDQY`） | 是 |
| goodsId | String | 商品 id | 是 |
| orderType | Integer | 订单类型：1 订购；2 续订；3 退订 | 是 |
| payAmount | BigDecimal | 实付金额（2 位小数） | 是 |
| status | Integer | 状态：1 已完成；2 处理中；3 已退订；4 已取消 | 是 |
| orderTime | String | 下单时间 | 否 |

### 5.3 响应参数

外层 code：`0000` 处理成功；`9999` 系统异常；`1000` 参数异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| exOrderNo | String | 唯一订单号 |
| orderNo | String | toby 订单号 |

---

## 6. 会员副卡变动同步接口

### 6.1 接口定义

- **接口名称**：会员副卡变动同步
- **接口描述**：创建会员副卡并初始化 A 豆；副卡按公司会员创建，需关联归属用户
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/sub-card`

### 6.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1002` | 是 |
| phone | String | 手机号（成员） | 是 |
| userName | String | 会员名称（成员） | 是 |
| compName | String | 公司名称 | 是 |
| channel | String | 用户渠道：1 B 端；2 C 端；3 H 端 | 是 |
| belongId | String | 所属管理员的会员编号（必须为已存在可用会员） | 是 |
| initialPointsNum | BigDecimal | 初始 A 豆；不能小于 0 | 是 |

### 6.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/业务规则异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| userId | String | 管理员名下新建成员的会员编号 |

---

## 7. 模型规格同步接口

### 7.1 接口定义

- **接口名称**：模型规格参数同步接口
- **接口描述**：业务管理平台对模块（包括规格、A 豆价值）进行新增/编辑时，同步模型相关参数数据给应用层系统
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/specification-config`

### 7.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `SPECIFICATION-CONFIG` | 是 |
| modelParams.modelCode | String | 模型编码 | 是 |
| modelParams.modelType | String | 模型类型（1 图片；2 视频；3 文本） | 是 |
| modelParams.modelName | String | 模型名称 | 是 |
| modelParams.modelDesc | String | 模型描述 | 是 |
| modelParams.modelProvider | String | 模型供应商 | 是 |
| modelParams.useChannel | String | 使用渠道（如 B 端创作平台 `B`、C 端小程序 `C`、H 端中屏 `H`） | 是 |
| modelParams.singleUnit | String | 计量单位（图片 `fix`/每张，视频 `second`/每秒，文本默认 `1`） | 是 |
| modelParams.materialRatio | String | 素材比例（3:4、16:9、自适应，多个则拼接） | 是 |
| modelParams.params | Array | 规格数组 | 是 |
| modelParams.params[].resolutionRatio | String | 规格（如 1k、2k、4k、1080p 等） | 是 |
| modelParams.params[].singleConsumeCount | Integer | A 豆单次消耗数量 | 是 |
| modelParams.params[].inputConsumeCount | Integer | A 豆输入消耗 | 否 |
| modelParams.params[].ouputConsumeCount | Integer | A 豆输出消耗 | 否 |

### 7.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| status | String | 0 成功；1 失败 |

---

## 8. 个人会员注册接口

### 8.1 接口定义

- **接口名称**：个人会员注册接口
- **接口描述**：仅面向个人会员（userType=1）进行 TobyAI 会员注册，已存在则返回错误；注册成功后返回会员唯一编号。（同手机号仅能注册一个有效个人类型的会员，逻辑删除后可再次注册）
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/register`

### 8.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1003` | 是 |
| phone | String | 登录手机号 | 是 |
| userName | String | 会员名称（姓名/昵称） | 是 |
| channel | String | 注册渠道：1 B 端；2 C 端；3 H 端 | 是 |

### 8.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| userId | String | 会员编号 |

---

## 9. 会员 A 豆余额查询接口

### 9.1 接口定义

- **接口名称**：会员 A 豆余额查询接口
- **接口描述**：根据会员编号查询当前账户下的 A 豆余额、累计获得 A 豆
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/query-points`

### 9.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1004` | 是 |
| userId | String | 会员编号 | 是 |

### 9.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| pointsNum | BigDecimal | A 豆余额；为空时按 0 返回 |
| sumPointsNum | BigDecimal | 累计获得 A 豆；为空时按 0 返回 |
| status | Integer | 当前状态：1 正常；2 冻结；3 删除 |
````

- [ ] **Step 2: 提交**

```bash
git add docs/open-api/Toby业务管理平台-接口文档.md
git commit -m "docs(api): Toby 业务管理平台接口文档 PDF→Markdown（9 接口 + 通用约定，修正渲染瑕疵）"
```

---

## Task 10: 全量回归与收尾

**Files:** 无（验证关卡）

- [ ] **Step 1: 后端全量测试**

```bash
cd apps/api && npx tsx --test src/__tests__/biz-mgmt-a-bean.test.ts
```

Expected: PASS，14 个测试全绿。

- [ ] **Step 2: 后端类型检查**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: 前端类型检查**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无类型错误（确认新组件、page.tsx 改动、ledger-card 删除均无断裂）。

- [ ] **Step 4: 确认文档 md 抽检**

人工抽检 `docs/open-api/Toby业务管理平台-接口文档.md`：
- 9 个接口章节齐全
- `changeType` 1-5 枚举完整（第 2 章）
- `source` 1-4 渠道完整
- `status` 枚举完整（扣减/创作结果/订购/会员余额）
- 无 `TToobbyy`/`JOSN`/`Bigdecim` 等重叠字符残留

- [ ] **Step 5: 按 AGENTS.md「本地验证边界」收尾**

前端不做浏览器刷新/构建/重启 6006 验证。后端测试 + 类型检查通过即视为完成。

---

## 完成定义（Definition of Done）

- [ ] 后端 `mapTobyPointsChangeRecord` / `normalizeTobyRecords` / `buildBizMgmtLedgerResult` 纯函数 + 14 个单测全绿
- [ ] `queryCurrentBizMgmtLedger` 从透传改为映射，返回 `BizMgmtLedgerResult`
- [ ] 路由注释更新
- [ ] 后端 `tsc --noEmit` 通过
- [ ] 前端新建 `biz-mgmt-ledger-card.tsx`（tab 筛选 + 分页）
- [ ] `credits/page.tsx` 接入 SWR 流水、移除"去业管看流水"文案
- [ ] 旧 `ledger-card.tsx` 删除
- [ ] 前端 `tsc --noEmit` 通过
- [ ] `docs/open-api/Toby业务管理平台-接口文档.md` 生成且字段完整
