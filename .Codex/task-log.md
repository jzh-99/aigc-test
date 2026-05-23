# 任务日志：画布参数面板 @ 资源引用

## 2026-05-23 图片模型 image_categories 限制

- 需求目标：参照 `provider_models.video_categories`，为图片模型新增 `image_categories`，用于表达文生图/图生图的参考图片数量限制。
- 用户确认字段名使用 `image_categories`。
- 限制规则：
  - 文生图：图片最少 0 张，最多 0 张。
  - 图生图：图片最少 0 张，最多按模型族区分。
  - `gpt-image-2`、`nano-banana-2`、`gemini-3.1-flash-image-preview` 三个模型图生图最多 6 张。
  - `seedream-*` 相关图片模型图生图最多 14 张。
- 当前代码定位：
  - `packages/types/src/api.ts` 已有 `VideoCategories`、`parseVideoCategories`、`validateVideoReferenceLimits`，适合平行新增图片限制工具。
  - `packages/db/src/schema.ts` 的 `ProviderModelsTable` 仅有 `video_categories`，需要新增 `image_categories`。
  - `/api/v1/models` 当前只返回 `video_categories`，需要同步返回 `image_categories`。
  - `/api/v1/generate/image` 当前只对 `params.image` 做白名单、数组最多截断到 10 项，没有按模型校验，也会让 seedream 的 14 张上限被截断。
  - 前端生成页和画布图片节点目前只依赖固定 `MAX_REF_IMAGES = 10`。
- 方案取舍：
  - 采用与视频字段相似的 JSON 结构，但图片只限制 `image` 一类资源，避免引入无意义的 audio/video 限制。
  - 后端根据 `params.image` 数量自动选择 `text_to_image` 或 `image_to_image` 校验；未配置 `image_categories` 的历史模型按兼容默认最多 10 张处理，避免旧数据突然不可用。
  - seed 明确拆两个常量：`SIX_IMAGE_CATEGORIES` 和 `SEEDREAM_IMAGE_CATEGORIES`，模型对象直接声明使用哪个常量，避免通过字符串前缀隐式推断导致后续模型误配。
- TDD 计划：
  - 先在 `packages/types/src/api.test.ts` 增加图片类别解析/校验测试并确认 RED。
  - 再实现共享类型工具，随后接入 DB、seed、API 和前端。
- 实现结果：
  - `packages/types/src/api.ts` 新增 `ImageCategory`、`ImageCategories`、`parseImageCategories`、`validateImageReferenceLimits`。
  - 新增迁移 `packages/db/migrations/037_provider_models_image_categories.ts`，为 `provider_models` 增加 `image_categories jsonb`。
  - `packages/db/scripts/seed.ts` 增加 `SIX_IMAGE_CATEGORIES` 和 `SEEDREAM_IMAGE_CATEGORIES` 两个显式常量：
    - `gemini-3.1-flash-image-preview`、`gpt-image-2`、`nano-banana-2` 使用图生图 0-6 张。
    - `seedream-5.0-lite`、`seedream-4.5`、`seedream-4.0` 使用图生图 0-14 张。
  - `/api/v1/models`、`/api/v1/admin/models`、`/api/v1/admin/models/:id` 返回 `image_categories`。
  - `/api/v1/generate/image` 查询模型后按 `params.image` 原始数量校验；未配置旧模型按兼容默认图生图最多 10 张处理；错误码为 `INVALID_IMAGE_REFERENCES`。
  - 图片生成页按当前模型显示和限制可上传参考图数量；批量拖入时使用局部计数，避免一次拖入超过模型上限。
  - 画布图片节点提交前同样按当前模型校验上游参考图数量。
