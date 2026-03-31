# 图片和视频生成超时与重试机制报告（最终版）

## 修改日期
2026-03-24

## 修改内容总结
1. ✅ 图片生成 API 请求超时从 3 分钟改为 5 分钟
2. ✅ 任务超时监控阈值从 5 分钟改为 6 分钟
3. ✅ 取消任务级别的重试机制（Timeout Guardian 不再重试）
4. ✅ 实现 API 层面的智能重试：快速报错重试一次，超时不重试

---

## 当前超时和重试逻辑总结

### 图片生成

#### 1. API 调用层（nano-banana adapter）
**超时设置**:
- API 请求超时: **5 分钟 (300 秒)**
- 位置: `apps/worker/src/adapters/nano-banana.ts:110, 181`

**重试机制**:
- **最大重试次数**: 1 次
- **重试条件**: 仅快速网络错误（非超时）
- **重试延迟**: 2 秒
- **可重试的错误类型**:
  - ✅ `fetch failed` - 网络连接失败
  - ✅ `ECONNREFUSED` - 连接被拒绝
  - ✅ `ENOTFOUND` - DNS 解析失败
  - ✅ `ETIMEDOUT` - TCP 连接超时
  - ✅ `ECONNRESET` - 连接重置
- **不可重试的错误类型**:
  - ❌ `aborted` / `timeout` - 请求超时（5 分钟）
  - ❌ `API 4xx` / `API 5xx` - HTTP 错误响应

**代码实现**:
```typescript
// apps/worker/src/adapters/nano-banana.ts

const maxRetries = 1 // Retry once on fast API errors (not timeout)
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  const result = useEdits
    ? await this.callEdits(model, prompt, extraParams, imageUrls!)
    : await this.callGenerations(model, prompt, extraParams, imageUrls)

  if (!result.success && attempt < maxRetries && this.isRetryable(result.errorMessage)) {
    console.log(`[nano-banana] Retrying after fast API error (attempt ${attempt + 1}/${maxRetries}): ${result.errorMessage}`)
    await new Promise((r) => setTimeout(r, 2000)) // 2 second delay before retry
    continue
  }

  return result
}

private isRetryable(errorMessage?: string): boolean {
  if (!errorMessage) return false

  // Do NOT retry on timeout errors (AbortError)
  if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
    return false
  }

  // Retry on fast API errors (connection refused, network errors, DNS failures)
  // but NOT on HTTP error responses (4xx, 5xx) which indicate API-level issues
  const isHttpError = errorMessage.startsWith('API ')
  const isNetworkError = errorMessage.includes('fetch failed') ||
                        errorMessage.includes('ECONNREFUSED') ||
                        errorMessage.includes('ENOTFOUND') ||
                        errorMessage.includes('ETIMEDOUT') ||
                        errorMessage.includes('ECONNRESET')

  return !isHttpError && isNetworkError
}
```

#### 2. 任务监控层（Timeout Guardian）
**超时设置**:
- 任务超时阈值: **6 分钟**
- 监控间隔: **每 5 分钟检查一次**
- 位置: `apps/worker/src/jobs/timeout-guardian.ts:19`

**重试机制**:
- **最大重试次数**: 0 次（已禁用）
- **失败处理**: 任务超时后立即标记失败并退款积分

**代码实现**:
```typescript
// apps/worker/src/jobs/timeout-guardian.ts

const TIMEOUT_MS = 6 * 60 * 1000 // 6 minutes
const MAX_RETRIES = 0 // Disabled: no retries, fail immediately on timeout

// No retry: directly fail stuck tasks and refund credits
logger.warn({ taskId: task.taskId }, 'Task timed out, failing immediately (no retry)')
try {
  await failPipeline(jobData, 'Task timed out')
} catch (err) {
  logger.error({ taskId: task.taskId, error: err }, 'failPipeline threw during timeout handling — credits may be frozen')
}
```

#### 3. 时间线总结
```
0s          提交任务
↓
0-5min      API 调用处理中（最长 5 分钟）
↓           - 如果快速网络错误 → 2 秒后重试一次
↓           - 如果超时 → 不重试，直接失败
↓
5min        API 超时或返回结果
↓
6min        Timeout Guardian 检查
↓           - 如果任务仍在 pending/processing → 标记失败 → 退款
↓
完成/失败
```

