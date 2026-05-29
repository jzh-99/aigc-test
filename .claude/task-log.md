# video_categories 能力限制实施计划

## 2026-05-25 — 音乐创作功能设计确认

### 需求边界
- 左侧主导航在“画布”下方新增“音乐”入口，音乐为独立功能页，不嵌入画布。
- 音乐作品不进入现有资产库；创作生成和画布资源仍属于资产库，画布资产库只展示当前画布资产。
- 音乐作品按 `workspace_id` 隔离。
- 页面路由确认为 `/music` 和 `/music/[id]`，上一首/下一首按当前工作区创建时间倒序的相邻作品跳转。

### UI 设计结论
- 制作区与作品展示区左右约各一半。
- 制作区只有“灵感模式”和“自定义模式”两个页签。
- 纯音乐是灵感模式里的开关，不再是单独页签。
- 左侧制作表单保持单栏；音色、音色性别、自定义模式字段都不分栏。
- “我的音色”下拉框放在灵感提示词下方；为空时提供上传音频生成音色入口。
- 生成模型放在音色相关字段下方，用 `mureka-8`、`mureka-9` 列表卡片展示。
- 详情页右侧为页面级歌词抽屉，播放器采用封面、波形、进度条和品质标签的结构。

### 技术设计结论
- 音乐业务表独立，任务和积分复用现有 `task_batches/tasks`。
- 新增任务模块方向：`music`、`music_voice_clone`。
- 音乐生成采用“流式体验 + 任务化落库”：SSE 推歌词增量、阶段状态和 `stream_url`，最终音频与封面转存 TOS 后落库。
- 音色克隆异步执行，使用 `/v1/song/vocal-clone`，单独配置收费。
- 音乐生成模型单价包含歌词、歌曲/纯音乐、封面和转存成本。

### 产出
- 已写入设计文档：`docs/superpowers/specs/2026-05-25-music-creation-design.md`。

### 2026-05-26 歌词精确时间轴
- 新增 `music_tracks.lyrics_sections` 与 `music_tracks.duration_seconds`，用于保存 Mureka 官方 `choices[0].lyrics_sections` 和 `duration`。
- worker 解析并写入 `lyrics_sections`，API 在 `MusicTrackResponse` 中返回该时间轴。
- 歌曲详情页只根据 `lyrics_sections` 的 `line.start/end` 判断当前歌词，播放进度变化和进度条拖动都会映射到精确歌词行；没有时间轴的历史数据只展示歌词，不做比例同步。

### 2026-05-26 音乐生成状态与流式同步修复
- 根因：前端生成按钮只覆盖 `POST /music/generate` 的提交期，API 返回后未跟踪 track SSE；列表页也没有订阅进行中的音乐任务，因此 worker 终态发布后列表不会自动更新。
- 调整：创建任务后把返回的 track 写入 SWR 列表缓存，生成按钮在对应 track 收到 `completed/failed` SSE 前保持加载并禁用重复提交；列表页为所有非终态 track 建立 SSE watcher，详情页收到携带完整 track 的事件后直接更新详情缓存。
- 根因：worker 只有最终轮询完成后才发布 `stream_url`，导致 Mureka streaming 阶段无法提前播放。
- 调整：worker 在初始响应或轮询中一旦发现 `stream_url` 就立即写入 `music_tracks.stream_url` 并发布 `stream_url` 事件；API SSE 收到 Redis 消息后重新查询完整 track 快照再推给前端。
- 根因：官方 `lyrics_sections` 时间单位为毫秒，而播放器 `audio.currentTime` 使用秒，直接比较会导致歌词进度不同步。
- 调整：新增 `normalizeMurekaLyricsSections`，入库前将疑似毫秒级时间轴转换为秒级；已补充 worker helper 测试覆盖毫秒和秒两种输入。
- 验证：`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/api exec tsx src/__tests__/music-validation.test.ts`、`pnpm --filter @aigc/types build`、`pnpm --filter @aigc/api build`、`pnpm --filter @aigc/worker build`、`pnpm --filter @aigc/web build` 均通过。期间发现本地 Next 依赖包缺失，执行 `pnpm install --force` 重铺依赖后 web 构建通过。