- 验证结果：
  - RED：`pnpm --filter @aigc/api exec tsx --test ..\..\packages\types\src\api.test.ts` 最初因 `parseImageCategories` 未导出失败，符合预期。
  - `pnpm --filter @aigc/api exec tsx --test ..\..\packages\types\src\api.test.ts` 通过，4 个测试全部通过。
  - `pnpm --filter @aigc/types build` 通过。
  - `pnpm --filter @aigc/db build` 通过。
  - `pnpm --filter @aigc/api build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `pnpm lint` 执行成功，但 turbo 报告没有实际 lint task。
  - `pnpm exec prettier --check ...` 失败：当前项目未安装 `prettier` 命令。

## 2026-05-23 图片生成默认图生图模式

- 用户补充：创作生成和画布图片节点都默认采用图生图模式，文生图暂时未启用；限制也应按图生图配置执行。
- 实现内容：
  - `packages/types/src/api.ts` 新增 `ACTIVE_IMAGE_CATEGORY = 'image_to_image'`，作为前后端统一的图片生成活动模式。
  - `/api/v1/generate/image` 不再按参考图数量推断文生图/图生图，统一用 `image_to_image` 校验 `image_categories`。
  - `apps/web/src/lib/image-categories.ts` 的前端提交校验同样固定使用 `image_to_image`。
  - 画布图片节点配置新增 `imageCategoryLimits`，在参数面板按当前模型同步缓存。
  - 画布连线层在连接图片参考到 `image_gen` 节点时读取 `imageCategoryLimits.image_to_image.limits.image.max`，超限时阻止连线。
- 验证结果：
  - `pnpm --filter @aigc/api exec tsx --test ..\..\packages\types\src\api.test.ts` 通过，5 个测试全部通过。
  - `pnpm --filter @aigc/types build` 通过。
  - `pnpm --filter @aigc/api build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `pnpm --filter @aigc/db build` 通过。

## 2026-05-23 画布图片节点模型切换限制

- 用户补充：画布中图片节点已连接参考图片时，如果其他图片模型的图生图参考图上限小于当前连接数量，则该模型不能切换，并在模型列表中置灰。
- 实现内容：
  - `image-gen-panel.tsx` 渲染模型按钮时读取每个模型的 `image_to_image.max`。
  - 当 `orderedImageRefs.length > max` 且目标模型不是当前模型时，按钮设置 `disabled`、置灰、显示 `最多N`，并通过 `title` 说明当前已连接数量与模型上限。
  - E2E fixture 增加一个 `single-reference-image` 模型，图生图最多 1 张参考图。
  - 新增 E2E：当前图片节点已有 2 张参考图时，`单参考图片` 模型按钮置灰禁用，点击后仍停留在原模型。
- 验证结果：
  - `pnpm --filter @aigc/web exec playwright test e2e/canvas/image-submit.spec.ts` 通过，3 个测试全部通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `pnpm --filter @aigc/types build` 通过。

## 2026-05-22 初步上下文梳理

- 需求目标：在画布图片、视频节点参数面板的提示词输入中支持 `@` 资源选择；用户从当前节点上游已连接的图片、视频、音频参考资源中选择后，可针对单个资源写约束；提交接口时将局部约束转换为结构化中文提示词，并与原有整体提示词逻辑合并。
- 已定位文件：
  - `apps/web/src/components/canvas/node-param-panel.tsx`：画布节点参数面板总控，负责 prompt 草稿、上游文本合并、图片/视频生成提交。
  - `apps/web/src/components/canvas/panels/image-gen-panel.tsx`：图片节点参数 UI。
  - `apps/web/src/components/canvas/panels/video-gen-panel.tsx`：视频节点参数 UI。
  - `apps/web/src/components/canvas/panels/use-node-topology.ts`：根据上游连线收集文本、图片、视频、音频引用。
  - `apps/web/src/lib/canvas/canvas-api.ts`：图片/视频生成请求封装。
  - `apps/web/e2e/canvas/video-submit.spec.ts`：现有视频节点提交 E2E，已覆盖 image/video/audio references。
- 初步判断：
  - 现有资源引用只保存 URL 和 MIME 类型，UI 显示也只展示数量或缩略图；要实现 `@` 选择框，需要扩展上游资源 item，至少包含稳定 id、类型、序号、URL、可展示标题。
  - 提示词转换建议在提交前完成，不改变后端 API 契约，不影响原有 `reference_images/reference_videos/reference_audios/images` 参数。
  - 为避免破坏现有 prompt 存储，节点 config 继续保存用户原始输入；提交时生成 `finalPrompt`。

