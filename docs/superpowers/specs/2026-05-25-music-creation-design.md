# 音乐创作功能设计

## 背景

在主应用左侧导航的“画布”下方新增“音乐”入口，为用户提供歌曲、纯音乐、个人音色克隆和音乐作品管理能力。音乐作品独立于现有资产库，不进入 `assets` 体系；创作生成和画布资源仍按现有规则进入资产库，画布资产库仍只展示当前画布资产。

## 路由与页面

- `/music`：音乐创作与作品列表页。
- `/music/[id]`：音乐详情页。
- 左侧主导航新增 `音乐`，放在 `画布` 之后、`视频工坊` 之前。
- 音乐按 `workspace_id` 隔离；切换工作区后只展示当前工作区的音乐作品。

### `/music`

页面左右约各一半区域：

- 左侧为制作区。
- 右侧为作品列表区。

制作区标题为“创造你的专属音乐”，副标题为“描述你想要的音乐风格、主题和情感，Toby AI 将为你创作独一无二的歌曲”。

制作区只保留两个页签：

- `灵感模式`
- `自定义模式`

#### 灵感模式

字段顺序：

1. `纯音乐` 开关：开启后不生成歌词，直接生成纯音乐。
2. `灵感提示词`：必填，1024 字以内。
3. `我的音色` 下拉框：可选；仅展示用户已克隆的个人音色。
4. `音色性别` 下拉框：可选，值为 `自动`、`男声`、`女声`。
5. `生成模型`：列表卡片选择，支持 `mureka-8`、`mureka-9`。
6. `参考提示词`：点击后填入灵感提示词输入框。

参考提示词包括：

- 一首关于星空与思念的中文流行歌曲，旋律舒缓，充满情感
- An upbeat electronic dance track with futuristic synths
- 轻快的儿童歌曲，关于春天和小动物，欢快可爱

当“我的音色”为空时，下拉框显示“暂无音色，上传自己的音频文件生成音色”。点击后打开音色上传对话框，用户上传音频文件并填写音色名称，提交后调用 `/v1/song/vocal-clone`。

音色克隆对话框支持填写音色描述，描述为可选字段，不超过 1024 字。

#### 自定义模式

字段单栏排列，不分栏：

1. `标题`：必填。
2. `歌词`：必填，3000 字以内。
3. `风格`：独立的多选输入框，可选择或输入自定义风格；不依赖歌词输入框。
4. `我的音色` 下拉框：可选；逻辑同灵感模式。
5. `音色性别` 下拉框：可选，值为 `自动`、`男声`、`女声`。
6. `生成模型`：列表卡片选择，支持 `mureka-8`、`mureka-9`。

默认风格标签包括：流行、摇滚、古典、电子、乡村、爵士、嘻哈、民谣、节奏布鲁斯、R&B。

自定义模式标题不超过 20 字。

#### 作品列表区

- 显示当前工作区音乐作品。
- 支持全部、歌曲、纯音乐筛选。
- 支持分页，优先使用游标分页。
- 点击封面或标题进入 `/music/[id]`。
- 列表展示封面、名称、类型、音色、模型、创建时间。
- 无作品时显示空状态文案：`还没有音乐哦，快去创作吧`。

### `/music/[id]`

详情页展示：

- 歌曲或纯音乐封面。
- 歌曲或纯音乐名。
- 作曲：Toby AI。
- 作词：Toby AI；纯音乐可显示“无歌词”或隐藏作词字段。
- 使用音色、模型、类型。
- 播放按钮、播放进度条、上一首、下一首。
- 可用音频品质标识：MP3、FLAC、WAV。
- 页面右侧歌词抽屉；纯音乐显示“暂无歌词”和创作信息。

上一首、下一首按当前工作区内创建时间倒序的相邻作品跳转。

## 生成体验

音乐生成采用“流式体验 + 任务化落库”：

- 前端提交后立即连接 SSE。
- 歌词生成阶段：后端将歌词增量推送给前端。
- 歌曲或纯音乐生成阶段：后端提交 Mureka 任务并轮询。
- 一旦拿到 `stream_url`，通过 SSE 推给前端，前端可提前播放。
- 任务完成后拿到 `url`、`flac_url`、`wav_url`，转存 TOS 后落库。
- 封面生成使用 Seedream，生成后转存 TOS 并落库。

音色克隆采用异步任务：

- 用户上传音频文件并提交。
- 后端调用 `/v1/song/vocal-clone`。
- 任务完成后写入“我的音色”列表。
- 音色克隆独立计费。

## 后端架构

### 任务与积分

音乐业务表独立，任务和积分复用现有 `task_batches/tasks`：

- 新增 `task_batches.module = 'music'`。
- 新增 `task_batches.module = 'music_voice_clone'`。
- 复用现有冻结、确认、退款积分逻辑。
- 复用任务状态、SSE、队列和失败恢复模式。

音乐作品不写入 `assets` 表。

### 数据表

新增 `music_tracks`：

