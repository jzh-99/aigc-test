# user_works 迁移兼容报告

## 结论

C 端原 `user_works` 不建议在本项目中继续按单表落库，也不新增一张兼容影子表。作品数据按本项目现有模式拆分存储：

- `task_batches`：一次创作请求/一组作品的主记录，承载原 `user_works` 的归属、类型、状态、参数、成本、外部流水号等信息。
- `tasks`：一次创作请求下的单个生成任务，承载外部任务 ID、任务状态、错误信息、完成时间等执行信息。
- `assets`：生成后的文件资产，承载原 `file_url`、`img_url` 对应的音频/图片/视频地址、缩略图、文件属性。
- 模块项目表：绘本、短剧、视频工作室等多步骤作品使用项目表作为业务态，`task_batches` 只记录具体生成批次。

C 端不直接写 `user_works`。C 端发起创作时调用本项目 API，由 API 在事务内创建 `task_batches` 和 `tasks`；生成完成后由 worker 写入或更新 `assets` 和任务状态。

## C 端原表字段

原 `user_works` 是“作品快照表”，把请求参数、作品状态、产物 URL、积分、回调信息放在一张表中：

| 原字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `gener_no` | 生成流水号 |
| `phone` | 用户手机号 |
| `work_name` | 作品名称 |
| `work_type` | 作品类型：1 音乐、2 图片、3 视频、4 播客、5 资讯 |
| `sub_work_type` | 子类型：6 AI 绘本 |
| `model_code` | 模型编码 |
| `content_obj` | 作品参数 |
| `file_url` | 作品文件地址 |
| `img_url` | 封面图片地址 |
| `source` | 来源：`user` 用户操作、`timer` 周期生成 |
| `status` | 状态：0 创作中、1 成功、2 失败 |
| `is_delete` | 是否删除 |
| `cost_point` | 花费积分数 |
| `callback_content` | 回调内容 |
| `work_desc` | 作品描述 |

这些字段在本项目中不丢失，但会分散到任务、资产、项目状态中存储。

## 核心存储模型

### 1. `task_batches`

`task_batches` 是 `user_works` 的主要替代表。C 端每次提交创作请求，至少生成一条 `task_batches`。

用途：

- 标识一次创作请求。
- 记录用户、团队、工作区。
- 记录模型、提示词、参数。
- 记录业务类型和状态。
- 记录积分预估和实际消耗。
- 支持幂等、防重复提交。
- 对开放接口兼容 `business_id`、`callback_url`、`task_id` 等字段。

### 2. `tasks`

`tasks` 是具体执行任务。一个 `task_batches` 可以有多个 `tasks`，例如一次生成多张图、多个视频片段、多首音乐。

用途：

- 记录每个生成任务的执行状态。
- 记录外部供应商任务 ID。
- 记录错误信息。
- 记录完成时间。

### 3. `assets`

`assets` 是最终产物表。

用途：

- 存储图片、视频、音频产物 URL。
- 存储缩略图。
- 存储文件大小、时长、宽高。
- 支持软删除和资产列表。

### 4. 模块项目表

复杂作品不再塞进 `user_works.content_obj`，而是进入对应项目表：

| 业务 | 项目表 |
| --- | --- |
| AI 绘本 | `picture_book_projects`、`picture_book_project_assets`、`picture_book_project_charges` |
| 短剧 | `short_drama_projects`、`short_drama_segments` |
| 视频工作室 | `video_studio_projects` |
| 音乐 | `music_tracks`、`music_voice_clones` |
| 画布 | `canvases`、`canvas_node_outputs` |

## 字段映射