## 2026-05-22 设计确认

- 用户确认采用可读标记方案：输入 `@` 后选择上游资源，textarea 插入 `@图片1 `、`@视频1 `、`@音频1 ` 这类标记。
- 当前参数面板 prompt 限制为 500 字以内，显示字数计数；提交前再次校验，超过限制则阻止请求。
- 资源级约束只在提交前转换，不改后端接口：
  - 图片：`图片参考：参考<图片N>中的<用户约束>`
  - 视频：`视频参考：参考<视频N>中的<用户约束>`
  - 音频：`音频参考：参考<音频N>中的<用户约束>`
- 原有整体提示词逻辑保留：上游文本节点内容 + 本节点 prompt 仍参与最终 prompt。
- 当前环境 `git` 命令不可用，无法按 skill 要求提交设计文档；实现和验证继续进行，最终会说明该限制。

## 2026-05-22 实现与验证

- 新增 `apps/web/src/components/canvas/panels/resource-mentions.ts`：
  - 定义资源 mention 类型。
  - 实现 500 字限制常量和 prompt 转换函数。
- 新增 `apps/web/src/components/canvas/panels/resource-mention-textarea.tsx`：
  - textarea 中输入 `@` 时展示资源选择框。
  - 选择资源后插入 `@图片1 `、`@视频1 `、`@音频1 `。
  - 显示 `当前字数/500` 并通过 `maxLength` 限制输入。
- 修改 `use-node-topology.ts`：
  - 上游参考资源按 MIME 类型分类，并生成 `图片N/视频N/音频N` 标签。
- 修改图片/视频参数面板：
  - 使用统一的资源 mention textarea。
- 修改 `node-param-panel.tsx`：
  - 图片、视频提交前把资源 mention 转换为结构化中文提示词。
  - 提交前再次检查本节点 prompt 是否超过 500 字。
- E2E：
  - 视频节点覆盖 `@` 弹层、资源插入、图片/视频/音频资源级 prompt 转换、reference 数组保持不变。
  - 图片节点覆盖 `@图片1` 插入、图片资源级 prompt 转换、`params.image` 保持不变。
- 验证结果：
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts canvas/image-submit.spec.ts` 通过，3 个测试全部通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。并行执行时曾因 `next build` 重建 `.next/types` 产生临时文件竞争，单独重跑后通过。
  - 项目未发现 Prettier/ESLint 配置，`@aigc/web` 未提供 lint/format 脚本，未执行格式化或 lint。

## 2026-05-22 Worker 火山视频提交报错排查

- 用户提供的请求中只有 `reference_images` 和 `reference_videos`，没有 `images` 首尾帧字段；API 层也会拦截 `images` 与 `reference_*` 混用，因此问题不在前端或 API 入队。
- Worker `apps/worker/src/workers/video-submit.ts` 中，多模态 `reference_videos` 和 `reference_audios` 会带 `role: reference_video/reference_audio`，但 `reference_images` 被拼成裸 `{ type: 'image_url', image_url: { url } }`。
- 火山错误为 `first/last frame content cannot be mixed with reference media content`，说明裸 `image_url` 被火山识别为首/尾帧类内容；再与 `role: reference_video` 混合后触发模式冲突。
- 根因：worker 在构造火山 content 时未给多模态参考图设置 `role: reference_image`，同时首尾帧图片也没有显式设置 `first_frame/last_frame`，模式语义不够明确。
- 修复：
  - 新增 `apps/worker/src/workers/video-submit-payload.ts`，把火山请求体构造抽成可测试纯函数。
  - 多模态参考图现在输出 `{ type: 'image_url', image_url: { url }, role: 'reference_image' }`。
  - 首尾帧图片现在显式输出 `role: 'first_frame' / 'last_frame'`。
  - `apps/worker/src/workers/video-submit.ts` 改为调用该纯函数，提交和失败退款流程不变。
- 验证结果：
  - `pnpm --filter @aigc/worker exec tsx --test src/workers/video-submit-payload.test.ts` 通过，2 个测试全部通过。
  - `pnpm --filter @aigc/worker build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。

## 2026-05-22 显式视频模式修复