### 2026-05-26 音乐 SSE 认证与歌词滚动修复
- 根因：浏览器原生 `EventSource` 不能设置 `Authorization` header，前端把 JWT 拼到 query 上，但 API 认证插件只接受 `Authorization: Bearer ...`，因此 `/music/tracks/:id/events` 返回 `AUTH_REQUIRED`；EventSource 遇到 401 会自动重连，表现为播放时持续调用接口。
- 调整：音乐 track SSE 和音色克隆 SSE 改为 `fetch` 读取 `text/event-stream`，统一携带 `Authorization` header，不再把 token 放入 URL，也不在 401 场景自动重连刷接口。
- 歌词滚动：详情页 `timelineLines` 增加前端兜底转换，历史库里如果已经保存了毫秒级 `lyrics_sections`，播放时也会转换为秒后再和 `audio.currentTime` 对齐。
- 验证：`pnpm --filter @aigc/web build`、`pnpm --filter @aigc/types build` 均通过。

### 2026-05-26 歌词逐字高亮与 Mureka 提示词封装
- 歌词视觉：详情页将 `lyrics_sections.lines.words` 纳入渲染，当前行放大、加深背景和橙色强调；当前行内已播放过的 word 按播放进度变为橙色，缺少 word 时间轴时退化为整行高亮。
- 提示词封装：新增 `buildMurekaGenerationPrompt`，worker 调用 Mureka 前统一封装灵感模式、自定义模式和纯音乐提示词。自定义模式包含“以《标题》为题、使用男声/女声/自动音色、风格、歌词要求”；纯音乐明确“不生成歌词，以旋律、编曲和情绪表达为主”。
### 2026-05-27 Toby AI 绘本完整模块设计
- 需求范围：用户确认要做完整模块，不是前端 mock；模块包含首页、我的绘本、线性创作、角色/背景资产、绘本分镜、图片生成、双语 TTS、项目保存和计费联动。
- 产品决策：首页只保留 AI 生成绘本；去掉上传故事和自由创作；下方最近项目默认展示 4 个，全部按钮进入我的绘本。
- 内容决策：故事摘要只保留中文；每页画面描述、中文独白、英文独白可编辑；语音生成中文和英文两套，预览时可切换语言。
- 流程决策：线性步骤为 `剧本大纲 -> 资产库 -> 绘本分镜 -> 预览导出`；资产库和绘本分镜拆成独立页面。
- 技术决策：新建独立 picture-book 项目表和 API，不复用 `video_studio_projects`；复用 Qwen、图片生成、MiniMax TTS、task_batches、assets、积分和 provider 审计。
- 视觉决策：最终 UI 更简约，跟随现有主题变量，支持深色模式，不照搬参考图的重装饰风格。
- 产出：设计文档已写入 `docs/superpowers/specs/2026-05-27-picture-book-design.md`，等待用户 review 后进入实施计划。

### 2026-05-27 Toby AI 绘本设计 review 修订
- 补充草稿能力：Step 1 生成剧本后立即创建草稿，编辑故事摘要、页面内容和切换步骤时自动保存，项目卡片可继续编辑草稿。
- 计费口径调整为项目维度：新增 `picture_book_project_charges` 设计，底层仍可复用 batch/task/credits ledger，但 UI 和项目详情按项目汇总费用。
- 固定模型：剧本生成和脚本拆分/分镜提示词使用 `qwen3.6-plus`，音频生成使用 MiniMax `speech-2.8-hd`，图片生成使用 `seedream-5.0-lite`。
- seed 决策：实现计划需要调整 `packages/db/scripts/seed.ts`，确保上述模型作为绘本默认模型；已核对 `seedream-5.0-lite` 是现有 Volc 图片模型，worker 图片适配器已有映射。
- 语言边界修订：故事摘要和脚本结构不区分中英文；只有每页台词/旁白和语音分中文、英文两套。

### 2026-05-27 Toby AI 绘本实施计划
- 用户确认设计文档后进入 writing-plans 阶段。
- 实施计划已写入 `docs/superpowers/plans/2026-05-27-picture-book.md`。
- 计划拆为 11 个任务：共享类型、数据库、seed、API helper、项目 CRUD/草稿、Qwen 生成、媒体生成、前端 API/hooks、首页/列表、四步编辑器、端到端验证。
- 自检：计划覆盖草稿、项目计费、固定模型、脚本/台词语言边界、主题适配和验证；未发现未定占位或旧模型残留。