| `user_works` 字段 | 本项目字段 | 说明 |
| --- | --- | --- |
| `id` | `task_batches.id` 或 `tasks.id` | 本项目使用 UUID，不保留自增 ID。列表页以 `batch_id` 作为主作品 ID。 |
| `gener_no` | `task_batches.idempotency_key` / `task_batches.task_id` / `task_batches.business_id` | C 端用户操作建议用 `idempotency_key`；开放接口保留对外 `task_id` 和 `business_id`。 |
| `phone` | `users.phone`，归属落到 `task_batches.user_id` | 不在作品表重复存手机号。 |
| `work_name` | `task_batches.params.title` 或项目表 `title/name` | 简单作品放 `params.title`；绘本/短剧等放项目表标题。 |
| `work_type` | `task_batches.module` / `task_batches.service_type` | 使用字符串枚举，不使用数字。 |
| `sub_work_type` | `task_batches.module` 或项目表类型 | AI 绘本映射为 `picture_book` 或开放接口 `storybook`。 |
| `model_code` | `task_batches.model` | 模型编码直接存本字段。 |
| `content_obj` | `task_batches.params` | 使用 `jsonb` 存结构化参数。 |
| `file_url` | `assets.storage_url` / `assets.original_url` | 产物文件进入资产表。 |
| `img_url` | `assets.thumbnail_url` / 项目表 `cover_url` | 缩略图优先放 `assets.thumbnail_url`，项目封面放项目表。 |
| `source` | `task_batches.source` | 用户生成用 `generation`；工作台/项目流程用 `studio`；画布用 `canvas`；开放接口用 `open_api`。 |
| `status` | `task_batches.status` + `tasks.status` | 0 创作中映射 `pending/processing`，1 成功映射 `completed/partial_complete`，2 失败映射 `failed`。 |
| `is_delete` | `task_batches.is_deleted` / `assets.is_deleted` | 软删除字段保留。 |
| `create_time` | `task_batches.created_at` | 创建时间。 |
| `update_time` | `task_batches.updated_at` | 更新时间。 |
| `callback_time` | `task_batches.finished_at` 或回调日志时间 | 开放接口回调完成后可用 `finished_at` 表示业务完成时间。 |
| `cost_point` | `task_batches.actual_credits` / `tasks.credits_cost` | 批次总消耗在 `actual_credits`，单任务消耗在 `credits_cost`。 |
| `callback_content` | `task_batches.params.callbackPayload` 或后续回调日志表 | 不建议塞主表；短期可放 `params`，长期建议独立回调日志。 |
| `remark` | `task_batches.params.remark` | 非核心字段放 `params`。 |
| `work_desc` | `task_batches.prompt` / `params.description` / 项目表 `prompt` | 主提示词放 `prompt`，描述放 `params.description`。 |

## 作品类型映射

| C端 `work_type` | 原含义 | 本项目 `module` | 备注 |
| --- | --- | --- | --- |
| 1 | 音乐 | `music` | 音色克隆单独为 `music_voice_clone`。 |
| 2 | 图片 | `image` | 多图生成是一条 batch 多条 task/assets。 |
| 3 | 视频 | `video` | 视频片段、组件生成仍归入 video 或具体项目流程。 |
| 4 | 播客 | `podcast` | 开放接口迁移扩展模块。 |
| 5 | 资讯 | `news` | 开放接口迁移扩展模块；每日资讯配置另走 `daily_news`。 |
| `sub_work_type=6` | AI 绘本 | `picture_book` / `storybook` | C 端开放接口可用 `storybook`，本项目内部项目表用 `picture_book_projects`。 |
| 新增 | 短剧 | `short_drama` | 对应本项目短剧项目表。 |
| 新增 | 文本润色 | `text` | 对应开放接口文本任务。 |

## C 端写入流程

### 用户手动创作

1. C 端调用本项目创作 API，传入 `workspace_id`、`model`、`prompt`、`params`、`idempotency_key`。
2. API 校验用户登录态，并基于用户当前选择的账号空间确定：
   - `user_id`
   - `team_id`
   - `workspace_id`
   - `credit_account_id`
3. API 在事务中创建：
   - `task_batches`
   - `tasks`
4. worker 执行 AI 生成。
5. 生成完成后：
   - 更新 `tasks.status`
   - 更新 `task_batches.status/completed_count/failed_count/actual_credits`
   - 写入 `assets`

推荐写入结构：

```json
{
  "task_batches": {
    "source": "generation",
    "module": "image",
    "provider": "volcengine",
    "model": "seedream",
    "prompt": "一只白色猫在窗边",
    "params": {
      "title": "窗边白猫",
      "description": "C端用户生成作品",
      "client_scope": "mini_program",
      "legacy_work_type": 2
    },
    "status": "pending"
  },
  "tasks": [
    {
      "version_index": 0,
      "status": "pending"
    }
  ]
}
```

### 周期生成

原 `source=timer` 不再直接写 `user_works`，建议：

- 周期规则存 `mini_user_push_rules`。
- 每次触发生成时仍创建 `task_batches`。
- `task_batches.source` 根据业务归属选择：
  - 如果是普通用户生成历史：`generation`
  - 如果是系统周期任务但要展示给用户：`generation`，并在 `params.trigger_source = 'timer'`
  - 如果是开放接口触发：`open_api`

推荐在 `params` 中保留：

```json
{
  "trigger_source": "timer",
  "push_rule_id": "mini_user_push_rules.id",
  "legacy_source": "timer"
}
```

## C 端查询方式

### 作品列表

C 端列表页应从 `task_batches` 查询，左连接 `assets` 拿首个产物。

核心过滤条件：

- `task_batches.user_id = 当前用户`
- `task_batches.workspace_id = 当前账号空间工作区`
- `task_batches.is_deleted = false`
- 按 `created_at desc, id desc` 分页
- 可按 `module` 过滤作品类型

返回给 C 端的兼容字段可以由 API 聚合：

| C端返回字段 | 来源 |
| --- | --- |
| `work_id` | `task_batches.id` |
| `gener_no` | `task_batches.task_id` 或 `task_batches.idempotency_key` |
| `work_name` | `params.title` / 项目表标题 |
| `work_type` | 由 `module` 反向映射数字 |
| `model_code` | `task_batches.model` |
| `content_obj` | `task_batches.params` |
| `file_url` | 首个 `assets.storage_url/original_url` |
| `img_url` | `assets.thumbnail_url` / 项目封面 |
| `status` | 由 `task_batches.status` 反向映射数字 |
| `cost_point` | `task_batches.actual_credits` |
| `create_time` | `task_batches.created_at` |
| `update_time` | `task_batches.updated_at` |

