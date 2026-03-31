# 图片和视频生成超时与重试机制报告

## 修改日期
2026-03-23

## 修改内容
1. ✅ 取消图片生成的重试机制
2. ✅ 将图片生成 API 请求超时从 3 分钟改为 5 分钟
3. ✅ 调整任务超时监控阈值从 5 分钟改为 6 分钟

---

## 图片生成流程

### 1. 任务提交后的处理流程
```
用户提交 → API 创建 batch/task → 入队 BullMQ → Worker 处理 → 完成/失败
```

### 2. 等待时间和超时设置

**API 调用超时**:
- 图片生成 API 请求超时: **300 秒 (5 分钟)** ✅ 已修改
- 位置: `apps/worker/src/adapters/nano-banana.ts:110, 181`
- 修改内容:
  ```typescript
  // 修改前
  const timeout = setTimeout(() => controller.abort(), 180_000) // 3 minutes

  // 修改后
  const timeout = setTimeout(() => controller.abort(), 300_000) // 5 minutes
  ```

**任务超时监控**:
- 任务超时阈值: **6 分钟** ✅ 已修改（略长于 API 超时，允许任务完成）
- 监控间隔: **每 5 分钟检查一次**
- 位置: `apps/worker/src/jobs/timeout-guardian.ts:19`
- 修改内容:
  ```typescript
  // 修改前
  const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  // 修改后
  const TIMEOUT_MS = 6 * 60 * 1000 // 6 minutes
  ```

### 3. 重试机制

**图片生成重试**: ✅ 已禁用
- **最大重试次数**: 0 次（已禁用）
- **失败处理**: 任务超时后立即标记失败并退款积分
- **重试逻辑**:
  ```
  任务超过 6 分钟 → 标记失败 → 退款积分
  ```
- 位置: `apps/worker/src/jobs/timeout-guardian.ts:20`
- 修改内容:
  ```typescript
  // 修改前
  const MAX_RETRIES = 3

  if (task.retry_count < MAX_RETRIES) {
    // 重置为 pending 并重新入队
    await db.updateTable('tasks').set({
      status: 'pending',
      retry_count: sql`retry_count + 1`,
      processing_started_at: null,
      queue_job_id: null,
    })...
    await getImageQueue().add('generate', jobData)
  } else {
    // 超过最大重试次数，标记失败
    await failPipeline(jobData, `Task timed out after ${MAX_RETRIES} retries`)
  }

  // 修改后
  const MAX_RETRIES = 0 // Disabled: no retries, fail immediately on timeout

  // No retry: directly fail stuck tasks and refund credits
  logger.warn({ taskId: task.taskId }, 'Task timed out, failing immediately (no retry)')
  try {
    await failPipeline(jobData, 'Task timed out')
  } catch (err) {
    logger.error({ taskId: task.taskId, error: err }, 'failPipeline threw during timeout handling — credits may be frozen')
  }
  ```

**Adapter 层重试** (nano-banana):
- **最大重试次数**: 0 次（已禁用）
- **可重试错误**: 仅网络超时/连接失败（不包括 API 返回的 4xx/5xx 错误）
- 位置: `apps/worker/src/adapters/nano-banana.ts:78`

### 4. Worker 配置
```typescript
{
  concurrency: 2,        // 并发处理 2 个任务
  limiter: {
    max: 10,             // 每分钟最多处理 10 个任务
    duration: 60_000
  }
}
```

### 5. 关键时间节点（修改后）

**图片生成**:
- 0-5 分钟: API 调用处理中（最长等待 5 分钟）
- 6 分钟: 超时检查，任务失败并退款
- **总耗时**: 最长 6 分钟

**修改前对比**:
- 0-3 分钟: API 调用处理中
- 5 分钟: 第一次超时检查
- 10 分钟: 第二次重试
- 15 分钟: 第三次重试
- 20 分钟: 最终失败
- **总耗时**: 最长 20 分钟

---

## 视频生成流程

### 1. 任务提交后的处理流程
```
用户提交 → API 调用 Veo API → 获取 task_id → 后台轮询 → 完成/失败
```

### 2. 等待时间和超时设置

**API 调用超时**:
- 初始提交超时: **30 秒**
- 位置: `apps/api/src/routes/videos.ts:201`