- 用户澄清：不能通过参考资源数量推断“全能参考/首尾帧”模式，因为全能参考模式也允许不传任何资源。
- 现状确认：
  - 画布前端 `executeVideoNode` 有 `videoMode: multiref | keyframe`。
  - 创作生成前端 `video-panel.tsx` 有 `videoMode: multimodal | frames`。
  - `/api/v1/videos/generate` 原本没有接收显式模式字段，API 通过 `images` 和 `reference_*` 数量推断 `VideoCategory`。
- 修复：
  - 画布请求新增 `video_category: 'multimodal' | 'frames'`。
  - 创作生成请求新增 `video_category`。
  - API schema、body 类型、参数白名单新增 `video_category`。
  - API 优先使用显式 `video_category` 做模型限制校验；未传时保留旧推断逻辑兼容历史调用。
  - `video_category` 写入 batch params，并进入 worker。
  - E2E 增加断言：全能参考提交 `multimodal`，首尾帧提交 `frames`。
  - Worker payload 测试增加“全能参考模式允许不传任何参考资源”。
- 验证结果：
  - `pnpm --filter @aigc/worker exec tsx --test src/workers/video-submit-payload.test.ts` 通过，3 个测试全部通过。
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts` 通过，2 个测试全部通过。
  - `pnpm --filter @aigc/types build` 通过。
  - `pnpm --filter @aigc/api build` 通过。
  - `pnpm --filter @aigc/worker build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。

## 2026-05-22 视频 poller 容错与日志增强

- 用户日志显示 `Video task exceeded max poll errors, failing task count: 5`，这是状态查询连续失败，不是视频任务执行超时。实际任务超时仍是 `MAX_VIDEO_AGE_MS = 1 hour`。
- 修复：
  - 新增 `apps/worker/src/pollers/video-poller-result.ts`，抽出状态查询错误分类。
  - 新增 `apps/worker/src/pollers/video-poller-result.test.ts`，覆盖 401/403 鉴权失败、429/5xx 可重试、连续错误窗口。
  - 将视频 poller 连续错误阈值从 5 次提升到 20 次。按 15 秒轮询间隔计算，容忍窗口约 5 分钟。
  - `checkVolcengineTask` 和 `checkVeoTask` 在非 2xx 时读取响应 body，返回 `httpStatus`、`errorMessage`、`retryable`。
  - 401/403 归类为 `POLL_AUTH_ERROR`，直接失败并记录鉴权上下文，避免盲目重试。
  - 普通 `POLL_ERROR` 每次记录 taskId、batchId、provider、externalTaskId、count、max、httpStatus、retryable、errorMessage，方便定位火山状态接口具体报错。
- 验证结果：
  - `pnpm --filter @aigc/worker exec tsx --test src/pollers/video-poller-result.test.ts src/workers/video-submit-payload.test.ts` 通过，6 个测试全部通过。
  - `pnpm --filter @aigc/worker build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。

## 2026-05-22 @ 资源 token 富文本化

- 用户要求：`@某个视频` 后资源标记只能整体删除，不能单字删除；同时资源标记需要有不同颜色和字体。
- 设计与实现：
  - 将 `ResourceMentionTextarea` 从普通 textarea 改为 contenteditable 富文本输入框。
  - 外部 value 仍保持纯文本，例如 `@视频1 参考奔跑动作`，兼容现有 config 保存和提交前 prompt 转换。
  - 资源 mention 渲染为 `contenteditable=false` 的 token，用户无法编辑 token 内部字符。
  - 图片/视频/音频 token 分别使用蓝色/紫色/绿色样式，并加粗。
  - Backspace/Delete 遇到 token 时会整体删除该资源标记。
  - 为避免 React 与 contenteditable 子节点冲突，富文本编辑区子节点改为手动 DOM 渲染，React 只管理外层和状态。
  - `buildPromptWithResourceMentions` 支持同一行内多个资源 token，避免 contenteditable 合并换行时只解析第一个 `@`。
- 验证结果：
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts canvas/image-submit.spec.ts` 通过，4 个测试全部通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。

## 2026-05-22 火山视频 poller 响应解析修复