### 作品详情

详情页应读取：

1. `task_batches` 主记录。
2. `tasks` 执行明细。
3. `assets` 产物列表。
4. 如 `module` 对应项目型业务，再读取项目表：
   - `picture_book_projects`
   - `short_drama_projects`
   - `video_studio_projects`
   - `music_tracks`

## 状态映射

| C端状态 | 原含义 | 本项目状态 |
| --- | --- | --- |
| 0 | 创作中 | `pending` / `processing` |
| 1 | 成功 | `completed` |
| 1 | 部分成功 | `partial_complete`，C 端可展示为成功但提示部分失败 |
| 2 | 失败 | `failed` |

## 删除与恢复

原 `user_works.is_delete` 映射为：

- `task_batches.is_deleted`
- `task_batches.deleted_at`
- `assets.is_deleted`
- `assets.deleted_at`

C 端删除作品时不物理删除，调用本项目删除接口做软删除。恢复时恢复 batch 和 asset 的软删除状态。

## 兼容建议

### 不建议

- 不建议新增 `user_works` 表作为双写表。
- 不建议 C 端直接写数据库。
- 不建议把所有结果继续塞进一个 `content_obj` 字符串字段。
- 不建议继续使用数字 `work_type` 作为内部主类型。

### 建议

- C 端只通过 API 写入。
- API 返回可以保留 C 端熟悉的字段名，但后端存储走本项目模型。
- 对 C 端保留 `work_id = task_batches.id`。
- 对外流水保留 `task_id` 或 `business_id`，不要依赖自增 ID。
- `params` 中短期保留 `legacy_work_type`、`legacy_source`，方便灰度期排查。

## 示例：图片作品落库

创建时：

```sql
INSERT INTO task_batches (
  user_id,
  team_id,
  workspace_id,
  credit_account_id,
  idempotency_key,
  source,
  module,
  provider,
  model,
  prompt,
  params,
  estimated_credits,
  status
) VALUES (
  :user_id,
  :team_id,
  :workspace_id,
  :credit_account_id,
  :idempotency_key,
  'generation',
  'image',
  :provider,
  :model,
  :prompt,
  :params_json,
  :estimated_credits,
  'pending'
);
```

创建任务：

```sql
INSERT INTO tasks (
  batch_id,
  user_id,
  version_index,
  status,
  estimated_credits
) VALUES (
  :batch_id,
  :user_id,
  0,
  'pending',
  :estimated_credits
);
```

生成完成后：

```sql
INSERT INTO assets (
  task_id,
  batch_id,
  user_id,
  type,
  storage_url,
  original_url,
  thumbnail_url,
  transfer_status,
  metadata
) VALUES (
  :task_id,
  :batch_id,
  :user_id,
  'image',
  :storage_url,
  :original_url,
  :thumbnail_url,
  'completed',
  :metadata_json
);
```

## 迁移策略

### 历史数据迁移

如果需要迁移旧 `user_works` 历史数据，建议按以下方式做一次性离线迁移：

1. 按 `phone` 匹配 `users.phone`。
2. 找到或创建用户个人账号空间：
   - `teams.team_type = 'personal'`
   - 默认 `workspaces`
   - 团队积分账户
3. 每条 `user_works` 转为一条 `task_batches`。
4. 每条 `user_works` 至少转为一条 `tasks`。
5. 有 `file_url/img_url` 的记录转为 `assets`。
6. 原始字段完整放入 `task_batches.params.legacy_user_works`，方便审计追溯。

### 新数据写入

新数据不再写旧 `user_works`，只写本项目表。

### 灰度兼容

如果 C 端短期仍需要 `user_works` 形状，建议由 API 层提供兼容 DTO（数据传输对象）：

```ts
interface MiniUserWorkDTO {
  work_id: string
  gener_no: string | null
  work_name: string
  work_type: number
  sub_work_type?: number | null
  model_code: string | null
  content_obj: unknown
  file_url: string | null
  img_url: string | null
  source: 'user' | 'timer'
  status: 0 | 1 | 2
  cost_point: number
  create_time: string
  update_time: string | null
}
```

该 DTO 只作为接口返回形状，不作为数据库表。

## 最终建议

`user_works` 在本项目中应定位为“旧 C 端展示模型”，不是“新数据库模型”。C 端应通过 API 写入创作请求，后端统一落到 `task_batches/tasks/assets/项目表`。这样可以同时兼容：

- 个人账号空间。
- 团队账号空间。
- 工作区隔离。
- 积分账户。
- 多端作品列表。
- 多任务、多资产、多项目型作品。
- 开放接口回调和幂等。
