# 短剧文本生成 SSE 与分批大纲改造设计

## 背景

当前短剧「生成摘要」和「生成大纲」接口采用普通阻塞式 POST：后端等待豆包完整返回后再解析、扣费、保存状态并一次性返回 JSON。大纲生成内容较长，尤其是 20-50 集时，Next.js rewrite 代理链路容易出现 `socket hang up / ECONNRESET`，用户等待期间也没有进度反馈。

本设计将短剧文本生成改为 `stream + SSE`，并将大纲按最多 10 集分批生成，同时把单次文本生成超时提高到 240 秒。

## 目标

- 摘要生成使用 SSE 流式返回，避免长时间无响应。
- 大纲生成使用 SSE 流式返回，并按最多 10 集一批生成。
- 单次模型请求超时从 120 秒提高到 240 秒。
- 大纲批次之间进行账户余额预检查：余额不足时停止后续批次，保留已完成批次结果。
- 余额不足或部分完成时给出明显提醒文案，用户能理解已保存哪些内容、后续该怎么做。
- 保留现有状态写回逻辑：最终摘要写入 `state.script.refinedPrompt`，分集大纲写入 `state.script.outlines` 并初始化 `state.episodes.items`。

## 非目标

- 不做复杂的逐 token JSON 增量解析。
- 不做后台队列化文本生成。
- 不做自动充值或支付链路。
- 不改变图片、视频、导出任务的队列逻辑。
- 不改变短剧项目数据表结构。

## 推荐方案

采用方案 C：`SSE + 大纲每 10 集分批 + 240 秒超时`。

### 后端 SSE 协议

摘要和大纲接口均返回 `text/event-stream`。

连接建立后立即返回：

```text
: connected

```

模型生成期间返回：

```text
event: chunk
data: {"text":"..."}

```

大纲分批时返回进度：

```text
event: progress
data: {"message":"开始生成第 1-10 集大纲","from":1,"to":10}

```

余额不足或部分完成时返回 warning：

```text
event: warning
data: {"message":"A豆余额不足，已停止生成后续大纲。已保存第 1-10 集，请充值后继续生成剩余集数。","completedCount":10,"totalCount":30}

```

成功完成时返回：

```text
event: done
data: {"success":true,"state":{...}}

```

失败时返回：

```text
event: error
data: {"code":"AI_ERROR","message":"AI 生成失败，请稍后重试"}

```

API 使用 `reply.hijack()`，并设置：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

### 豆包流式调用

新增 `callDoubaoForTextStream`，与当前 `callDoubaoForText` 并存。新函数：

- 请求体使用 `stream: true`。
- 超时使用 `240_000`。
- 从 OpenAI 兼容 SSE 行中读取 `choices[0].delta.content`。
- 拼接完整文本返回给业务层解析。
- 每个有效 chunk 通过回调发给业务层。
- 如果一段时间没有有效内容，可由业务层发送 ping 保持连接。

现有非流式函数可同步把超时提高到 240 秒，避免其他短剧文本接口仍保留 120 秒。

### 摘要生成流程

1. 校验项目权限和原始创意。
2. 如果已有摘要，返回业务错误。
3. 预冻结摘要生成预估积分。
4. 建立 SSE 连接。
5. 调用 `callDoubaoForTextStream`，向前端转发 `chunk`。
6. 完整文本返回后解析 JSON：`title`、`summary`。
7. 写入 `state.script.refinedPrompt` 和 `state.script.status`。
8. 原子化保存状态并结算积分。
9. 发送 `done`，包含最新 `state`。

### 大纲分批生成流程

1. 校验项目权限、摘要是否存在、现有大纲数量。
2. 计算缺失集数范围：从 `state.script.outlines.length + 1` 到 `episodeCount`。
3. 每批最多 10 集，例如：`1-10`、`11-20`、`21-30`。
4. 每一批开始前进行 A 豆余额预检查或冻结：
   - 每批按固定预估积分冻结，例如 20 积分。
   - 冻结成功才调用模型。
   - 冻结失败时停止后续批次。
5. 每批流式调用豆包，只要求返回当前批次的 JSON 数组。
6. 当前批次生成成功后立即解析、合并到 `state.script.outlines`，并保存当前项目状态。
7. 当前批次结算积分。
8. 如果所有批次完成，发送 `done`，提示大纲生成完成。
9. 如果中途余额不足：
   - 保留已完成并已保存的批次。
   - 不回滚已生成内容。
   - 发送 `warning` 和 `done`，`done.partial = true`。
   - 前端提示用户充值后继续生成剩余大纲。

### 部分完成状态

部分完成时项目状态满足：

- `state.script.outlines` 包含已完成批次。
- `state.script.status` 保持 `generating` 或 `idle`，不标记为 `completed`。
- `state.episodes.items` 只初始化已生成的集。
- 前端「生成大纲」按钮文案可显示为「继续生成大纲」。
- 确认剧本按钮仍需校验大纲数量等于 `episodeCount`，所以部分完成时不能确认进入资产阶段。

全部完成时：

- `state.script.status = 'completed'`。
- `state.script.outlines.length === episodeCount`。
- `state.episodes.items.length === episodeCount`。

### 余额提示文案

余额不足时使用明确文案：

> A豆余额不足，已停止生成后续大纲。已保存已完成的分集大纲，请充值后点击「继续生成大纲」生成剩余集数。

如果只完成部分批次：

> 已生成并保存前 {completedCount} / {totalCount} 集，剩余 {remainingCount} 集待生成。

### 前端改造

`apps/web/src/lib/short-drama/api.ts` 新增通用 SSE 消费函数，参考绘本模块的 `consumeSSEStream`。

摘要和大纲 API 函数增加可选回调：

- `onChunk(text)`：展示实时生成文本。
- `onProgress(payload)`：展示当前批次。
- `onWarning(payload)`：展示余额不足或部分完成提醒。

`StepScriptOutline` 增加状态：

- `summaryStreamText`
- `outlineStreamText`
- `outlineProgressMessage`
- `streamWarningMessage`

UI 策略：

- 生成中展示实时文本区域。
- 大纲生成中展示当前批次进度。
- 收到 warning 时用醒目的提示区域和 toast 展示。
- 收到 done 后调用 `onStateChange()` 刷新项目状态。
- 如果 `done.partial === true`，toast 使用 warning，不显示“全部完成”。

### 测试与验证

至少覆盖：

- 流式调用能拼接完整文本。
- 摘要结果能写回状态。
- 大纲按 10 集分批生成批次范围正确。
- 大纲部分完成时保留已完成批次，不标记 completed。
- 余额不足时停止后续批次并返回 warning。
- API TypeScript build 通过。

## 风险与注意事项

- SSE 能降低代理空闲断开概率，但不能避免模型服务自身超时或断流。
- 分批生成会增加模型调用次数，50 集最多 5 次文本模型调用。
- 已完成批次会保存并结算，后续余额不足不会回滚。
- 前端不做中间 JSON 结构化展示，避免解析半截 JSON 引发错误。
- 如果未来要支持后台继续生成，应再引入队列任务和轮询/SSE 任务状态。