- `id`
- `workspace_id`
- `user_id`
- `team_id`
- `batch_id`
- `task_id`
- `type`：`song` 或 `instrumental`
- `mode`：`inspiration` 或 `custom`
- `title`
- `prompt`
- `lyrics`
- `styles`
- `voice_clone_id`
- `voice_gender`：`auto`、`male`、`female`
- `model`：`mureka-8`、`mureka-9`
- `cover_url`
- `cover_storage_url`
- `stream_url`
- `audio_url`
- `audio_storage_url`
- `flac_url`
- `flac_storage_url`
- `wav_url`
- `wav_storage_url`
- `external_task_id`
- `status`：`pending`、`lyrics_generating`、`song_generating`、`cover_generating`、`transferring`、`completed`、`failed`
- `error_message`
- `created_at`
- `updated_at`

新增 `music_voice_clones`：

- `id`
- `workspace_id`
- `user_id`
- `team_id`
- `batch_id`
- `task_id`
- `name`
- `description`
- `source_audio_url`
- `source_audio_storage_url`
- `voice_id`
- `external_voice_id`
- `external_task_id`
- `status`：`pending`、`processing`、`ready`、`failed`
- `error_message`
- `created_at`
- `updated_at`

字段命名可在实现阶段按 Kysely 和现有 schema 风格微调，但不得改变业务边界。

`voice_id` 是 `/v1/song/vocal-clone` 完成后返回的音色 ID，用于后续歌曲生成请求。`external_voice_id` 可作为兼容别名或供应商原始 ID 字段保留；实现阶段应优先保证歌曲生成能读取稳定的 `voice_id`。

### API

新增音乐接口：

- `POST /music/generate`：提交歌曲或纯音乐生成。
- `GET /music/tracks`：当前工作区音乐作品分页列表。
- `GET /music/tracks/:id`：音乐详情。
- `GET /music/tracks/:id/adjacent`：详情页上一首、下一首。
- `GET /music/tracks/:id/events` 或复用 batch SSE：推送生成阶段、歌词增量、`stream_url`、完成状态。
- `POST /music/voice-clones`：提交音色克隆。
- `GET /music/voice-clones`：我的音色列表。

所有接口必须验证当前用户对 `workspace_id` 的访问权限，至少需要 editor 角色才能创建音乐或音色克隆。

### 外部接口

灵感模式未开启纯音乐：

1. 调用 `/v1/lyrics/generate` 生成歌词。
2. 调用 `/v1/song/generate` 生成歌曲，默认生成 1 首。
3. 调用 Seedream 生成歌曲封面。
4. 转存封面和音频到 TOS。

灵感模式开启纯音乐：

1. 调用 `/v1/instrumental/generate` 生成纯音乐，默认生成 1 首。
2. 调用 Seedream 生成封面。
3. 转存封面和音频到 TOS。

自定义模式：

1. 使用标题、歌词、风格标签、音色性别、我的音色组成歌曲生成请求。
2. 调用 `/v1/song/generate`，默认生成 1 首。
3. 调用 Seedream 生成封面。
4. 转存封面和音频到 TOS。

音色克隆：

1. 上传音频文件到 TOS。
2. 调用 `/v1/song/vocal-clone`，可携带不超过 1024 字的音色描述。
3. 任务完成后保存返回的 `voice_id`，后续歌曲生成使用该 `voice_id`。

## 计费

- 音乐生成模型单价包含歌词生成、歌曲或纯音乐生成、封面生成和转存成本。
- 音色克隆作为单独项目独立配置收费。
- `mureka-8` 和 `mureka-9` 分别配置两套价格：歌曲/纯音乐生成价格、音色克隆价格。
- 失败任务按现有任务逻辑退款。
- seed 中需要配置 `mureka-8`、`mureka-9` 的歌曲/纯音乐价格，以及对应的音色克隆价格。

## 前端状态

音乐生成表单需要覆盖：

- 加载状态。
- 错误状态。
- 空状态。
- 成功状态。
- 防重复提交。
- 字数限制提示。
- 生成中的阶段提示。
- `stream_url` 提前播放。

音色上传对话框需要覆盖：

- 上传音频文件。
- 填写音色名称。
- 填写不超过 1024 字的音色描述。
- 提交中状态。
- 克隆中状态。
- 克隆成功后刷新“我的音色”下拉框。
- 克隆失败提示。

## 测试与验证

后端测试：

- 工作区权限校验。
- 音乐生成请求校验。
- 纯音乐开关选择正确外部接口。
- 自定义模式风格和音色参数转换。
- 音色克隆独立计费。
- SSE 事件包含歌词增量、阶段状态和 `stream_url`。
- 完成后 TOS URL 正确写入音乐表。

前端测试：

- 左侧导航出现音乐入口。
- 灵感模式纯音乐开关改变提交 payload。
- 自定义模式标题超过 20 字时阻止提交并提示。
- 我的音色为空时出现上传入口。
- 音色克隆描述超过 1024 字时阻止提交并提示。
- 自定义模式风格多选输入框独立工作。
- 作品列表为空时展示“还没有音乐哦，快去创作吧”。
- 列表分页和筛选工作。
- 点击封面或标题进入详情页。
- 详情页上一首、下一首按工作区内创建时间倒序跳转。

验证命令按实现改动范围选择：

- `pnpm --filter @aigc/types build`
- `pnpm --filter @aigc/api build`
- `pnpm --filter @aigc/worker build`
- `pnpm --filter @aigc/web build`
- 相关单元测试和必要的浏览器手测。
