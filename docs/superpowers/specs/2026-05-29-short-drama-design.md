# Toby Studio AI 短剧模块设计

## 背景

在 Toby Studio 中新增 AI 短剧模块，面向“从一句创意生成连续短剧”的完整创作闭环。用户在首页输入创意、选择风格、比例和集数后进入制作页，按线性步骤完成剧本大纲、资产库、分集视频制作，并最终导出单集 MP4。

该模块参考 AI 绘本的页面结构、步骤条、项目草稿和资产生成体验，但业务上独立建模。短剧拥有自己的项目、分集、片段和导出状态；片段视频生成复用现有视频生成服务；单集合成导出使用短剧专属 worker。

## 目标

- `/toby-studio/short-drama` 成为可用首页，不再显示“待开发”。
- 首页提供创意输入、风格库、比例选择、集数选择、文本模型价格说明和最近短剧项目。
- 点击立即生成后创建短剧项目，并进入制作页自动生成剧本摘要。
- 制作页采用线性步骤：`剧本大纲 -> 资产库 -> 分集视频`。
- 上一阶段确认后不可修改，下一阶段只有在上一阶段完成后才可进入。
- 剧本阶段先生成剧本摘要，再一次性生成全部分集梗概；单集详细分镜按需生成。
- 资产库采用“全剧资产库 + 单集补充资产”。
- 分集视频阶段支持单集编辑、片段视频生成、连续预览、单集合成导出和批量导出。
- 产物进入资产库/历史，但作为 Toby Studio 短剧来源隔离，其他模块默认不返回。
- 计费覆盖文本、图片、视频和合成导出，采用“项目预估 + 实际结算”。

## 非目标

第一版不做以下内容：

- 步骤回退修改。
- 项目版本管理。
- 公开分享链接。
- 作品广场。
- ZIP 批量下载。
- 多轨时间线剪辑器。
- 字幕轨道。
- BGM 轨道。
- 转场模板。
- 自动音频后期。
- 角色多形态时间线。
- 复杂资产一致性检测。
- 跨模块资产返回。
- 管理后台风格库配置。
- 移动端深度剪辑体验。

## 总体架构

AI 短剧采用混合方案：

- 短剧项目、步骤、分集、片段和导出状态由短剧模块自己维护。
- 文本生成通过 API 直接调用现有文本模型能力。
- 资产图片生成复用现有图片生成链路。
- 片段视频生成复用现有视频生成链路。
- 单集 MP4 合成走短剧专属 worker。
- 资产、历史、batch、task、积分系统复用现有基础设施。

推荐边界：

```text
apps/web
  短剧首页 / 制作页 / 单集编辑页

apps/api
  short-drama REST routes
  项目状态、文本生成、资产生成、片段生成、同步、导出

apps/worker
  short-drama-export worker
  ffmpeg 下载、校验、转码、concat、上传、回写状态

packages/types
  短剧共享类型、常量、normalize 工具

packages/db
  short_drama_projects 迁移
  必要的 batch / asset 来源字段补充
```

## 用户流程

### 首页

路由：`/toby-studio/short-drama`

页面结构：

- 顶部标题：`Toby AI短剧`。
- 创意输入框。
- 参数区：
  - 风格库。
  - 比例。
  - 集数。
  - 立即生成按钮。
- 文本模型价格说明。
- 最近短剧项目区。

风格库包含 4 个页签：

- 全部。
- 真人。
- 2D。
- 3D。

风格卡片以图片 + 名称 + 描述展示。`全部` 页签第一个选项为自定义风格。第一版风格库使用前端静态配置，后续再扩展为后台配置。

比例选项：

- `9:16`
- `16:9`

集数选项：

- `5`
- `10`
- `15`
- `20`
- 自定义集数

自定义集数第一版建议上限为 `50`。超出上限时前端禁止提交，后端也必须校验。

### Step 1：剧本大纲

进入制作页后自动进入剧本大纲阶段。

页面包含：

- 原始创意。
- 剧本摘要。
- 分集梗概。

流程：