---

### 视频生成

#### 1. API 调用层（Veo API）
**超时设置**:
- 初始提交超时: **30 秒**
- 位置: `apps/api/src/routes/videos.ts:201`

**重试机制**:
- **最大重试次数**: 1 次
- **重试条件**: 仅快速网络错误（非超时）
- **重试延迟**: 2 秒
- **可重试的错误类型**:
  - ✅ `fetch failed` - 网络连接失败
  - ✅ `ECONNREFUSED` - 连接被拒绝
  - ✅ `ENOTFOUND` - DNS 解析失败
  - ✅ `ETIMEDOUT` - TCP 连接超时
  - ✅ `ECONNRESET` - 连接重置
- **不可重试的错误类型**:
  - ❌ `aborted` / `timeout` - 请求超时（30 秒）
  - ❌ `Veo API 4xx` / `Veo API 5xx` - HTTP 错误响应

**代码实现**:
```typescript
// apps/api/src/routes/videos.ts

let externalTaskId: string
let lastError: string = ''
const maxRetries = 1 // Retry once on fast API errors (not timeout)

for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    let veoRes: Response
    try {
      veoRes = await fetch(`${veoApiUrl}/v2/videos/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${veoApiKey}` },
        body: JSON.stringify(veoBody),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!veoRes.ok) {
      const errText = await veoRes.text()
      throw new Error(`Veo API ${veoRes.status}: ${errText}`)
    }

    const veoJson = (await veoRes.json()) as { task_id: string }
    if (!veoJson.task_id) throw new Error('Veo API did not return task_id')
    externalTaskId = veoJson.task_id
    break // Success, exit retry loop
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    lastError = errMsg

    // Check if error is retryable (fast API error, not timeout)
    const isTimeout = errMsg.includes('aborted') || errMsg.includes('timeout')
    const isHttpError = errMsg.startsWith('Veo API ')
    const isNetworkError = errMsg.includes('fetch failed') ||
                          errMsg.includes('ECONNREFUSED') ||
                          errMsg.includes('ENOTFOUND') ||
                          errMsg.includes('ETIMEDOUT') ||
                          errMsg.includes('ECONNRESET')

    const shouldRetry = !isTimeout && !isHttpError && isNetworkError && attempt < maxRetries

    if (shouldRetry) {
      app.log.warn({ taskId, batchId, attempt: attempt + 1, err: errMsg }, 'Veo API call failed, retrying')
      await new Promise(r => setTimeout(r, 2000)) // 2 second delay before retry
      continue
    }

    // No retry or exhausted retries, fail the task
    app.log.error({ taskId, batchId, err: errMsg }, 'Veo API submission failed')
    break
  }
}

// If no externalTaskId, fail the task and refund credits
if (!externalTaskId!) {
  // ... refund logic
}
```

#### 2. 轮询层（Video Poller）
**超时设置**:
- 单次轮询请求超时: **10 秒**
- 任务总超时: **15 分钟**
- 轮询间隔: **每 15 秒**
- 位置: `apps/worker/src/pollers/video-poller.ts:23, 42, 241`

**重试机制**:
- **轮询错误容忍**: 最多连续失败 5 次
- **超时处理**: 超过 15 分钟直接失败并退款

#### 3. 时间线总结
```
0s          提交任务
↓
0-30s       调用 Veo API 提交任务
↓           - 如果快速网络错误 → 2 秒后重试一次
↓           - 如果超时 → 不重试，直接失败退款
↓
30s         获取 task_id，开始轮询
↓
0-15min     每 15 秒轮询一次状态
↓           - 连续失败 5 次 → 标记失败 → 退款
↓           - 超过 15 分钟 → 标记失败 → 退款
↓
完成/失败
```

---

## 对比表格

