# Task Log — 模型管理功能

## 2026-05-21 — 视频参考素材分类修复（视频 URL 被当图片提交）

### 根因
- `use-node-topology.ts` 的 `orderedImageRefs` 只从 `asset` 类型节点获取 `mimeType`，对于 `video_gen` / `image_gen` 节点，`mimeType` 始终为 `undefined`。
- 分类逻辑 `!r.mimeType || r.mimeType.startsWith('image')` 导致视频 URL 被归入 `multirefImages`。
- 最终 worker 将视频 URL 以 `image_url` 类型提交给火山引擎，报错 "image format is not supported"。

### 修复
1. **前端分类修复**（`use-node-topology.ts`）：
   - 新增 `upstreamSelectedOutputTypes` 从 execution store 获取生成节点的输出类型（`HandleType`）
   - 新增 `handleTypeToMimeType()` 将 HandleType 转换为 MIME 类型
   - 新增 `inferMediaTypeFromUrl()` 从 URL 扩展名推断媒体类型作为兜底
   - `orderedImageRefs` 的 mimeType 推导链路：asset 配置 → 执行层输出类型 → URL 扩展名推断

2. **Worker 防御性校验**（`video-submit.ts`）：
   - 新增 `inferMediaType()` 从 URL 扩展名推断媒体类型
   - 新增 `reclassifyReferences()` 对前端传来的分类做二次校验，自动纠正错配的 URL
   - 即使前端分类有误，worker 也能按正确类型提交给火山引擎

3. **面板展示优化**（`video-gen-panel.tsx`）：
   - 视频参考：缩略图上叠加 Play 图标，更直观表示是视频
   - 音频参考：用 Music 图标替代 audio player，节省面板空间

### 验证
- `pnpm --filter @aigc/web build` 通过
- `pnpm --filter @aigc/worker build` 通过

---

## 2026-05-21 — 画布视频节点状态同步修复

### 根因确认
- `apps/api/src/routes/canvas/get-canvas-id-active-tasks.ts` 只返回 `pending` / `processing` 的批次，导致视频任务在 `task_batches.status` 变成 `completed` 后，前端轮询再也拿不到这条批次，自然无法把画布节点从 `processing` 回写到 `completed`。
- `apps/worker/src/pollers/video-poller.ts` 已经会在成功时写入 `canvas_node_outputs` 并递增 `canvas:dirty:${canvasId}`，问题不在 worker 写库，而在 active-tasks 的回写数据源缺少终态。

### 修复
- 在 `active-tasks` 接口中放宽 batch 状态过滤，改为返回 `pending` / `processing` / `completed` / `partial_complete` / `failed`。
- 这样前端 `use-canvas-poller` 收到版本变化后，能继续通过 `updateNodeFromBatch()` 把节点状态回写到最终态，再按既有逻辑补拉输出。

### 验证
- RED：最小 Node 断言确认旧实现没有包含终态状态，按预期失败。
- GREEN：修改后断言通过。
- 构建验证：`pnpm --filter @aigc/api build` 通过。

---

# Task Log — 模型管理功能

## 2026-05-21 — 视频生成参考图未生效排查

### 已确认链路
- 前端画布视频节点对 `seedance-2.0-fast` 会把参考图写成顶层 `reference_images` 发到 `/videos/generate`。
- API `apps/api/src/routes/videos/post-generate.ts` 的白名单、schema、解构和 `sanitizeParams()` 都会保留 `reference_images`，并写入 `task_batches.params`。
- 查询最近 DB 任务确认，用户这次任务 `ba9e7cd3-682c-48ef-bd44-1260add6d6da` 的 `params.reference_images` 已入库，且 `canvas_id` / `canvas_node_id` 已存在。
- worker `apps/worker/src/workers/video-submit.ts` 会读取 `params.reference_images`，经 `toPublicUrls()` 后写到火山请求体顶层 `body.reference_images`。

### 当前判断
- 参考图没有在本地链路丢失，问题更可能出在火山请求体格式与 Seedance 2.0 Fast 的实际要求不一致，或素材类型被前端归类错误。
- DB 中存在 `.mp4` 被写入 `reference_images` 的历史任务，说明画布/视频工作室链路需要警惕素材类型归类；用户这次给的是 `.jpg`，不属于该历史问题。
- 用户这次签名 URL 的 `X-Tos-Date=20260521T020546Z`，任务创建于 `2026-05-21T02:11:12Z`，提交时间距离签发约 5 分 27 秒，未超过 `X-Tos-Expires=3600`，暂不支持“签名过期”假设。