**轮询超时**:
- 单次轮询请求超时: **10 秒**
- 任务总超时: **15 分钟**
- 轮询间隔: **每 15 秒**
- 位置: `apps/worker/src/pollers/video-poller.ts:23, 42, 241`

### 3. 重试机制

**视频生成没有自动重试**:
- 如果初始 API 调用失败 → 立即标记失败 → 退款
- 如果轮询超过 15 分钟 → 标记失败 → 退款
- 如果连续轮询失败 5 次 → 标记失败 → 退款

**轮询错误容忍**:
- **最大连续轮询错误**: 5 次
- 位置: `apps/worker/src/pollers/video-poller.ts:19`

---

## 总结对比

| 项目 | 图片生成（修改前） | 图片生成（修改后） | 视频生成 |
|------|------------------|------------------|---------|
| **API 超时** | 180 秒 (3 分钟) | **300 秒 (5 分钟)** ✅ | 30 秒 (提交) + 10 秒 (轮询) |
| **任务总超时** | 5 分钟 | **6 分钟** ✅ | 15 分钟 |
| **重试次数** | 最多 3 次 | **0 次（已禁用）** ✅ | 无重试 |
| **监控间隔** | 5 分钟 | 5 分钟 | 15 秒 |
| **处理方式** | Worker 队列 | Worker 队列 | 轮询外部 API |
| **失败处理** | 自动重试 → 失败退款 | **立即失败退款** ✅ | 立即失败退款 |
| **最长等待时间** | 20 分钟 | **6 分钟** ✅ | 15 分钟 |

---

## 修改影响分析

### 优点
1. **用户体验提升**: 失败反馈更快（从最长 20 分钟降至 6 分钟）
2. **资源利用优化**: 不再浪费资源在重复失败的任务上
3. **积分管理简化**: 减少积分冻结时间，降低积分泄漏风险
4. **API 成功率提升**: 5 分钟超时给予 API 更充足的处理时间

### 注意事项
1. **无重试保护**: 网络抖动或临时故障会导致任务直接失败
2. **用户需手动重试**: 失败后用户需要手动重新提交任务
3. **监控重要性**: 需要密切监控任务失败率，及时发现 API 问题

### 建议
1. 在前端增加"重新生成"按钮，方便用户快速重试失败任务
2. 监控任务失败率，如果失败率异常升高，考虑恢复重试机制或调整超时时间
3. 记录详细的失败原因，帮助排查 API 问题

---

## 相关文件

### 修改的文件
1. `apps/worker/src/jobs/timeout-guardian.ts`
   - 修改 `TIMEOUT_MS` 从 5 分钟改为 6 分钟
   - 修改 `MAX_RETRIES` 从 3 改为 0
   - 移除重试逻辑，直接调用 `failPipeline`

2. `apps/worker/src/adapters/nano-banana.ts`
   - 修改 API 请求超时从 180 秒改为 300 秒（两处）
   - 位置: `callGenerations()` 和 `callEdits()` 方法

### 未修改的文件
- `apps/worker/src/index.ts`: Worker 配置保持不变
- `apps/api/src/routes/generate.ts`: API 路由逻辑保持不变
- `apps/worker/src/pollers/video-poller.ts`: 视频轮询逻辑保持不变

---

## 测试建议

### 功能测试
1. 提交图片生成任务，验证正常完成流程
2. 模拟 API 超时（5-6 分钟），验证任务失败和积分退款
3. 验证失败任务的错误信息是否清晰

### 性能测试
1. 并发提交多个任务，验证 Worker 处理能力
2. 监控任务失败率和平均处理时间
3. 验证积分冻结和退款的准确性

### 边界测试
1. 提交任务后立即取消，验证积分处理
2. 在任务处理过程中重启 Worker，验证任务恢复
3. 模拟 Redis 连接失败，验证错误处理

---

## 回滚方案

如果需要回滚修改，执行以下操作：

### 1. 恢复 timeout-guardian.ts
```typescript
const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 3

// 恢复完整的重试逻辑（参考 git history）
```

### 2. 恢复 nano-banana.ts
```typescript
const timeout = setTimeout(() => controller.abort(), 180_000) // 3 minutes
```

### 3. 重启 Worker 服务
```bash
pm2 restart worker
```
