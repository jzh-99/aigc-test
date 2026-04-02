# 模型计费（积分）修改指南

在 AIGC 项目中，模型生成消耗的积分（Credits）逻辑分布在**前端展示层**和**后端/数据库扣费层**。
为了确保用户界面显示的“预估积分”与实际从账户中扣除的积分完全一致，每次修改模型单价时，**必须**同步更新以下四个环节。

## 1. 修改前端积分常量 (UI 预估基础)

前端有两个主要组件包含了积分的配置映射表，必须保持一致。

**文件路径：**
- `apps/web/src/components/generation/prompt-input.tsx`
- `apps/web/src/components/generation/generation-panel.tsx`

**修改方法：**
找到 `MODEL_CREDITS` 常量字典，修改对应模型的值：
```typescript
const MODEL_CREDITS: Record<'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0', number> = {
  gemini: 6,
  'nano-banana-pro': 12,
  'seedream-5.0-lite': 11,
  'seedream-4.5': 13,
  'seedream-4.0': 10,
}
```

> **最佳实践说明**：
> 过去 `generation-panel.tsx` 中的 `MODEL_OPTIONS` 数组曾经硬编码了 `credits: 5`，导致下拉菜单显示错误。现已重构为 `credits: MODEL_CREDITS['model-name']`。未来新增模型时，请务必继续保持这种**动态引用**方式，严禁在 UI 数组中写死数字。

---

## 2. 修改初始化种子数据 (新环境/重置部署)

为了保证新部署的环境或者执行 `pnpm seed` 时的初始数据正确，必须修改 seed 脚本。

**文件路径：**
- `packages/db/scripts/seed.ts` （包含 Gemini、Nano Banana 等）
- `packages/db/scripts/seed-volcengine.ts` （包含 Seedream、Seedance 等火山模型）

**⚠️ 关键注意点 (极易遗漏)：**
Kysely 数据库脚本使用了 `insertInto()...onConflict()` 语法实现幂等更新。你**必须同时修改两处**：
1. `values({...})` 块中的 `credit_cost` (针对首次运行)
2. `onConflict(...).doUpdateSet({...})` 块中的 `credit_cost` (针对已有数据的更新)

**修改示例：**
```typescript
await db.insertInto('provider_models').values({
  code: 'nano-banana-2-2k',
  credit_cost: 12, // <--- 第一处：首次插入
  // ...
}).onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
  credit_cost: 12, // <--- 第二处：冲突更新（极其重要！）
  // ...
}))
```
*(注：某些脚本中做了一层 map 循环映射 `m.credit_cost`，此时只需修改顶部定义的数组即可。)*

---

## 3. 修改生产/本地已有数据库的实际数据

如果系统已经部署并运行，仅仅修改 seed 脚本并不会自动变更数据库里的现有记录（除非你重新执行了 `pnpm seed`，但直接操作 DB 更为稳妥和直接）。
后台实际扣费（在生成任务创建时）是读取 `provider_models.credit_cost` 字段的。

**操作方法：**
登录到对应的 PostgreSQL 数据库，执行 `UPDATE` 语句：

```sql
-- 示例：更新单个模型
UPDATE provider_models SET credit_cost = 11 WHERE code = 'seedream-5.0-lite';
UPDATE provider_models SET credit_cost = 13 WHERE code = 'seedream-4.5';
UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-4.0';
UPDATE provider_models SET credit_cost = 12 WHERE code LIKE 'nano-banana%';
UPDATE provider_models SET credit_cost = 6 WHERE code LIKE 'gemini%';

-- 查询验证
SELECT code, credit_cost FROM provider_models ORDER BY code;
```

---

## 总结 CheckList
每次修改积分单价，请对照此清单检查：
- [ ] 前端 `prompt-input.tsx` 已更新
- [ ] 前端 `generation-panel.tsx` 已更新（确保无硬编码数字）
- [ ] 数据库 `seed.ts` (及分块 seed 脚本) 已更新 (`values` 和 `doUpdateSet` 均已改)
- [ ] 已在现有运行数据库中执行了 `UPDATE provider_models ...`
- [ ] 前端执行了重新构建 (`pnpm build` 或 `deploy-local.sh`) 