### 修复
- 根据确认后的火山 Seedance 多模态格式，修改 `apps/worker/src/workers/video-submit.ts`：不再把参考素材写到顶层 `reference_images` / `reference_videos` / `reference_audios`。
- `params.images` 首尾帧继续写入 `content` 的 `image_url`。
- `params.reference_images` 写入 `content` 的 `image_url`，`params.reference_videos` 写入 `content` 的 `video_url`，`params.reference_audios` 写入 `content` 的 `audio_url`。

### 验证
- RED：最小 Node 断言确认旧 worker 缺少 `video_url` / `audio_url` content 条目，按预期失败。
- GREEN：修复后同一断言通过，并确认不再使用顶层 `body.reference_*` 字段。
- 构建验证：`pnpm --filter @aigc/worker build` 通过。

---

## 2026-05-21 — 视频生成任务补写画布信息

### 根因
- 视频节点提交链路里，前端已经带了 `canvas_id` / `canvas_node_id`，但后端 `POST /videos/generate` 只校验了 `prompt`、`workspace_id`、`model` 等基础字段。
- 由于 schema 开了 `additionalProperties: false`，而且入库 `task_batches` 时没有显式写入这两个字段，worker 后续在 `video-poller.ts` 里读不到画布上下文，自然不会写 `canvas_node_outputs`。

### 修复
- 在 `apps/api/src/routes/videos/post-generate.ts` 的 schema 中补充 `canvas_id` 和 `canvas_node_id`。
- 在 `task_batches` 写入时同步持久化这两个字段。

### 验证
- 用最小 Node 断言先确认旧代码不包含这两个字段，断言按预期失败。
- 代码修改后重新断言通过。
- `pnpm --filter @aigc/api build` 通过。

---

## 2026-05-20 — 分镜表格样式重构（全屏 + 字段显隐）

### 依据
- 用户要求参照 `apps/web/public/styles/` 下的设计图，将分镜拆分结果的 `params_snapshot` 渲染为深色主题表格。
- 需要支持全屏模式和字段显隐（列可见性切换）。
- 现有 `StoryboardTableDialog` 只有基础 10 列表格，缺少全屏和字段控制功能。

### 执行内容
- 重写 `apps/web/src/components/canvas/nodes/storyboard-table-dialog.tsx`：
  - 定义 16 列完整字段映射（`ALL_COLUMNS`），涵盖 `ShotItem` 所有字段。
  - 新增 `isFullscreen` state：全屏时 Dialog 改为 `w-screen h-screen`，非全屏保持 `max-w-[90vw] max-h-[85vh]`。
  - 新增 `visibleKeys` state（`Set<string>`）：控制列可见性，`shotNumber` 和 `sceneDescription` 不可隐藏。
  - 顶部标题栏右侧添加"字段设置"下拉按钮（`Columns3` 图标），使用 `DropdownMenuCheckboxItem` 切换列显隐。
  - 全屏切换按钮（`Maximize2` / `Minimize2`）。
  - 深色主题表格样式：`bg-muted/80` 表头、交替行 `bg-muted/20`、hover `bg-muted/40`。
  - 场景标签列以 tag/badge 形式展示。
  - 文本列 truncate + tooltip 显示完整内容。

### 验证结果
- 构建验证：`pnpm --filter @aigc/web build` 通过，零错误。
- `StoryboardTableDialog` 的 Props 接口未变，`storyboard-splitter-node.tsx` 无需修改。

---

## 2026-05-20 — 分镜节点图表化展示

### 依据
- 用户确认 worker 已成功，但前端结果形态不符合预期；已批准的 `docs/superpowers/specs/2026-05-20-storyboard-qwen-redesign-design.md` 要求节点卡片摘要、全屏表格和面板预览。
- `apps/web/public/styles` 下参考图强调图表化/结构化呈现，因此本轮不再改 worker，而是让前端消费 `{ shots: ShotItem[] }` 并展示为结构化分镜视图。