- 验证：`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/worker build`、`pnpm --filter @aigc/web build` 均通过。本会话未暴露 Browser 工具，因此未做浏览器截图验证。

### 2026-05-26 歌词与风格标签 UI 二次打磨
- 歌词区按参考图重做视觉：由右侧普通面板改为暖棕沉浸式歌词页，顶部展示歌曲名和演唱者，中间歌词居中滚动，当前行放大为高亮白色，邻近行降低对比，并增加上下渐隐遮罩。
- 风格标签输入按参考图重做：自定义模式下先展示已选标签，可点击标签内 X 移除；中间是深色高对比输入框，文字和 placeholder 都可见；下方展示推荐标签，点击即可选中/取消，最多保留 10 个。
- 验证：`pnpm --filter @aigc/web build` 通过。

### 2026-05-26 外部 API 调用审计
- 决策：不把第三方请求快照塞进 `task_batches.params`，该字段继续保存前端业务参数；新增独立 `provider_api_logs` 表保存 provider 请求/响应链路，便于后续按 batch、task、provider、operation 排查。
- 数据库：新增 `046_provider_api_logs` 迁移和 `ProviderApiLogsTable` 类型，记录请求参数、响应参数、HTTP 状态、耗时、外部任务 ID、成功/失败状态和错误信息；入库前会脱敏 token/secret/password 等字段，并截断过大 payload。
- 已接入链路：Mureka 歌词/歌曲/纯音乐/音色克隆提交与查询、音乐封面生成、图片生成 worker、视频提交 worker、MiniMax TTS。
- 修复：Mureka 测试场景没有 batch/task/user 上下文时不写审计，避免测试和本地无上下文调用触发数据库连接等待。
- 验证：`pnpm --filter @aigc/db exec tsx src/provider-api-logs.test.ts`、`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/api exec tsx src/services/minimax-tts.test.ts`、`pnpm --filter @aigc/db build`、`pnpm --filter @aigc/worker build`、`pnpm --filter @aigc/api build` 均通过。

### 2026-05-26 灵感模式音色隔离
- 灵感模式不再展示“我的音色”和“音色性别”，提交时固定不带 voice clone，避免隐藏字段影响生成。
- 后端 `validateMusicGeneratePayload` 对 inspiration 模式兜底忽略 `voice_clone_id` 和 `voice_gender`；worker 调 Mureka 生成歌词/歌曲时也不传 `voice_id` 或 `voice_gender`。
- Mureka client 调整为只有显式传入 `voiceGender` 才发送 `voice_gender`，不再默认补 `auto`。
- 验证：`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/worker build`、`pnpm --filter @aigc/api exec tsx src/__tests__/music-validation.test.ts`、`pnpm --filter @aigc/api build`、`pnpm --filter @aigc/web build` 均通过。

### 2026-05-26 查询类外部调用审计采样
- 新增 `provider-poll-audit` 工具，用 `taskId + provider + operation` 维度缓存上一次查询摘要；首查、状态变化、关键字段变化、最终态和异常会写入 `provider_api_logs`，无变化的高频轮询不落库。
- Mureka `song.query`、`instrumental.query`、`voice-clone.query` 接入采样审计，关键字段包含 `stream_url`、下载 URL、duration、lyrics_sections 数量、voice_id 和错误信息。
- video、avatar、action_imitation poller 接入采样审计，记录 provider 查询请求、响应、HTTP 状态、耗时、外部任务 ID，并补充 user/team/workspace/batch/task 维度。
- 异常查询仍强制落库，便于追踪 provider 500、鉴权失败、超时和响应结构异常。
- 验证：`pnpm --filter @aigc/worker exec tsx src/lib/provider-poll-audit.test.ts`、`pnpm --filter @aigc/worker exec tsx src/pollers/video-poller-result.test.ts`、`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/worker build` 均通过。