| 项目 | 图片生成 | 视频生成 |
|------|---------|---------|
| **API 超时** | 5 分钟 | 30 秒（提交）+ 10 秒（轮询） |
| **任务总超时** | 6 分钟 | 15 分钟 |
| **API 层重试** | 1 次（仅快速错误） | 1 次（仅快速错误） |
| **任务层重试** | 0 次 | 0 次 |
| **重试延迟** | 2 秒 | 2 秒 |
| **超时是否重试** | ❌ 否 | ❌ 否 |
| **网络错误是否重试** | ✅ 是 | ✅ 是 |
| **HTTP 错误是否重试** | ❌ 否 | ❌ 否 |
| **最长等待时间** | 6 分钟 | 15 分钟 |

---

## 可重试错误类型详解

### 快速网络错误（会重试）
这些错误通常在几秒内发生，表示网络层面的临时问题：

1. **fetch failed**: 网络请求完全失败
2. **ECONNREFUSED**: 目标服务器拒绝连接（服务未启动或端口未开放）
3. **ENOTFOUND**: DNS 解析失败（域名不存在或 DNS 服务器问题）
4. **ETIMEDOUT**: TCP 连接超时（网络不通或防火墙阻止）
5. **ECONNRESET**: 连接被重置（服务器主动断开连接）

### 不可重试错误类型

#### 1. 超时错误（不重试）
- **aborted**: 请求被 AbortController 中止
- **timeout**: 请求超时
- **原因**: 超时通常表示 API 处理时间过长，重试不会改善结果

#### 2. HTTP 错误响应（不重试）
- **API 4xx**: 客户端错误（如 400 Bad Request, 401 Unauthorized, 403 Forbidden）
- **API 5xx**: 服务器错误（如 500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable）
- **原因**: HTTP 错误响应表示 API 已经处理了请求并返回了明确的错误，重试不会改变结果

---

## 修改影响分析

### 优点
1. **快速恢复**: 网络抖动等临时问题可以自动恢复，无需用户手动重试
2. **避免浪费**: 超时不重试，避免在已经很慢的 API 上浪费更多时间
3. **用户体验**: 失败反馈更快（图片最长 6 分钟，视频最长 15 分钟）
4. **资源优化**: 不在无意义的重试上浪费服务器资源
5. **积分安全**: 减少积分冻结时间，降低积分泄漏风险

### 注意事项
1. **网络依赖**: 如果网络环境不稳定，可能需要用户手动重试
2. **监控重要**: 需要监控重试成功率，评估重试策略的有效性
3. **日志记录**: 重试时会记录日志，便于排查问题

---

## 测试建议

### 功能测试
1. **正常流程**: 提交任务，验证正常完成
2. **快速网络错误**: 模拟 ECONNREFUSED，验证自动重试
3. **超时错误**: 模拟 API 超时，验证不重试直接失败
4. **HTTP 错误**: 模拟 API 返回 500，验证不重试直接失败

### 性能测试
1. 监控重试成功率
2. 监控任务失败率
3. 监控平均处理时间

### 边界测试
1. 第一次请求失败，第二次成功
2. 两次请求都失败
3. 超时后不应该重试

---

## 相关文件

### 修改的文件
1. `apps/worker/src/adapters/nano-banana.ts`
   - 修改 API 请求超时从 180 秒改为 300 秒
   - 修改 `maxRetries` 从 0 改为 1
   - 修改 `isRetryable()` 方法，排除超时错误

2. `apps/api/src/routes/videos.ts`
   - 添加重试循环逻辑
   - 实现智能重试判断（快速错误重试，超时不重试）

3. `apps/worker/src/jobs/timeout-guardian.ts`
   - 修改 `TIMEOUT_MS` 从 5 分钟改为 6 分钟
   - 修改 `MAX_RETRIES` 从 3 改为 0
   - 移除任务级别的重试逻辑

---

## 回滚方案

如果需要回滚修改：

### 1. 恢复 nano-banana.ts
```typescript
const maxRetries = 0
const timeout = setTimeout(() => controller.abort(), 180_000) // 3 minutes

private isRetryable(errorMessage?: string): boolean {
  if (!errorMessage) return false
  return !errorMessage.startsWith('API ')
}
```

### 2. 恢复 videos.ts
```typescript
// 移除重试循环，恢复原始的单次调用逻辑
```

### 3. 恢复 timeout-guardian.ts
```typescript
const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 3
// 恢复完整的重试逻辑
```

### 4. 重启服务
```bash
pm2 restart worker
pm2 restart api
```