```text
创建项目
→ 自动生成剧本摘要
→ 用户编辑剧本摘要
→ 生成全部分集梗概
→ 用户编辑分集梗概
→ 确认剧本大纲
→ 锁定 script 阶段
→ 进入资产库
```

剧本摘要生成接口支持流式返回。生成失败时项目仍保留，用户可以重试。

分集梗概一次性生成 `episodeCount` 条，不在此阶段生成全部详细分镜。详细分镜在用户进入单集编辑页后按需生成。

每集梗概包含：

- 集数。
- 标题。
- 一句话看点。
- 剧情梗概。
- 本集主要角色。
- 本集主要场景。
- 结尾钩子。
- 分镜生成状态。

确认剧本大纲前需要校验：

- 剧本摘要不为空。
- 分集梗概数量等于项目集数。
- 每集标题和剧情梗概不为空。

### Step 2：资产库

资产库阶段生成全剧稳定资产。

资产类型：

- `character`：角色。
- `scene`：场景。
- `prop`：道具。
- `material`：素材。

页面结构：

- 顶部资产生成说明。
- 资产分类 tab。
- 资产生成进度。
- 批量生成按钮。
- 资产 card 列表。

每个资产 card 包含：

- 名称。
- 类型。
- 描述。
- 图片提示词。
- 图片预览。
- 状态。
- 生成、重新生成、上传替换操作。

资产提示词生成规则：

- 输入为剧本摘要、全部分集梗概、风格、比例和去重策略。
- 优先生成全剧稳定资产。
- 同名或近义角色需要去重。
- 同一角色不同阶段默认只生成一个主形象，差异在后续片段 prompt 中表达。

资产图片生成规则：

- 支持批量生成。
- 支持单个生成。
- 支持失败重试。
- 支持上传替换。
- 生成前做余额预检查。
- 生成成功后写入资产库/历史。

确认资产库前需要校验：

- 必要角色和场景已经完成或被用户明确跳过。
- 没有正在处理的必需资产任务。

确认后锁定资产库，并进入分集视频阶段。

### Step 3：分集视频

分集视频阶段展示短剧所有集。

页面结构：

- 顶部统计：总集数、已完成集数、可导出集数。
- 新增集按钮。
- 批量导出按钮。
- 分集 card 列表。

每个分集 card 包含：

- 本集视频预览。
- 本集名称。
- 主要角色。
- 主要场景。
- 分镜数量。
- 当前状态。
- 预览按钮。
- 编辑按钮。
- 导出按钮。
- 下载按钮。

分集状态包括：

- `outline_only`：只有梗概。
- `segments_ready`：已有分镜片段。
- `generating`：片段视频生成中。
- `partially_ready`：部分片段完成。
- `ready_to_preview`：可连续预览。
- `exporting`：导出中。
- `exported`：已导出。
- `failed`：失败。

### 单集编辑页

路由：`/toby-studio/short-drama/[id]/episodes/[episodeId]`

布局采用三栏：

- 左侧资源库。
- 中间片段列表。
- 右侧整集预览。

左侧资源库包含：

- 全剧资产。
- 当前集补充资产。
- 上传入口。
- 分类 tab：角色、场景、素材、道具。

上传资源时用户必须选择作用范围：

- 全剧可用。
- 仅本集可用。

中间片段列表包含：

- 自动生成本集分镜按钮。
- 新增片段按钮。
- 片段 card 列表。
- 拖拽排序。
- 删除片段。
- 复制片段。
- 片段 prompt 编辑。
- 片段视频生成。

片段 prompt 支持 `@` 引用：

- `@角色`
- `@场景`
- `@素材`
- `@道具`

每个片段默认有一个不可删除的时长标签。初始值为 `4s` 或当前模型推荐值。用户只能从当前视频模型支持的时长档位中选择，不支持新增或删除时长标签。

片段生成视频时，后端从片段数据中读取：

- prompt。
- mentionRefs 对应图片 URL。
- aspectRatio。
- durationSeconds。
- videoModel。

右侧整集预览包含：