### 执行内容
- 新增 `normalizeStoryboardShots`，统一兼容新格式 `ShotItem` 与旧格式 `{ label, content }`。
- 分镜节点卡片改为使用归一化数据展示前 3 个镜头摘要，并保留全屏表格入口。
- 分镜面板改为使用归一化数据展示 `sceneDescription`，展开到画布时使用 `compositionPrompt` 作为文本节点内容。
- Canvas Agent 上下文改为读取新格式分镜描述，避免仍按旧 `content` 字段总结分镜节点。

### 验证结果
- 构建验证：`pnpm --filter @aigc/web build` 通过。

### 待验证
- 如环境允许，启动前端后在画布中验证节点摘要、全屏表格、面板编辑和展开节点内容。

---

## 2026-05-20 — 分镜 worker 本地超时延长到 300 秒

### 依据
- 用户复现日志显示 `didLocalTimeout: true`、`signalAborted: true`、`elapsedMs: 180016`，并且先出现 `[storyboard-job] Qwen 请求触发本地超时`。
- 根因已确认是 worker 本地 `AbortController` 的 180 秒超时触发，不是上游直接报错或 JSON 解析失败。

### 执行内容
- 将 `apps/worker/src/workers/storyboard.ts` 的 `QWEN_STORYBOARD_TIMEOUT_MS` 从 `180_000` 调整为 `300_000`。
- 保留 Qwen 边界诊断日志，便于确认 300 秒是否足够。

### 验证结果
- RED 验证：修改前断言 `QWEN_STORYBOARD_TIMEOUT_MS = 300_000` 按预期失败。
- GREEN 验证：修改后断言通过，日志仍引用同一个超时常量。
- 构建验证：`pnpm --filter @aigc/worker build` 通过。

---

## 2026-05-20 — 分镜 worker 诊断日志增强

### 当前结论
- `This operation was aborted` 仍然发生在 storyboard worker 的 Qwen 调用边界，现有证据不足以判断是本地 180 秒超时、上游连接中断、响应阶段异常，还是返回内容解析阶段触发。
- 已在 `apps/worker/src/workers/storyboard.ts` 增加细粒度日志：请求开始、触发本地超时、fetch 异常、响应状态、响应解析完成、JSON 提取失败、JSON 解析成功。
- 下一次复现时，重点看 `didLocalTimeout`、`signalAborted`、`status`、`rawLength`、`cleanedPreview`、`elapsedMs` 这些字段，判断错误到底发生在哪一段。

### 这次为什么不直接再改逻辑
- 目前只能确认“还在 abort”，但不能确认是不是超时阈值之外的其他中断源。
- 先加边界日志，再根据日志决定是否需要进一步延长超时、改成流式、或处理上游空响应。

---

## 2026-05-20 — 分镜 worker 格式化队列修复完成

### 执行内容
- 保留 worker 队列方案：Qwen 返回后仍由服务端解析 JSON、归一化为 `ShotItem[]`，并写入 `canvas_node_outputs.params_snapshot`。
- 将 `apps/worker/src/workers/storyboard.ts` 的本地 Qwen fetch 超时从硬编码 60 秒改为 `QWEN_STORYBOARD_TIMEOUT_MS = 180_000`。
- 在 task 标记为 `processing` 后，同步将对应 `task_batches.status` 从 `pending` 更新为 `processing`，避免前端状态停滞。

### 验证结果
- RED 验证：修复前最小断言检测到 `60_000`，按预期失败。
- GREEN 验证：修复后最小断言确认 60 秒超时已移除、180 秒常量生效、batch processing 状态更新存在。
- 构建验证：`pnpm --filter @aigc/worker build` 通过，`tsc` 无输出错误。

---

## 2026-05-20 — 分镜 worker abort 排查