- 用户日志显示 `errorMessage: "data.content?.find is not a function"`，说明火山轮询接口返回成功响应后，本地解析代码假设 `content` 一定是数组，但实际可能是对象或嵌套在其他字段中。
- 修复：
  - `apps/worker/src/pollers/video-poller-result.ts` 新增 `parseVolcengineTaskResponse`。
  - 解析器兼容：
    - `content: [{ video_url: { url } }]`
    - `content: { video_url: { url } }`
    - `data.content: { video_url: string }`
    - 其他嵌套 `content/data/output` 中的视频 URL。
  - `apps/worker/src/pollers/video-poller.ts` 改为调用该解析器，不再直接 `data.content?.find(...)`。
  - 未知响应结构会返回不可重试的本地解析错误信息，不会再刷 20 次同样的 TypeError。
- 验证结果：
  - `pnpm --filter @aigc/worker exec tsx --test src/pollers/video-poller-result.test.ts` 通过，6 个测试全部通过。
  - `pnpm --filter @aigc/worker build` 通过。

## 2026-05-22 生视频参考视频计费修复

- 问题定位：
  - API `apps/api/src/routes/videos/post-generate.ts` 当前只用生成参数 `duration` 计算 `estimatedCredits`。
  - 创作生成前端 `video-panel.tsx` 已读取上传参考视频的 `duration`，但没有把时长提交给 API；`video-params.tsx` 估算展示也只按生成时长显示。
  - 画布视频节点从上游收集了参考视频 URL，但未收集可用时长；素材节点配置和生成输出快照中已有可复用的 `duration` 字段。
- 方案取舍：
  - 保持 AI 调用参数不变，只新增计费用参数 `reference_video_durations`，worker 可忽略。
  - 后端沿用原来的基础生成计费：`duration > 0` 时按秒计费，自动时长仍用模型 `credit_cost` 兜底；在此基础上追加参考视频总时长的秒单价费用。
  - 参考视频小数时长按“总和向上取整”计费，避免小数秒低估；非法、非正数时长忽略。
- TDD 状态：
  - 已先新增 `packages/types/src/api.test.ts`，验证“5 秒生成 + 2.2 秒和 3.1 秒参考视频，10 积分/秒，应扣 110 积分”。
  - RED 验证失败原因为目标函数尚未导出，符合预期。

## 2026-05-22 生视频参考视频计费实现与验证

- 实现内容：
  - `packages/types/src/api.ts` 新增 `calculateReferenceVideoDurationSeconds` 和 `calculateVideoEstimatedCredits`，参考视频时长按总和向上取整。
  - `/api/v1/videos/generate` 新增 `reference_video_durations` 入参白名单和 schema，冻结积分改为“生成部分费用 + 参考视频部分费用”。
  - 创作生成在上传参考视频后把 `multimodalVideos.duration` 透传给 API，并在右侧积分估算中累加参考视频总时长。
  - 画布拓扑收集上游视频素材时长：优先读素材节点 `duration`，其次读上游输出 `paramsSnapshot.duration` / `params.duration` / `segments`，并在视频节点提交中透传。
  - worker 视频 poller 在写入画布输出时补充 `params_snapshot`，让后续画布节点可读取生成视频的时长。
- 验证结果：
  - `pnpm --filter @aigc/api exec tsx --test ..\..\packages\types\src\api.test.ts` 通过，1 个测试通过。
  - `pnpm --filter @aigc/types build` 通过。
  - `pnpm --filter @aigc/api build` 通过。
  - `pnpm --filter @aigc/worker build` 通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `PLAYWRIGHT_BASE_URL=http://127.0.0.1:6007 pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts` 通过，2 个测试通过，并断言了 `reference_video_durations: [2.4]`。
- 未执行项：
  - `pnpm --filter @aigc/web exec prettier --check "src/**/*.{ts,tsx}"` 失败：当前项目未安装 `prettier` 命令。
  - `pnpm --filter @aigc/web lint` 失败：`@aigc/web` 未定义 `lint` 脚本。
  - 默认 6006 端口已有 Node 服务且复用后返回 Next 404；为避免干扰现有服务，已使用 6007 临时 dev server 完成 E2E 并清理临时进程和测试附件。

