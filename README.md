## code graph
```
# 在项目中初始化（-i 表示交互式）
codegraph init -i


# 非交互式安装（CI 环境）
# 自动检测所有已安装代理，全局安装
codegraph install --yes

# 指定目标代理
codegraph install --target=cursor,claude,codex --yes

# 项目级别安装
codegraph install --target=auto --location=local


# 更新同步
codegraph sync


## 验证安装
codegraph status          # 查看索引状态和统计
codegraph query "UserService"  # 测试符号搜索

参考：https://blog.csdn.net/chendongqi2007/article/details/161292757
```

## 本地运行
### 开发

```bash
# 启动所有服务（并行）
pnpm dev

# 单独启动某个应用
pnpm --filter @aigc/web dev       # 前端 :6006
pnpm --filter @aigc/api dev       # API  :7001
pnpm --filter @aigc/worker dev    # Worker
```

### 数据库

```bash
pnpm db:migrate     # 执行迁移
pnpm db:seed        # 填充种子数据
```

## AI 短剧生成链路设计

> 本节记录 Toby Studio / AI 短剧模块已确认的生成链路、任务同步与计费流程，作为后续详细设计和实现计划的输入。

### 1. 首页创建项目与剧本摘要生成

用户在 AI 短剧首页点击 `立即生成` 后，流程拆成两个动作：

1. `POST /short-drama/projects`
   - 创建短剧项目。
   - 保存原始创意、风格、比例、集数、模型设置。
   - 返回 `projectId`，前端进入制作页。
2. `POST /short-drama/projects/:id/script-summary`
   - 自动调用文本模型生成剧本摘要。
   - 支持流式返回。
   - 按实际输出字符数计费。
   - 写回 `state.script.summary`。
   - 更新项目状态为 `summary_ready`。

这样可以先进入制作页，再展示摘要生成过程；失败时项目仍保留，可重试。

### 2. 生成全部分集梗概

用户编辑剧本摘要后点击 `生成分集梗概`：

```text
余额预检查
→ 调用文本模型
→ 一次性生成 episodeCount 条分集梗概
→ 写入 state.script.episodeOutlines
→ 初始化 state.episodes
→ 状态更新为 outline_ready
```

接口：

```text
POST /short-drama/projects/:id/episode-outlines
```

每集梗概包含：

- 集数；
- 标题；
- 一句话看点；
- 剧情梗概；
- 本集主要角色；
- 本集主要场景；
- 结尾钩子；
- 分镜生成状态。

自定义集数建议第一版设置上限，例如 `50`。如果模型输出集数不完整，后端需要补齐或返回结构化错误。

### 3. 生成全剧资产提示词与图片

剧本大纲确认后进入资产库阶段。

#### 3.1 生成资产提示词

接口：

```text
POST /short-drama/projects/:id/asset-prompts
```

输入包括：

- 剧本摘要；
- 全部分集梗概；
- 风格；
- 比例；
- 去重策略。

输出全剧资产：

- `character`：核心角色；
- `scene`：常驻场景；
- `prop`：关键道具；
- `material`：可复用素材。

规则：优先生成全剧稳定资产，去重同名/近义角色；同一角色不同阶段默认只生成一个主形象，差异通过片段 prompt 表达。

#### 3.2 生成资产图片

接口：

```text
POST /short-drama/projects/:id/assets/generate
```

支持批量生成、单个生成、失败重试、上传替换。

```text
前端选择资产
→ 后端余额预检查
→ 提交到现有图片生成链路
→ 获得 batchId
→ 写入资产 status/batchId
→ 前端轮询或 sync-batches
→ 任务完成后写入 imageUrl/assetId
```

资产沉淀到现有资产库/历史，并添加来源字段：

- `source_module = 'toby_studio'`
- `source_feature = 'short_drama'`
- `source_project_id`
- `source_episode_id` 可为空

其他模块默认不返回这些 Toby Studio 短剧产物。

### 4. 单集详细分镜/片段生成

进入分集视频阶段后，每集初始只有梗概。用户进入单集编辑页后，可点击 `生成本集分镜`。

接口：

```text
POST /short-drama/projects/:id/episodes/:episodeId/segments
```

输入包括：

- 全剧摘要；
- 当前集梗概；
- 全剧资产；
- 当前集补充资产；
- 风格；
- 比例；
- 视频模型能力；
- 默认时长档位。

输出 `ShortDramaSegment[]`，每个片段包含：

- 片段标题；
- 画面提示词；
- 推荐引用资产；
- 默认时长；
- 镜头说明；
- 动作/情绪；
- 可选对白或字幕提示。

每集约 1 分钟，分镜数量由视频模型时长能力推导。例如默认 4 秒约 15 个片段，默认 5 秒约 12 个片段。用户可以新增、删除、复制、拖拽排序片段。