- 按片段顺序连续播放。
- 当前片段状态提示。
- 缺失片段提示。
- 单集导出按钮。
- 导出费用展示。
- 导出状态。
- 下载入口。

## 视觉设计

整体视觉遵循现有应用主题，不单独引入大面积新设计语言。

- 使用现有 `bg-background`、`bg-card`、`border`、`text-foreground`、`text-muted-foreground`、`primary` 等主题变量。
- 支持深色模式。
- 首页结构参考 AI 绘本首页，但参数区扩展为风格库、比例、集数。
- 制作页步骤条参考 AI 绘本 `PictureBookStepper` 的横向进度条风格。
- 阶段文案为：`剧本大纲`、`资产库`、`分集视频`。
- 已完成阶段允许点击只读查看。
- 未解锁阶段置灰。
- 当前阶段高亮。
- 单集编辑页桌面端优先，第一版移动端只保证可用。
- 所有数据获取区域必须覆盖 loading、empty、error、success 四种状态。
- 所有生成/导出按钮必须有 loading 状态和防重复提交。

## 数据模型

### `short_drama_projects`

新增项目主表，用于列表、权限、恢复和状态索引。详细编辑态保存在 `state jsonb`。

字段：

- `id uuid primary key`
- `workspace_id uuid not null`
- `team_id uuid not null`
- `user_id uuid not null`
- `title text not null`
- `prompt text not null`
- `style text not null`
- `aspect_ratio text not null`
- `episode_count integer not null`
- `status text not null`
- `active_step text not null`
- `cover_url text null`
- `state jsonb not null`
- `estimated_credits integer not null default 0`
- `actual_credits integer not null default 0`
- `draft_saved_at timestamptz null`
- `is_deleted boolean not null default false`
- `deleted_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

索引：

- `(workspace_id, updated_at desc)`
- `(workspace_id, is_deleted, updated_at desc)`
- `(user_id, updated_at desc)`

项目状态：

- `draft`
- `summary_ready`
- `outline_ready`
- `assets_ready`
- `episodes_ready`
- `completed`
- `failed`

步骤 ID：

- `script`
- `assets`
- `episodes`

### State JSON

`short_drama_projects.state` 保存完整编辑态。

```ts
interface ShortDramaState {
  steps: {
    active: ShortDramaStepId
    completed: ShortDramaStepId[]
  }
  locks: {
    script?: boolean
    assets?: boolean
  }
  script: {
    originalPrompt: string
    summary: string
    episodeOutlines: ShortDramaEpisodeOutline[]
  }
  assets: {
    global: ShortDramaAsset[]
    episodeScoped: Record<string, ShortDramaAsset[]>
  }
  episodes: ShortDramaEpisode[]
  exports: {
    episodeExports: ShortDramaEpisodeExport[]
    batchExports: ShortDramaBatchExport[]
  }
  settings: {
    style: string
    aspectRatio: '9:16' | '16:9'
    episodeCount: number
    textModel: string
    imageModel: string
    videoModel: string
    billingMode: 'estimate_actual'
  }
  draft: {
    savedAt?: string
    dirty: boolean
    lastError?: string
  }
}
```

分集梗概：

```ts
interface ShortDramaEpisodeOutline {
  id: string
  episodeNumber: number
  title: string
  logline: string
  synopsis: string
  characters: string[]
  scenes: string[]
  hook: string
  segmentStatus: ShortDramaGenerationStatus
}
```

资产：

```ts
interface ShortDramaAsset {
  id: string
  kind: 'character' | 'scene' | 'prop' | 'material'
  scope: 'global' | 'episode'
  episodeId?: string
  name: string
  description: string
  prompt: string
  imageUrl?: string
  assetId?: string
  batchId?: string
  status: ShortDramaGenerationStatus
  error?: string
}
```

分集：

```ts
interface ShortDramaEpisode {
  id: string
  episodeNumber: number
  title: string
  outlineId: string
  status: ShortDramaEpisodeStatus
  segments: ShortDramaSegment[]
  previewVideoUrls: string[]
  exportId?: string
  outputUrl?: string
}
```

片段：

```ts
interface ShortDramaSegment {
  id: string
  order: number
  title: string
  prompt: string
  mentionRefs: Array<{
    assetId: string
    kind: 'character' | 'scene' | 'prop' | 'material'
    name: string
  }>
  durationSeconds: number
  cameraNote?: string
  actionNote?: string
  dialogueOrSubtitle?: string
  videoUrl?: string
  assetId?: string
  batchId?: string
  status: ShortDramaGenerationStatus
  error?: string
}
```

生成状态：

```ts
type ShortDramaGenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
```

### 资产和历史来源字段

短剧产物进入现有资产库/历史时必须写入来源信息：

```ts
{
  sourceModule: 'toby_studio'
  sourceFeature: 'short_drama'
  sourceProjectId: string
  sourceEpisodeId?: string
  sourceSegmentId?: string
}
```

其他模块查询资产或历史时默认排除 `sourceModule = 'toby_studio'` 且 `sourceFeature = 'short_drama'` 的产物。短剧模块查询时显式包含。

## API 设计

所有路由挂在 `/api/v1/short-drama`。

### 项目

- `POST /short-drama/projects`：创建短剧项目。
- `GET /short-drama/projects?workspace_id=&cursor=&limit=`：项目列表。
- `GET /short-drama/projects/:id`：项目详情。
- `PUT /short-drama/projects/:id`：保存项目 state、标题、封面和步骤。
- `DELETE /short-drama/projects/:id`：软删除项目。

`POST /short-drama/projects` 入参包含：

```json
{
  "workspace_id": "uuid",
  "prompt": "落魄千金回村创业，意外绑定 AI 管家",
  "style": "真人都市",
  "aspect_ratio": "9:16",
  "episode_count": 20,
  "text_model": "qwen3.6-plus"
}
```

创建项目只保存原始创意和设置，返回 `projectId`。前端进入制作页后再调用剧本摘要生成接口。

### 文本生成

- `POST /short-drama/projects/:id/script-summary`：生成剧本摘要。
- `POST /short-drama/projects/:id/episode-outlines`：生成全部分集梗概。
- `POST /short-drama/projects/:id/asset-prompts`：生成全剧资产提示词。
- `POST /short-drama/projects/:id/episodes/:episodeId/segments`：生成单集详细分镜。

文本类接口必须：

- 校验用户、workspace 和项目归属。
- 做余额预检查。
- 记录实际输出字符数。
- 按实际输出字符结算。
- 对模型输出做结构校验。
- 失败时写入可读错误。

### 图片与视频生成

- `POST /short-drama/projects/:id/assets/generate`：生成资产图片。
- `POST /short-drama/projects/:id/assets/upload`：上传资产图片。
- `POST /short-drama/projects/:id/episodes/:episodeId/segments/:segmentId/generate-video`：生成片段视频。
- `POST /short-drama/projects/:id/sync-batches`：同步未完成 batch 状态。

片段视频生成复用现有视频生成链路，但需要包装短剧业务参数：

```ts
interface ShortDramaVideoGeneratePayload {
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

后端必须从 `mentionRefs` 查出资产图片 URL，不能信任前端直接传入的任意图片 URL。

### 导出

- `POST /short-drama/projects/:id/episodes/:episodeId/export`：单集合成导出。
- `POST /short-drama/projects/:id/export-batch`：批量导出。
- `GET /short-drama/projects/:id/export-status`：查询导出状态。

单集导出前置校验：

- 该集至少有一个片段。
- 所有参与导出的片段都有 `videoUrl`。
- 片段顺序合法。
- 项目资产阶段已确认。
- 当前不在导出中。
- 余额满足后台配置的固定导出费用。

批量导出第一版要求余额覆盖全部可导出集数后才开始，避免部分扣费导致用户困惑。

## Worker 设计

新增队列：

- `short-drama-export-queue`

任务类型：

- `short-drama-export-episode`
- `short-drama-export-batch`

单集导出流程：

```text
API 读取后台导出费用
→ 余额预检查
→ 创建导出记录
→ 投递 short-drama-export-episode job
→ Worker 下载片段视频
→ 校验编码 / 分辨率 / 帧率
→ 尝试 ffmpeg concat
→ 必要时转码统一参数
→ 输出 MP4
→ 上传对象存储
→ 创建 Toby Studio 短剧资产记录
→ 更新项目 state
→ 确认导出费用
```

Worker 失败时：

- 写入导出失败状态。
- 写入错误原因。
- 按积分系统规则释放或退回费用。
- 清理临时文件。
- 保留失败集可重试。

ffmpeg 策略：

- 优先使用 concat demuxer 直接拼接。
- 直接拼接失败时转码到统一编码参数。
- 统一输出 MP4。
- 记录转码耗时和失败原因。

## 任务同步

短剧复用类似 AI 绘本 `post-sync-batches` 的同步模式。

同步接口：

```text
POST /short-drama/projects/:id/sync-batches
```

同步对象包括：

- 全剧资产图片 batch。
- 单集补充资产图片 batch。
- 片段视频 batch。
- 导出 job 状态。

前端策略：

- 制作页和单集编辑页检测到 `pending` 或 `processing` 时，每 `10s` 同步一次。
- 单个生成动作返回后立即刷新。
- 页面失焦时降低轮询频率或停止。
- 失败状态展示具体错误和重试按钮。

## 计费设计

### 预估

前端所有生成/导出按钮附近展示预估：

- 剧本摘要：预计输出字符。
- 分集梗概：按集数估算字符。
- 资产图片：资产数量 × 模型单价。
- 片段视频：模型、时长、比例、数量。
- 导出：后台配置固定费用 × 集数。

预估可以由各生成接口返回，也可后续抽成独立接口：

```text
POST /short-drama/projects/:id/estimate
```

### 实际结算

- 文本：按实际输出字符。
- 图片：按任务实际消耗。
- 视频：复用现有视频生成扣费。
- 导出：按后台配置固定费用。

### 后台配置

第一版必须支持：

- `short_drama_episode_export_credits`：单集合成导出固定费用。

可选扩展：

- `short_drama_max_episode_count`。
- `short_drama_default_video_duration`。
- `short_drama_enabled_video_models`。

前端不能写死导出费用，必须读取后端返回值。

## 权限与安全

后端必须校验：

- 用户已登录。
- 用户属于 workspace。
- 用户有权限修改当前项目。
- 资产属于当前 workspace。
- 资产属于当前短剧项目或被允许全剧使用。
- batch/task 属于当前项目。
- 导出任务属于当前项目。

安全要求：

- 不信任前端费用。
- 不信任前端资产 URL。
- 不在日志中打印完整 prompt、密钥或签名 URL。
- ffmpeg 下载只允许本系统对象存储 URL 或内部 storage key。
- 禁止任意外部 URL 下载，防止 SSRF。
- 导出临时文件必须在成功或失败后清理。
- 上传资源必须校验文件类型、大小和归属。

## 前端组件设计

建议组件：

- `ShortDramaHome`
- `ShortDramaStyleDialog`
- `ShortDramaEditorPage`
- `ShortDramaStepper`
- `StepScriptOutline`
- `StepAssets`
- `StepEpisodes`
- `EpisodeEditor`
- `AssetLibraryPanel`
- `SegmentList`
- `SegmentCard`
- `SegmentPromptEditor`
- `DurationTag`
- `EpisodePreviewPanel`

组件边界：

- `ShortDramaHome` 只负责首页输入、风格库、最近项目和创建项目。
- `ShortDramaEditorPage` 负责项目级数据加载、步骤切换、同步轮询和锁定校验。
- `StepScriptOutline` 负责剧本摘要、分集梗概和确认。
- `StepAssets` 负责全剧资产提示词、图片生成、上传替换和确认。
- `StepEpisodes` 负责分集列表、状态聚合和导出入口。
- `EpisodeEditor` 负责单集编辑页三栏布局和本集状态保存。
- `SegmentPromptEditor` 负责 prompt 编辑、`@` 引用和时长标签展示。
- `DurationTag` 只负责选择合法时长，不负责解析自然语言。

## 测试策略

### 共享类型

新增：

- `packages/types/src/short-drama.ts`
- `packages/types/src/short-drama.test.ts`

测试内容：

- 默认 state normalize。
- 步骤锁定逻辑。
- 分集数量校验。
- 片段排序校验。
- 时长档位校验。
- 资产 scope 校验。

### API

测试内容：

- 项目创建权限。
- workspace 归属校验。
- 剧本摘要生成失败处理。
- 分集梗概数量不足处理。
- 资产提示词去重。
- 片段 mentionRefs 归属校验。
- 片段视频生成参数转换。
- `sync-batches` 状态回写。
- 导出余额不足。
- 批量导出部分失败状态。

### Worker

测试内容：

- 单集导出 job 参数校验。
- 缺失片段视频时失败。
- concat 成功路径。
- concat 失败后转码路径。
- 上传失败处理。
- 失败后临时文件清理。
- 费用确认或退回。

### 前端

测试内容：

- 首页输入和防重复提交。
- 风格库页签和自定义风格。
- 步骤条锁定逻辑。
- 剧本摘要生成 loading/error/success。
- 资产库 empty/loading/error/success。
- 单集编辑页 @ 引用。
- 时长标签不可删除。
- 片段拖拽排序。
- 连续预览缺失片段提示。
- 导出按钮费用展示和 loading 状态。

### E2E 最小路径

```text
进入 AI 短剧首页
→ 输入创意
→ 选择风格 / 比例 / 集数
→ 创建项目
→ 自动生成剧本摘要
→ 生成全部分集梗概
→ 确认剧本大纲
→ 生成全剧资产提示词
→ 批量生成角色 / 场景图
→ 确认资产库
→ 进入第 1 集编辑页
→ 生成本集分镜
→ 修改一个片段时长
→ @ 引用角色 / 场景
→ 生成两个片段视频
→ 右侧连续预览
→ 导出第 1 集 MP4
→ 下载成功
```

## 实施顺序

1. 新增短剧共享类型、normalize 工具和测试。
2. 新增 `short_drama_projects` 迁移和必要来源字段。
3. 新增短剧项目 CRUD API。
4. 实现首页、风格库和最近项目。
5. 实现制作页容器和 `ShortDramaStepper`。
6. 实现剧本摘要和分集梗概生成。
7. 实现资产提示词、资产图片生成和上传替换。
8. 实现分集列表。
9. 实现单集编辑页、片段列表、`@` 引用和时长标签。
10. 接入片段视频生成和 `sync-batches`。
11. 实现导出费用配置、单集导出 API 和 worker。
12. 实现批量导出和下载。
13. 补充测试、构建和浏览器验证。

## 风险与注意事项

- 视频片段可能存在编码、分辨率、帧率不一致，worker 必须支持 concat 失败后的转码 fallback。
- 长剧项目的 `state` 可能较大，第一版只保存必要字段，视频和图片只保存引用。
- 短剧资产必须通过来源字段隔离，避免污染其他模块。
- 文本、图片、视频、导出四类计费路径不同，必须统一由后端预估和结算。
- 模型输出可能不是合法 JSON，后端必须做结构校验并返回可读错误。
- 单集编辑页交互密集，必须拆小组件，避免单文件超过 200 行后继续堆逻辑。
- `.superpowers/brainstorm/` 是本地视觉伴随产物，不应提交到仓库。

## 自检结论

- 无 `TBD`、`TODO` 或未定字段。
- 已明确第一版目标和非目标。
- 已明确短剧采用独立项目 state + 外部任务/资产关联。
- 已明确剧本摘要、分集梗概、资产提示词、单集分镜、片段视频和导出链路。
- 已明确步骤条参考 AI 绘本进度条。
- 已明确时长标签不可删除，只能选择模型支持档位。
- 已明确短剧产物进入资产库/历史，但其他模块默认不返回。
- 已明确单集合成导出读取后台配置固定费用。
- 已明确 API、Worker、计费、安全、测试和实施顺序。