### 2026-05-26 文本类 LLM 调用审计
- 新增 API 侧 `provider-api-audit` 工具，统一记录 LLM 请求/响应；流式响应只保存 chunk 数、字节数、文本预览和 finished 状态，避免 SSE 原文过量写入。
- 已接入 Qwen：`canvas-agent/text-gen`、`canvas-agent/storyboard-split-sync`、worker `storyboard.split`。
- 已接入 nano-banana OpenAI 兼容 LLM：`canvas-agent/script-write`、video-studio 的 `script-write`、`series-outline`、`asset-prompts`、`storyboard-split`。
- MiniMax TTS 此前已接入 `tts.generate` 审计，本次保留并复测。
- 验证：`pnpm --filter @aigc/api exec tsx src/lib/provider-api-audit.test.ts`、`pnpm --filter @aigc/api build`、`pnpm --filter @aigc/worker build`、`pnpm --filter @aigc/worker exec tsx src/workers/music.test.ts`、`pnpm --filter @aigc/api exec tsx src/services/minimax-tts.test.ts` 均通过。

### 2026-05-27 音乐业务模式计费
- 决策：音乐价格配置不再暴露 `lyrics/song/cover/transfer` 等内部步骤，mureka-8/mureka-9 只保留三种业务模式价格：`inspiration_song`（灵感模式生成歌曲）、`instrumental`（纯音乐）、`custom_song`（自定义模式生成歌曲）。
- 数据迁移：新增 `048_music_business_mode_pricing`，把现有 mureka-8 从旧组合价折算为 12/10/10 A豆，mureka-9 折算为 18/15/15 A豆；seed 同步更新为三条业务模式定价。
- 后端：`resolveMusicCredits` 改为通过 `resolveMusicPricingKey` 精确读取对应业务价格；缺少业务模式价格时抛 `MUSIC_PRICE_NOT_CONFIGURED`，不再回退旧拆分项或模型基础价。
- 前端：音乐创建面板通过 `/models?module=music` 读取 `params_pricing`，在生成按钮上方展示当前模式预计 A豆消耗；后台模型编辑弹窗对音乐模型显示“业务模式”而非“分辨率”。
- 验证：`pnpm --filter @aigc/types build`、`pnpm --filter @aigc/api exec tsx src/__tests__/music-validation.test.ts`、`pnpm --filter @aigc/api build`、`pnpm --filter @aigc/web build`、`pnpm --filter @aigc/api exec tsx ../../packages/types/src/music.test.ts`、`pnpm --filter @aigc/db build` 均通过。

### 2026-05-25 review 修订
- 音色克隆增加可选描述字段，限制不超过 1024 字。
- 自定义模式标题限制为 20 字以内。
- 作品列表空状态文案固定为“还没有音乐哦，快去创作吧”。
- 音色克隆表补充 `voice_id` 字段，用于后续歌曲生成。
- 计费配置调整为 `mureka-8`、`mureka-9` 分别具备歌曲/纯音乐生成价格与音色克隆价格。

### 2026-05-25 实施计划
- 已写入实施计划：`docs/superpowers/plans/2026-05-25-music-creation.md`。
- 计划拆为 10 个任务：共享类型、数据库和 seed、API 校验、API 路由、Mureka/storage worker 基础、music worker、前端 hooks/navigation、音乐列表页、详情页、端到端验证。

## 2026-05-21 — 继续计划阶段

### 已恢复上下文
- 已读取设计文档：`docs/superpowers/specs/2026-05-21-video-categories-limits-design.md`。
- 已读取 `.claude/task-log.md` / `.claude/task-plan.md`，确认当前任务停在“用户确认 spec 后，进入实现计划阶段”。
- 已创建会话任务：实现 video_categories 能力限制重设计。

### 代码探索结论
- `packages/types/src/api.ts` 的 `ModelItem.video_categories` 仍是 `unknown`，注释仍描述旧数组。
- `packages/db/scripts/seed.ts` 中 `veo3.1-fast`、`seedance-1.5-pro`、`seedance-2.0`、`seedance-2.0-fast` 仍使用 `['frames']` / `['multimodal', 'frames', 'components']`。
- `apps/api/src/routes/videos/post-generate.ts` 查询模型未读取 `provider_models.video_categories`，也没有资源数量校验。
- 创作生成页核心文件是 `apps/web/src/components/generation/video/video-panel.tsx` 与 `video-params.tsx`，当前硬编码模式按钮与模型切换。
- 画布视频节点核心文件是 `apps/web/src/components/canvas/node-param-panel.tsx`、`panels/video-gen-panel.tsx`、`panels/use-node-topology.ts`、`stores/canvas/structure-store.ts`，当前仍按旧数组和硬编码上限判断。