每个片段默认有一个不可删除的时长标签，只能在当前模型支持档位中选择。

### 5. 片段视频生成

接口：

```text
POST /short-drama/projects/:id/episodes/:episodeId/segments/:segmentId/generate-video
```

流程：

```text
校验片段 prompt / 时长 / 引用资产
→ 获取 mentionRefs 对应图片 URL
→ 余额预检查
→ 调用现有视频生成服务/队列
→ 写入 batchId/status
→ 任务完成后同步 videoUrl/assetId
```

复用现有视频生成链路，但短剧需要包装业务参数：

```ts
{
  prompt: string
  imageReferences: string[]
  aspectRatio: '9:16' | '16:9'
  durationSeconds: number
  model: string
  sourceModule: 'toby_studio'
  sourceFeature: 'short_drama'
  sourceProjectId: string
  sourceEpisodeId: string
  sourceSegmentId: string
}
```

片段视频也进入资产库/历史，但仅在 Toby Studio 短剧范围返回。重新生成成功后，短剧项目默认指向最新视频结果。

### 6. 任务同步

参考 AI 绘本的 `post-sync-batches`，短剧也需要同步接口：

```text
POST /short-drama/projects/:id/sync-batches
```

同步对象包括：

- 全剧资产图片 batch；
- 单集补充资产图片 batch；
- 片段视频 batch；
- 可选导出 job 状态。

前端策略：

- 制作页和单集编辑页检测到 `pending` / `processing` 时，每 `10s` 同步一次；
- 单个生成动作返回后立即刷新；
- 页面失焦时降低轮询频率或停止；
- 失败状态显示具体错误和重试按钮。

### 7. 单集合成导出

接口：

```text
POST /short-drama/projects/:id/episodes/:episodeId/export
```

前置校验：

- 该集至少有一个片段；
- 所有参与导出的片段都有 `videoUrl`；
- 片段顺序合法；
- 余额满足后台配置的固定导出费用；
- 项目资产阶段已确认；
- 当前不在导出中。

流程：

```text
后端读取后台配置费用
→ 余额预检查
→ 创建导出记录
→ 提交 worker job: short-drama-export-episode
→ 写入 state.exports.episodeExports
→ worker 合成 MP4
→ 上传对象存储
→ 写回 outputUrl/assetId/status
→ 实际扣费或确认扣费
```

导出费用不写死在前端，读取后台配置，类似音色克隆功能。每导出 1 集收取固定 A豆，批量导出按集数累计。

Worker 合成逻辑：

```text
下载片段视频
→ 校验编码/分辨率/帧率
→ 必要时转码统一参数
→ ffmpeg concat 合并
→ 输出 MP4
→ 上传 S3/MinIO
→ 创建 Toby Studio 短剧资产记录
→ 更新项目 state
```

### 8. 批量导出

接口：

```text
POST /short-drama/projects/:id/export-batch
```

输入：

```ts
{
  episodeIds: string[]
}
```

流程：

```text
筛选可导出的集
→ 计算总费用
→ 余额预检查
→ 为每集创建导出任务
→ 返回批量导出状态
```

第一版不做 ZIP 打包。批量导出只是批量触发单集合成，完成后在分集 card 上逐集下载，并在顶部展示批量进度。

### 9. 计费策略

#### 9.1 预估

前端所有生成/导出按钮附近展示预估：

- 剧本摘要：预计输出字符；
- 分集梗概：按集数估算字符；
- 资产图片：按资产数量 × 模型单价；
- 片段视频：按模型、时长、比例、数量；
- 导出：按后台配置固定费用 × 集数。

预估可以由各生成接口返回，也可以后续抽成独立接口：

```text
POST /short-drama/projects/:id/estimate
```

#### 9.2 实际结算

- 文本：按实际输出字符；
- 图片：按任务实际消耗；
- 视频：复用现有视频生成扣费；
- 导出：按后台配置固定费用。

#### 9.3 余额不足

每个生成前检查余额。余额不足时不提交任务，并提示用户充值或减少生成范围。

批量任务第一版建议采用：**全部余额足够才开始**，避免用户困惑。

### 10. 失败与重试

失败粒度：

- 剧本摘要失败：可重试；
- 分集梗概失败：可重试；
- 资产提示词失败：可重试；
- 单个资产图失败：可单独重试；
- 单集分镜失败：可重试；
- 单个片段视频失败：可单独重试；
- 单集导出失败：可重试；
- 批量导出部分失败：失败集可单独重试。

所有失败都写入：

```ts
{
  status: 'failed',
  error: string
}
```

