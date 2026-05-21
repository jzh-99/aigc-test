# Task Plan — 模型管理功能

## 2026-05-21 — 视频生成参考图未生效排查

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 排查任务
- [x] 确认前端 `/videos/generate` 请求会带 `reference_images`。
- [x] 确认 API `post-generate.ts` 会允许并持久化 `reference_images` 到 `task_batches.params`。
- [x] 查询最近 DB 任务，确认用户这次任务 `ba9e7cd3-682c-48ef-bd44-1260add6d6da` 已保存 `reference_images` 且包含画布信息。
- [x] 确认 worker `video-submit.ts` 会把 `params.reference_images` 放到火山请求体顶层 `body.reference_images`。
- [x] 待确认：火山 Seedance 2.0 Fast 是否要求参考图放在 `content[].image_url` 而不是顶层 `reference_images`，或是否需要区分 `reference_videos`。
- [x] RED：用最小断言确认 worker 缺少 `video_url` / `audio_url` content 条目且仍使用顶层 `reference_*` 字段。
- [x] GREEN：将 `reference_images` / `reference_videos` / `reference_audios` 分别写入 `content` 的 `image_url` / `video_url` / `audio_url`。
- [x] 验证：最小断言通过，`pnpm --filter @aigc/worker build` 通过。

---

## 2026-05-21 — 视频生成任务补写画布信息

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 修复任务
- [x] 定位视频生成链路中画布信息丢失位置。
- [x] RED：用最小断言确认 `videos/post-generate.ts` 旧代码缺少 `canvas_id` / `canvas_node_id`。
- [x] GREEN：在 `POST /videos/generate` 的 schema 和 `task_batches` 入库里补齐画布字段。
- [x] 验证：`pnpm --filter @aigc/api build` 通过。

---

## 2026-05-20 — 分镜节点图表化展示

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## UI 实现任务
- [x] 定位分镜节点、全屏表格、面板、canvas 类型和 agent 上下文相关文件。
- [x] 新增分镜数据归一化工具，兼容 `ShotItem` 与旧 `{ label, content }` 格式。
- [x] 分镜节点卡片使用归一化数据展示摘要，并保留全屏表格入口。
- [x] 分镜面板使用 `sceneDescription` 预览，展开节点内容使用 `compositionPrompt`。
- [x] Canvas Agent 上下文改为总结新格式分镜字段。
- [x] 构建验证：`pnpm --filter @aigc/web build` 通过。
- [ ] 浏览器复测：验证节点摘要、全屏表格、面板编辑和展开节点内容。

---

## 2026-05-20 — 分镜 worker 本地超时延长

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 修复任务
- [x] RED：确认当前还不是 300 秒超时。
- [x] GREEN：将 `QWEN_STORYBOARD_TIMEOUT_MS` 调整为 `300_000`。
- [x] 验证：确认日志仍引用超时常量。
- [x] 构建：`pnpm --filter @aigc/worker build` 通过。
- [ ] 复测：再次触发分镜拆分，观察 300 秒内是否出现 `Qwen 响应状态` 或 `Qwen 分镜 JSON 解析成功`。

---

## 2026-05-20 — 分镜 worker 诊断日志增强

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 诊断任务
- [x] RED：确认 storyboard worker 缺少 Qwen 边界诊断日志。
- [x] GREEN：新增请求开始、本地超时、fetch 异常、响应状态、响应解析、JSON 提取与解析日志。
- [x] 验证：`pnpm --filter @aigc/worker build` 通过。
- [ ] 下一次复现后，根据 `didLocalTimeout` / `elapsedMs` / `status` / `rawLength` 判断真实中断阶段。

---

## 2026-05-20 — 分镜 worker 格式化队列修复

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 修复任务
- [x] RED：确认 `storyboard.ts` 中 60 秒 Qwen 超时会被最小断言捕获。
- [x] GREEN：新增 `QWEN_STORYBOARD_TIMEOUT_MS = 180_000` 并替换硬编码 `60_000`。
- [x] 状态流转：任务开始时将 `task_batches.status` 从 `pending` 更新为 `processing`。
- [x] 验证：`pnpm --filter @aigc/worker build` 通过。

---

## 2026-05-20 — 分镜 worker abort 排查

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 排查任务
- [x] 定位 `This operation was aborted` 来源：`apps/worker/src/workers/storyboard.ts` 的 60 秒 AbortController。
- [x] 对比同类任务超时配置：同步分镜 180 秒、文本流式 120 秒、图片生成 300 秒级，storyboard worker 60 秒偏短。
- [x] 排除 BullMQ lockDuration 与 timeout guardian：二者分别为 300 秒和 6 分钟，不符合 60 秒失败时间。
- [ ] 如需修复：按 TDD/最小验证流程调整 worker 超时与任务状态流转。

---

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

---

## 阶段一：数据库层
- [x] Task 1: 新增迁移 `031_team_model_configs.ts`
- [x] Task 2: 更新 `packages/db/src/schema.ts`（新增 TeamModelConfigsTable）
- [x] Task 3: 补充 seed 数据（数字人/动作模仿模型入库）

## 阶段二：共享类型
- [x] Task 4: 更新 `packages/types/src/api.ts`（新增 ModelItem、TeamModelConfig 类型）

## 阶段三：API 层
- [x] Task 5: `admin.ts` 新增全局模型管理端点（GET/PATCH /admin/models）
- [x] Task 6: `admin.ts` 新增团队模型配置端点（GET/PUT/DELETE /admin/teams/:id/model-configs）
- [x] Task 7: 新增 `apps/api/src/routes/models.ts`（GET /models?module= 前端动态获取）
- [x] Task 8: `avatar.ts` 改为从 DB 动态读取模型 code
- [x] Task 9: `action-imitation.ts` 改为从 DB 动态读取模型 code
- [x] Task 10: `videos.ts` 积分改为从 DB 读取 credit_cost

## 阶段四：前端层
- [x] Task 11: 新增 `apps/web/src/hooks/use-models.ts`
- [x] Task 12: 新增 `components/admin/model-table.tsx`
- [x] Task 13: 新增 `components/admin/model-edit-dialog.tsx`
- [x] Task 14: 新增 `components/admin/team-model-config.tsx`
- [x] Task 15: 更新 `app/(dashboard)/admin/page.tsx`（新增模型管理 tab）
- [x] Task 16: 更新 `components/admin/team-table.tsx`（新增模型配置入口）
- [x] Task 17: generation-panel.tsx — 保持现状（credits 是展示估算值，API 层已动态化）
- [x] Task 18: use-generate.ts + generation-store.ts — 保持现状（MODEL_CODE_MAP 是 resolution 维度映射，不是模型配置）
- [x] Task 19: video-studio 相关页面 — 保持现状

## 额外修复
- [x] `apps/web/src/lib/api-client.ts` 新增 `apiPut` 函数

## 全部完成 ✅
构建验证：@aigc/types ✅ | @aigc/web ✅ | @aigc/api ✅