## 2026-05-22 视频面板参考资源缩略图

- 用户反馈：视频参数面板底部只显示 `图片 xN / 视频 xN`，无法分辨 `@视频1`、`@视频2` 分别对应哪段视频。
- 实现内容：
  - `apps/web/src/components/canvas/panels/video-gen-panel.tsx` 在全能参考模式下增加参考资源预览列表。
  - 图片资源使用 `img` 展示缩略图，视频资源使用 `video preload="metadata"` 展示视频首帧/元数据预览，音频资源使用音频图标占位。
  - 每个预览卡片左上角保留彩色 `@图片N`、`@视频N`、`@音频N` 标识，颜色与输入框中的资源 token 保持一致。
  - 保留资源数量摘要，缩略图列表支持横向滚动，避免多个参考资源挤压参数面板布局。
- 验证结果：
  - 清理损坏的 `apps/web/.next` 缓存后重跑验证，原先缺失 `vendor-chunks/sonner...js` 的 Next 开发缓存错误消失。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts` 通过，3 个测试全部通过，并断言图片/视频/音频预览卡片可见。
  - `pnpm --filter @aigc/web test:e2e -- canvas/image-submit.spec.ts` 通过，1 个测试通过。

## 2026-05-23 画布参考资源取消引用

- 需求确认：图片和视频配置面板的参考资源预览右上角增加关闭图标，点击后取消引用；同时删除参考节点到当前节点的连线，并删除提示词中相关 `@图片N/@视频N` 文本。删除后同类型引用编号会变化，提示词内保留下来的引用也要同步重命名。
- 代码定位：
  - `use-node-topology.ts` 生成 `orderedImageRefs` / `mentionResources`，其中 `id` 是 `edge.id`，可作为取消引用的精确定位键。
  - `image-gen-panel.tsx` 展示图片参考预览；`video-gen-panel.tsx` 展示图片/视频/音频分组预览。
  - `node-param-panel.tsx` 持有 `promptDraft`、`updateCfg`、`orderedImageRefs`，最适合作为“删除边 + 重写 prompt”的协调层。
  - `structure-store.ts` 目前支持按 target handle 删除边，但缺少按单条 edge id 删除边的公开方法。
- 方案取舍：
  - 新增按 `edgeId` 删除连线，避免按 source 或 type 误删同源多连线。
  - 提示词清理在删除前用当前 `orderedImageRefs` 计算删除后的同类型编号映射：被删资源的 `@旧名` 删除，保留资源的 `@旧名` 替换为 `@新名`。
  - 预览关闭按钮只阻止面板内点击冒泡，不影响 ReactFlow 选中状态；删除操作进入 undo 历史。
- TDD 计划：
  - 先在现有 `canvas/image-submit.spec.ts` 和 `canvas/video-submit.spec.ts` 增加失败用例。
  - RED 验证后再实现 store、面板回调、提示词重写和关闭按钮。
- 实现结果：
  - `structure-store.ts` 新增 `removeEdgeById`，按单条连线 id 删除并写入 undo 历史。
  - `resource-mentions.ts` 新增 `removeResourceReferenceFromPrompt`，删除被取消引用所在提示词行，并按剩余同类型资源顺序重命名 `@图片N/@视频N/@音频N`。
  - `node-param-panel.tsx` 统一协调“改 prompt + 删除 edge”，图片面板和视频面板复用同一回调。
  - `image-gen-panel.tsx` 的参考图缩略图、`video-gen-panel.tsx` 的多模态参考预览和首尾帧预览均增加关闭按钮。
- 验证结果：
  - RED：新增图片/视频取消引用 E2E 最初均因 `canvas-reference-remove-*` 按钮不存在失败，符合预期。
  - `pnpm --filter @aigc/web exec playwright test e2e/canvas/image-submit.spec.ts -g "removes an image reference"` 通过。
  - `pnpm --filter @aigc/web exec playwright test e2e/canvas/video-submit.spec.ts -g "removes a video reference"` 通过。
  - `pnpm --filter @aigc/web exec playwright test e2e/canvas/image-submit.spec.ts e2e/canvas/video-submit.spec.ts` 通过，6 个测试全部通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web exec tsx --test src/components/canvas/panels/resource-mentions.test.ts` 通过，3 个测试全部通过。
  - `pnpm lint` 执行成功，但 turbo 报告没有实际 lint task。
  - `pnpm --filter @aigc/web exec prettier --check ...` 失败：项目未安装 `prettier` 命令。