前端需要展示错误提示和重试按钮，不吞掉失败原因，也不因为部分失败阻塞其他集继续制作。

## 音乐生成流程

音乐功能由 `apps/web` 发起，`apps/api` 创建任务并冻结积分，`apps/worker` 调用 Mureka 生成歌曲/纯音乐，最后通过 SSE 推送状态给前端。

### 1. 前端操作入口

用户进入 `http://localhost:6006/music` 后，在音乐创作面板选择生成模式：

- **灵感模式**：用户填写灵感提示词，可选择生成歌曲或纯音乐。
- **自定义模式**：用户填写歌曲标题、歌词和风格，只生成歌曲，不支持纯音乐。
- 可选参数包括：
  - `model`：`mureka-9` 或 `mureka-8`
  - `voice_gender`：自动 / 男声 / 女声
  - `voice_clone_id`：用户自己的克隆音色
  - `styles`：歌曲风格标签

点击“生成歌曲 / 生成纯音乐”时，前端会调用：

```ts
POST /api/v1/music/generate
```

前端按钮有提交中状态和同步锁，避免连续点击重复提交。请求中会带 `idempotency_key`，后端也会用它做幂等判断。

### 2. API 创建任务

入口文件：

```txt
apps/api/src/routes/music/post-generate.ts
```

API 收到请求后按顺序执行：

1. 校验请求参数：
   - `workspace_id` 必填。
   - 灵感模式必须有 `prompt`。
   - 自定义模式必须有 `title` 和 `lyrics`。
   - 自定义模式不允许 `instrumental`。
   - `voice_id` 入参会被拒绝，前端必须传内部的 `voice_clone_id`。
2. 校验用户是否有工作区权限。
3. 根据 `idempotency_key + user_id + workspace_id + module=music` 查询是否已有任务：
   - 如果已有，直接返回已有 batch / task / track。
   - 不再重复扣积分或重复入队。
4. 如果使用克隆音色，查询 `music_voice_clones`：
   - 必须属于当前 workspace。
   - 状态必须是 `ready`。
   - 必须有外部 `voice_id`。
5. 解析模型价格并冻结积分。
6. 在事务中创建：
   - `task_batches`
   - `tasks`
   - `music_tracks`
7. 投递 BullMQ 队列：

```txt
music-queue
```

任务数据包括：

```ts
{
  taskId,
  batchId,
  trackId,
  userId,
  teamId,
  workspaceId,
  creditAccountId,
  estimatedCredits
}
```

API 会记录关键日志，包括模式、曲目类型、模型、prompt/lyrics 长度、是否使用克隆音色、积分和队列投递结果。日志不会记录完整 prompt、歌词或密钥。

### 3. Worker 处理任务

入口文件：

```txt
apps/worker/src/workers/music.ts
```

worker 监听队列：

```txt
music-queue
```

收到任务后：

1. 将 `tasks.status` 更新为 `processing`。
2. 将 `task_batches.status` 从 `pending` 更新为 `processing`。
3. 读取 `music_tracks` 和 `task_batches.params`。
4. 根据模式计算初始状态：
   - 灵感模式 + 歌曲：`lyrics_generating`
   - 自定义歌曲：`song_generating`
   - 纯音乐：`song_generating`
5. 每次状态变化都会写入 `music_tracks.status`，并发布 SSE。

### 4. 灵感模式歌曲

灵感模式生成歌曲时，worker 会先调用 Mureka 生成歌词：

```txt
POST /v1/lyrics/generate
```

请求包含：

```ts
{
  model,
  prompt,
  voice_gender,
  stream: true
}
```

歌词返回后：

1. 写入 `music_tracks.lyrics`。
2. 发布 SSE 事件：

```ts
{ event: 'lyrics_delta', delta, lyrics }
```

然后进入歌曲生成阶段。

### 5. 自定义模式歌曲

自定义模式不会调用歌词生成接口，直接使用用户填写的 `title`、`lyrics` 和 `styles` 调用 Mureka 歌曲生成：

```txt
POST /v1/song/generate
```

请求包含：

```ts
{
  model,
  lyrics,
  prompt,
  title,
  vocal_id,
  voice_gender,
  styles,
  n: 1,
  stream: true
}
```

注意：

- `vocal_id` 来自内部 `voice_clone_id` 对应的外部音色 ID。
- 前端不能直接传 Mureka 的 `vocal_id`。

### 6. 纯音乐生成

灵感模式开启“纯音乐”时，worker 调用：

```txt
POST /v1/instrumental/generate
```

请求包含：

```ts
{
  model,
  prompt,
  voice_gender,
  n: 1,
  stream: true
}
```

纯音乐不会生成歌词，详情页歌词区域显示“暂无歌词”。

### 7. Mureka 结果和轮询