### 计划取舍
- 计划会新增共享解析工具，避免创作生成页和画布视频节点重复解析 `video_categories`。
- 不保留旧数组兼容逻辑，解析失败或非对象统一视为“不支持任何视频模式”。
- 后端会在冻结积分前校验，避免非法请求产生扣分或任务。
- 画布连线阶段因为 `structure-store` 目前没有模型列表上下文，计划先保存视频节点当前模型的 limits 快照到节点 config，再让连线校验读取该快照。

### 当前进度
- 已完成：共享视频限制类型与运行时校验函数，`pnpm --filter @aigc/types build` 已通过。
- 已完成：视频模型 seed 改为新 `video_categories` 对象结构。
- 已完成：`/videos/generate` 在冻结积分前做后端兜底校验，`pnpm --filter @aigc/api build` 已通过。
- 进行中：创作生成页、画布节点、连线限制。

## 2026-05-21 — 画布视频节点继续收尾
- 已把 `apps/web/src/stores/canvas/structure-store.ts` 的视频连线限制从硬编码 9/3/3 改为读取 `video_gen` 节点 config 里的 `videoCategoryLimits` 快照。
- 继续沿用 `DEFAULT_VIDEO_CATEGORY_LIMITS` 作为兜底值，避免历史节点或缺省配置出现空限制。
- 这一步把“模型能力限制 -> 节点配置快照 -> 连线校验”这条链路补齐，和创作生成页的动态限制保持一致。

## 2026-05-21 — 构建验证通过
- 已执行 `pnpm --filter @aigc/web build`，构建通过。
- 说明当前创作生成页、画布节点和共享视频限制链路在类型层面已经闭环。
- 还需要在浏览器里手测创作页模式切换、素材上限提示，以及画布视频节点连线拦截是否符合预期。
### 2026-05-27 消费流水中文源头调整
- 决策：消费流水不做前端兜底翻译，统一在产生 `credits_ledger.description` 的源头写入中文描述。
- 调整范围：音乐生成、音乐音色克隆、图片生成、视频生成、数字人、动作模仿、任务提交失败、积分冻结/确认/退回、团队初始 A 豆和管理员充值/扣减的流水描述。
- 数据迁移：新增 `049_credits_ledger_chinese_descriptions`，将历史英文流水描述迁移为中文，down 可反向恢复。
- 验证：`@aigc/db build`、`@aigc/api build`、`@aigc/worker build` 均通过。

### 2026-05-28 绘本分镜卡片重新设计
- 决策：按 `docs/superpowers/specs/2026-05-28-storyboard-card-redesign.md` 执行，视觉参考 `.superpowers/brainstorm/3840-1779954183/content/storyboard-final.html`；语气词/停顿只作为后续版本参考，本次不实现。
- 后端：`post-storyboard-prompts.ts` 增加 @ 引用规则和角色/背景可引用清单；`post-generate-storyboard-images.ts` 新增 `extractStoryboardMentionLabels` 与 `findStoryboardReferenceImages`，命中角色/背景后把图片 URL 放入图片生成 `params.image`。
- 前端：新增 `storyboard-mention-editor.tsx`，使用 contentEditable + pill token 保存纯文本 @ 标记；新增 `storyboard-audio-player.tsx`，用原生 `<audio>` 包装播放/暂停、进度和时长。
- UI：`step-storyboard.tsx` 从三列卡片改为横向单列卡片，左侧为图片、双语音频和重生成按钮，右侧为画面提示词与中英文旁白 Textarea。
- 门控：单页重新生成图片时本地清空 `imageUrl` 并设 `status: pending`，重新生成语音时清空 `voice.zh/en`，确保进度和「下一步」立即反映生成中状态。
- 验证：`pnpm --filter @aigc/api exec tsx --test src/__tests__/picture-book-generation.test.ts src/__tests__/picture-book-media.test.ts` 通过；`pnpm --filter @aigc/web build` 在清理并重装 pnpm 依赖后通过；`pnpm lint` 通过但 turbo 未执行任何 lint task。
- 浏览器验证限制：Browser 工具不可调用，Playwright 兜底时 6006 已被占用；6007 的 Next dev/start 被本地 Next 包缺失 `next/dist/pages/_app` / `next/dist/bin/next` 阻塞，未完成真实页面截图验证。