- 追加反馈修正：
  - 关闭按钮默认改为 `opacity: 0` 且禁止点击，预览卡片 hover/focus 时才显示和可点击，避免遮挡资源预览。
  - 取消引用时不再删除整行提示词，只删除被移除资源对应的 `@资源N` token；例如 `@图片1和@图片2是好朋友。` 删除图片 2 后保留为 `@图片1和是好朋友。`。
  - mention 匹配放宽为允许中文连写，避免 `@图片1和...` 因缺少空格无法识别。
  - 验证：图片/视频取消引用定向 E2E 均通过；`image-submit.spec.ts` + `video-submit.spec.ts` 共 6 个 E2E 全部通过；`tsc --noEmit` 和 `resource-mentions.test.ts` 通过。

## 2026-05-22 视频参考缩略图优先级调整

- 用户补充：视频资产在 `assets` 表中已有 `thumbnail_url` 字段，视频参数面板应优先展示该缩略图；只有没有缩略图时才用 `video preload="metadata"` 展示首帧。
- 实现内容：
  - `/api/v1/canvases/:id/assets` 查询增加 `a.thumbnail_url`，并对该 URL 做签名后返回。
  - `/api/v1/canvases/:id/node-outputs/:nodeId` 和 `/api/v1/canvases/:id/all-node-outputs` 也从关联资产中返回签名后的 `thumbnail_url`，覆盖上游视频生成节点作为参考源的场景。
  - 前端 `CanvasAssetItem`、`AssetConfig`、`CanvasReferenceMentionResource` 增加缩略图字段承载。
  - `use-canvas-poller.ts` 把节点输出的 `thumbnail_url` 写入执行态 `thumbnailUrl`。
  - `use-node-topology.ts` 从资产节点 config 和上游节点选中输出中读取缩略图，注入参数面板的资源预览元数据。
  - `video-gen-panel.tsx` 的视频参考卡片优先渲染缩略图 `img`，没有缩略图时保留原来的 `video preload="metadata"` 回退。
  - 画布资产侧栏也同步使用 `thumbnail_url` 作为视频封面，缺失时回退视频首帧预览。
- 验证结果：
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/api build` 通过。
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts` 通过，3 个测试全部通过，覆盖有缩略图视频走 `img`、无缩略图视频走 `video`。
  - `pnpm --filter @aigc/web test:e2e -- canvas/image-submit.spec.ts` 通过，1 个测试通过。
  - 后续由于当前 PowerShell PATH 暂时找不到 `pnpm`，且 `corepack pnpm` 触发签名 key 校验错误，使用本机已缓存 pnpm 的临时 wrapper 重跑 `canvas/video-submit.spec.ts canvas/image-submit.spec.ts`，4 个测试全部通过。

## 2026-05-22 参考资源按媒体类型分组

- 用户反馈：图片、视频、音频缩略图不要混放在一起，需要分类展示，方便区分同类资源序号。
- 实现内容：
  - `video-gen-panel.tsx` 新增 `ReferencePreviewGroup`，将参考资源拆分为图片、视频、音频三组。
  - 空分组不渲染，非空分组显示图标、类型名称和数量。
  - 每组内部保留横向滚动缩略图列表，缩略图卡片和 `@图片N/@视频N/@音频N` 标识样式不变。
  - E2E 增加分组容器断言，确认图片、视频、音频分别落在各自列表中。