Mureka 可能直接返回媒体地址，也可能返回 `task_id`。

worker 先解析初始响应：

- `url`
- `flac_url`
- `wav_url`
- `stream_url`
- `task_id`
- `status`
- `error_message`

如果没有最终音频地址但有 `task_id`，worker 会轮询：

```txt
GET /v1/song/query/:task_id
```

直到：

- 成功：状态为 `succeeded / success / completed / done / ready`
- 失败：状态为 `failed / error / canceled / cancelled`
- 超时：默认 15 分钟

如果有 `stream_url`，worker 会先通过 SSE 通知前端可播放：

```ts
{ event: 'stream_url', stream_url }
```

### 8. 封面生成和媒体转存

Mureka 返回歌曲结果后，worker 会尝试生成封面：

```txt
VolcengineImageAdapter.generateImage
```

封面生成失败不会导致音乐任务失败，只会记录 warn 日志并继续完成任务。

随后 worker 会转存媒体文件到对象存储：

- `audio_url` -> `audio_storage_url`
- `flac_url` -> `flac_storage_url`
- `wav_url` -> `wav_storage_url`
- `cover_url` -> `cover_storage_url`

转存阶段状态为：

```txt
transferring
```

### 9. 完成任务

所有关键结果写入 `music_tracks`：

- `title`
- `lyrics`
- `stream_url`
- `audio_url`
- `audio_storage_url`
- `flac_url`
- `flac_storage_url`
- `wav_url`
- `wav_storage_url`
- `external_task_id`
- `status = completed`

然后确认积分：

1. 扣除冻结积分。
2. 更新 `credit_accounts.balance`。
3. 写入 `credits_ledger`。
4. 更新 `tasks.status = completed`。
5. 更新 `task_batches.status = completed`。

最后发布 SSE：

```ts
{ event: 'completed', track_id }
```

前端收到后会刷新音乐详情和作品列表。

### 10. 失败处理

任意关键步骤失败时，worker 会调用失败处理：

1. `music_tracks.status = failed`
2. `music_tracks.error_message = message`
3. `tasks.status = failed`
4. `task_batches.status = failed`
5. 释放冻结积分
6. 返还本次预估积分到 `team_members.credit_used`
7. 写入 `credits_ledger` refund 记录
8. 发布 SSE：

```ts
{ event: 'failed', error_message }
```

前端收到失败事件后展示失败状态和错误信息。

### 11. SSE 状态更新

音乐详情页会订阅：

```txt
GET /api/v1/music/tracks/:id/events
```

API 从 Redis 订阅：

```txt
sse:music_track:<trackId>
```

支持事件：

- `status`
- `lyrics_delta`
- `stream_url`
- `completed`
- `failed`

如果用户打开详情页时任务已经完成或失败，SSE 会立即发送当前快照并结束连接。

### 12. 调试日志

音乐生成相关日志分布：

- API 入站和队列投递：

```txt
apps/api/src/routes/music/post-generate.ts
```

- worker 任务执行：

```txt
apps/worker/src/workers/music.ts
```

- Mureka HTTP 调用：

```txt
apps/worker/src/lib/mureka.ts
```

调试时建议用以下字段串联日志：

- `batchId`
- `taskId`
- `trackId`
- `jobId`
- `murekaTaskId`
- `traceId`

日志只记录长度、状态、ID 和布尔信息，不记录完整歌词、prompt 或 API Key。

## 项目部署
### 构建 & Lint

```bash
pnpm build          # 全量构建
pnpm lint           # 全量 lint
pnpm --filter @aigc/web build     # 单独构建前端

pnpm --filter @aigc/types build # 单独构建types 包
```
### 本机操作：构建镜像
在 monorepo 根目录执行，构建上下文是整个仓库：
```bash
bash deploy/build-images.sh all
# 产物输出到 deploy/dist/
#   aigc-api.tar.gz
#   aigc-web.tar.gz
#   aigc-worker.tar.gz
```

单独构建某个服务：
```bash
bash deploy/build-images.sh api
bash deploy/build-images.sh web
bash deploy/build-images.sh worker
```

### 服务部署 ---- api / worker / web 服务器（以 api 为例）----
docker load < aigc-web.tar.gz
cp .env.example .env
cp docker-compose.yml docker-compose.yml
vi .env                              # 填写 INFRA_HOST 及各项密钥
docker compose up -d


docker load < aigc-web.tar.gz
docker-compose up -d --force-recreate # 强制重新构建容器

### 数据库迁移
API 容器正在运行时
#### 结构迁移
在 API 服务器 /home/vmuser/projects/aigc-api 下执行：
```
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/migrate.ts'
```
#### 数据迁移
执行 seed：
```
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/seed.ts'
```
