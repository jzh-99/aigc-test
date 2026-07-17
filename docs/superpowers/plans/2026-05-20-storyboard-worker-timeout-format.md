# Storyboard Worker 格式化队列修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留分镜拆分的后端格式化输出，修复 worker 因 60 秒本地超时导致 Qwen 长输出被 abort 的问题。

**Architecture:** 画布节点继续提交 BullMQ storyboard 任务，由 worker 非流式调用 Qwen、解析 JSON、归一化为 `ShotItem[]`，再写入 `canvas_node_outputs.params_snapshot`。本次只做最小修复：抽出 worker 超时常量并放宽到 180 秒，同时在任务开始时把 `task_batches` 标记为 `processing`，保证状态流转与其他队列任务一致。

**Tech Stack:** TypeScript、Node.js fetch、BullMQ、Kysely、pnpm、tsc 构建验证。

---

## 文件结构

- Modify: `apps/worker/src/workers/storyboard.ts`
  - 负责 storyboard 队列消费、Qwen 调用、格式化 `ShotItem[]`、写入画布节点输出。
  - 新增明确常量 `QWEN_STORYBOARD_TIMEOUT_MS = 180_000`。
  - 任务进入处理后同步更新 `task_batches.status = processing`。

- Modify: `.claude/task-log.md`
  - 记录本轮设计、修复原因和验证结果。

- Modify: `.claude/task-plan.md`
  - 更新本轮子任务状态。

---

### Task 1: 建立失败验证

**Files:**
- Inspect: `apps/worker/src/workers/storyboard.ts`

- [ ] **Step 1: 确认当前失败条件**

检查当前代码中仍存在 60 秒超时：

```typescript
const timer = setTimeout(() => controller.abort(), 60_000)
```

- [ ] **Step 2: 运行最小文本验证，确认旧值存在**

Run:

```bash
python - <<'PY'
from pathlib import Path
p = Path('apps/worker/src/workers/storyboard.ts')
text = p.read_text(encoding='utf-8')
assert '60_000' not in text, '仍存在 60 秒 storyboard Qwen 超时'
PY
```

Expected: FAIL，输出包含 `仍存在 60 秒 storyboard Qwen 超时`。

---

### Task 2: 放宽 storyboard worker Qwen 超时

**Files:**
- Modify: `apps/worker/src/workers/storyboard.ts`

- [ ] **Step 1: 新增超时常量**

在环境变量常量附近加入：

```typescript
const QWEN_STORYBOARD_TIMEOUT_MS = 180_000
```

- [ ] **Step 2: 替换 60 秒魔法数字**

将：

```typescript
const timer = setTimeout(() => controller.abort(), 60_000)
```

替换为：

```typescript
const timer = setTimeout(() => controller.abort(), QWEN_STORYBOARD_TIMEOUT_MS)
```

- [ ] **Step 3: 运行最小验证，确认 60 秒超时已移除**

Run:

```bash
python - <<'PY'
from pathlib import Path
p = Path('apps/worker/src/workers/storyboard.ts')
text = p.read_text(encoding='utf-8')
assert '60_000' not in text, '仍存在 60 秒 storyboard Qwen 超时'
assert 'QWEN_STORYBOARD_TIMEOUT_MS = 180_000' in text, '缺少 180 秒 storyboard Qwen 超时常量'
assert 'setTimeout(() => controller.abort(), QWEN_STORYBOARD_TIMEOUT_MS)' in text, 'fetch abort 未使用 storyboard 超时常量'
PY
```

Expected: PASS。

---

### Task 3: 补齐 batch processing 状态

**Files:**
- Modify: `apps/worker/src/workers/storyboard.ts`

- [ ] **Step 1: 写入任务开始后的 batch 状态更新**

在 task 更新为 `processing` 后增加：

```typescript
await db
  .updateTable('task_batches')
  .set({ status: 'processing' })
  .where('id', '=', data.batchId)
  .where('status', '=', 'pending')
  .execute()
```

- [ ] **Step 2: 运行最小文本验证，确认状态更新存在**

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('apps/worker/src/workers/storyboard.ts').read_text(encoding='utf-8')
assert ".updateTable('task_batches')" in text, '缺少 task_batches 状态更新'
assert ".set({ status: 'processing' })" in text, '缺少 processing 状态设置'
assert ".where('status', '=', 'pending')" in text, '缺少 pending 幂等条件'
PY
```

Expected: PASS。

---

### Task 4: 构建验证

**Files:**
- Verify: `apps/worker/src/workers/storyboard.ts`

- [ ] **Step 1: 运行 worker TypeScript 构建**

Run:

```bash
pnpm --filter @aigc/worker build
```

Expected: PASS，`tsc` 无类型错误。

- [ ] **Step 2: 记录验证结果**

将修复结论与命令结果追加到 `.claude/task-log.md`，并把 `.claude/task-plan.md` 中本轮修复任务标记为完成。

---

## 自检

- Spec coverage: 覆盖“保留格式化数据输出”“修复 60 秒 abort”“补齐状态流转”。
- Placeholder scan: 无 TBD/TODO/占位实现。
- Type consistency: 只新增 number 常量和现有 Kysely 链式调用，未引入新外部类型。
