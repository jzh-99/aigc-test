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

### 2026-05-25 review 修订
- 音色克隆增加可选描述字段，限制不超过 1024 字。
- 自定义模式标题限制为 20 字以内。
- 作品列表空状态文案固定为“还没有音乐哦，快去创作吧”。
- 音色克隆表补充 `voice_id` 字段，用于后续歌曲生成。
- 计费配置调整为 `mureka-8`、`mureka-9` 分别具备歌曲/纯音乐生成价格与音色克隆价格。

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