- 验证结果：
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts canvas/image-submit.spec.ts` 通过，4 个测试全部通过。

## 2026-05-22 画布资源引用提示词优化

- 问题定位：
  - `apps/web/src/components/canvas/panels/resource-mentions.ts` 旧逻辑按 `@图片N` 后续文本切段，导致 `@图片2 帮 @图片1 找妈妈` 被转换为 `图片参考：参考<图片2>中的帮` 和 `图片参考：参考<图片1>中的找妈妈`。
  - 这种转换会破坏用户完整语义，也不符合 Doubao Seedance 2.0 官方“多模态参考”推荐句式。
- 方案取舍：
  - 保留官方句式：图片参考、视频参考、音频参考分别集中描述参考素材。
  - 不再从 `@资源` 后方硬提取主体/动作等字段，避免误拆中文短句；完整用户意图统一放入 `生成：...`。
  - 仅对用户实际提到的资源生成参考句，避免把未使用的上游素材塞进提示词。
  - 将 `@图片N/@视频N/@音频N` 替换为 `<图片N>/<视频N>/<音频N>`，并自动补空格，避免 contenteditable 拼接多行时出现“海报<图片1>”粘连。
- 实现内容：
  - 新增 `apps/web/src/components/canvas/panels/resource-mentions.test.ts`，覆盖图片、视频、音频、无引用场景。
  - 更新 `buildPromptWithResourceMentions`：按资源类型输出官方参考句式，并保留完整生成意图。
  - 更新 `canvas/image-submit.spec.ts` 与 `canvas/video-submit.spec.ts` 的 payload 断言。
- 验证结果：
  - `pnpm --filter @aigc/web exec tsx --test src/components/canvas/panels/resource-mentions.test.ts` 通过，3 个测试全部通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web test:e2e -- canvas/image-submit.spec.ts canvas/video-submit.spec.ts` 通过，4 个测试全部通过。
  - `pnpm --filter @aigc/web build` 通过。
  - `pnpm --filter @aigc/web exec prettier --check "src/**/*.{ts,tsx}"` 失败：当前项目未安装 `prettier` 命令。

## 2026-05-22 画布右键上传资源

- 用户确认需要保留右键菜单原有功能，同时补充上传入口：
  - 右键空白画布保留添加节点菜单，并显示上传文件。
  - 右键图片/视频节点保留创建下游节点功能，并显示上传资源。
  - 上传资源按当前节点类型校验，图片节点只收图片，视频节点只收视频。
- 用户补充：音频节点暂时还没有，本轮暂时忽略音频。
- 方案取舍：
  - 不新增音频节点，不扩大节点注册表。
  - 空白上传只接受图片/视频，并按文件类型创建 `image_gen` 或 `video_gen` 节点，同时把上传文件写入节点输出。
  - 图片/视频生成节点右键上传走现有 `canvas_node_outputs` 输出替换链路，避免把生成节点配置改成素材配置。
- 实现内容：
  - 新增 `apps/web/src/lib/canvas/media-upload-rules.ts`，集中处理图片/视频识别、上传目标、accept 文案和文件类型校验。
  - 新增 `media-upload-rules.test.ts`，覆盖图片/视频识别、音频暂时拒绝、空白画布上传范围、图片/视频节点同类上传限制。
  - `canvas-editor.tsx` 中空白画布右键不再继承当前选中节点，固定显示添加节点菜单和“上传文件”。
  - 节点右键保留“创建下游节点”，同时图片节点显示“上传图片资源”，视频节点显示“上传视频资源”。
  - 空白上传图片/视频后分别创建 `image_gen` / `video_gen` 节点并写入输出；节点上传通过 `replaceNodeOutput` 替换当前输出。
  - 图片/视频素材 `asset` 节点右键上传会替换素材配置，保持现有素材节点能力。
- 验证结果：
  - 先运行 `pnpm --filter @aigc/web exec tsx --test src/lib/canvas/media-upload-rules.test.ts`，RED 阶段因模块不存在失败，符合预期。
  - 实现后同一测试通过，3 个测试全部通过。
  - `pnpm --filter @aigc/web exec tsc --noEmit` 通过。
  - `pnpm --filter @aigc/web build` 通过。
  - 新增 `apps/web/e2e/canvas/context-menu-upload.spec.ts`，并用 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:6008 pnpm --filter @aigc/web test:e2e -- canvas/context-menu-upload.spec.ts` 验证通过，1 个测试通过。
  - 临时 6008 dev server 已关闭。
