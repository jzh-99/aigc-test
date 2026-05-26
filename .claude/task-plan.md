# Task Plan — video_categories 能力限制重设计

## 2026-05-25 — 音乐创作功能

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 当前任务
- [x] 需求澄清：导航位置、页面结构、模式划分、纯音乐开关、音色下拉、音色克隆、资产库边界、工作区隔离、计费、任务模型、详情页路由。
- [x] 可视化草图迭代：完成 v1-v9，最终确认单栏制作表单、右侧作品列表、详情页右侧歌词抽屉。
- [x] 设计文档：保存到 `docs/superpowers/specs/2026-05-25-music-creation-design.md`。
- [x] 用户 review 设计文档：已补充音色描述、标题限制、列表空状态、voice_id 字段和 mureka 两类计费规则。
- [x] 编写实施计划：保存到 `docs/superpowers/plans/2026-05-25-music-creation.md`。
- [x] 音乐详情页歌词同步：Mureka `choices[0].lyrics_sections` 入库，API 返回精确时间轴，前端按时间轴高亮并滚动歌词。
- [x] 音乐生成状态同步修复：生成按钮在任务终态前保持加载并防重复提交，列表页和详情页通过 track SSE 同步完整最终态。
- [x] 音乐流式播放修复：worker 获取 `stream_url` 后立即写入并推送，轮询阶段发现新 `stream_url` 也会提前同步。
- [x] 歌词时间轴修复：Mureka 官方毫秒级 `lyrics_sections` 入库前统一转换为播放器使用的秒级时间轴。
- [x] 音乐 SSE 认证修复：前端改用 fetch-SSE 携带 Authorization header，避免 EventSource query token 401 后持续重连。
- [x] 历史歌词滚动兼容：详情页播放时对毫秒级 `lyrics_sections` 做前端兜底转换。
- [x] 歌词逐字高亮增强：当前行放大高亮，存在 `words` 时间轴时按播放进度逐字变色。
- [x] Mureka 生成提示词封装：worker 统一封装灵感/自定义/纯音乐提示词，包含标题、音色性别、风格和歌词要求。
- [x] 歌词视觉重构：详情页歌词改为暖棕沉浸背景、居中排版、上下淡出遮罩和当前行强焦点。
- [x] 风格标签输入重构：自定义模式改为已选标签、可见输入框、推荐标签三段式标签选择器。
- [x] 外部调用审计：新增 `provider_api_logs`，音乐/Mureka、音乐封面、图片、视频提交、MiniMax TTS 记录请求参数、响应参数、耗时、状态和外部任务 ID。
- [x] 灵感模式音色隔离：灵感模式不展示/提交我的音色和音色性别，后端兜底忽略相关入参，Mureka 调用不发送 voice 参数。
- [x] 查询审计采样：Mureka、视频、数字人、动作模仿的轮询查询只在首查、状态/关键字段变化、最终态或异常时写入 `provider_api_logs`。
- [x] 文本类 LLM 审计：Qwen 文本生成/同步分镜/worker 分镜、canvas 剧本生成、video-studio 脚本/大纲/资产提示词/分镜拆分均写入 `provider_api_logs`。

## 2026-05-21 — 实现计划阶段

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 当前任务
- [x] 恢复上下文：读取设计文档、任务日志和任务计划。
- [x] 探索相关代码：types、seed、API、创作生成页、画布视频节点。
- [x] 编写实施计划：保存到 `docs/superpowers/plans/2026-05-21-video-categories-limits.md`。
- [x] 实现共享视频限制类型。
- [x] 更新视频模型 seed。
- [x] 后端生成接口兜底校验。
- [x] 改造创作生成页。
- [~] 改造画布视频节点：已把节点 config 里的 `videoCategoryLimits` 贯通到默认值和模型切换逻辑，连线校验也改为读取该快照。
- [x] 完成构建与手测验证。
