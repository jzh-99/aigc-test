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