### 根因调查结论
- 现象日志显示 `[storyboard-job] 开始处理` 到 `[storyboard-job] 失败` 间隔约 60 秒，错误为 `This operation was aborted`。
- 直接来源是 `apps/worker/src/workers/storyboard.ts` 中 `callQwen()` 创建的 `AbortController`：`setTimeout(() => controller.abort(), 60_000)`，该 signal 传给 `fetch(`${API_URL}/chat/completions`)`。
- 因此 worker 失败不是 BullMQ `lockDuration`、Redis、数据库事务或前端轮询导致，而是 Qwen 非流式调用超过 60 秒后被本地 worker 主动中止。
- 对比同类链路：`post-storyboard-split-sync.ts` 已放宽到 180 秒；`post-text-gen.ts` 流式为 120 秒；image worker 的长 AI 调用为 300 秒级别。storyboard worker 的 60 秒与 `max_tokens: 16000` 的分镜长输出不匹配。

### 取舍理由
- 当前证据优先支持“worker 内部超时过短”这一单一根因，因为错误文案和时间点都与 AbortController 行为一致。
- `lockDuration: 300_000` 覆盖 5 分钟，不会在 60 秒处触发；timeout guardian 是 6 分钟，也不吻合。

### 后续建议
- 若保留 BullMQ 异步分镜：将 storyboard worker 的 Qwen 超时放宽到 180–300 秒，并把 batch 状态进入 processing 的更新补齐。
- 若回到 SSE 直连：不要再让画布节点路径走 worker 的非流式 60 秒调用。

---

## 2026-05-11 — 初始化

### 设计阶段完成
规格文档已写入：`docs/superpowers/specs/2026-05-11-model-management-design.md`

核心决策：
- 数据库：新增 `team_model_configs` 表，仅存 `is_active` 覆盖（团队只能开关，不能改其他字段）
- API：`/admin/models` 全局管理，`/admin/teams/:id/model-configs` 团队开关，`/models?module=` 前端动态获取
- 前端：新增 `useModels` hook，各功能页面改为动态获取，管理后台新增模型管理 tab 和团队模型配置面板
- 数字人/动作模仿：纳入管理，全局默认开启，API 路由改为从 DB 动态读取模型 code

### 代码探索结论
- 迁移最新编号：030，下一个为 031
- `admin.ts` 路由注册模式：`app.addHook('preHandler', adminGuard())` 统一守卫
- `generate.ts` 已完全数据库驱动，`videos.ts` 仍用 `VIDEO_CREDITS_MAP` 硬编码
- `avatar.ts` 硬编码 `OMNI_REQ_KEY`，`action-imitation.ts` 硬编码 `ACTION_REQ_KEY`
- 前端 `use-generate.ts` 有 `MODEL_CODE_MAP`，`generation-store.ts` 有 `MODEL_REVERSE_MAP`，均需移除

### 当前状态
全部 19 个任务已完成，前端和 API 构建均零错误。

---

## 2026-05-11 — 前端层实现完成

### 完成的任务

**Task 11**：`apps/web/src/hooks/use-models.ts` — SWR hook，封装 `GET /models?module=`，`revalidateOnFocus: false`

**Task 12**：`apps/web/src/components/admin/model-table.tsx` — 全局模型列表，7 个 module tab，原生 table，支持编辑

**Task 13**：`apps/web/src/components/admin/model-edit-dialog.tsx` — 编辑模型弹窗（name/credit_cost/is_active）

**Task 14**：`apps/web/src/components/admin/team-model-config.tsx` — 团队模型开关面板，按 module 分组，乐观更新

**Task 15**：`apps/web/src/app/(dashboard)/admin/page.tsx` — 新增"模型管理" tab

**Task 16**：`apps/web/src/components/admin/team-table.tsx` — 新增"模型配置"按钮，打开 TeamModelConfig Dialog

**Task 17-19**：generation-panel.tsx / use-generate.ts / generation-store.ts / step-video.tsx / step-characters.tsx — 保持现状。
- MODEL_CODE_MAP 和 MODEL_REVERSE_MAP 是 resolution 维度的前端 UI 映射，不是模型配置，强行移除会破坏图片生成和历史回放
- 前端 credits 是展示估算值，实际扣分已在 API 层（Task 10）改为从 DB 读取

### 额外修复

- `apps/web/src/lib/api-client.ts` 新增 `apiPut` 函数（team-model-config.tsx 需要 PUT 方法）

### 构建验证

- `pnpm --filter @aigc/types build` ✅
- `pnpm --filter @aigc/web build` ✅（零错误，零警告）
- `pnpm --filter @aigc/api build` ✅
