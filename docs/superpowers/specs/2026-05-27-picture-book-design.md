# Toby AI 绘本完整模块设计

## 背景

在 Toby Studio 中开放独立的 AI 绘本模块，面向儿童绘本故事生成、制作草稿保存、角色和背景资产生成、逐页绘本分镜图片生成、逐页中英双语台词/旁白语音生成和成品预览导出。

该模块是独立业务，不复用 `video_studio_projects` 表承载绘本数据。实现时复用现有生成基础设施：Qwen 文本生成、图片生成接口、MiniMax TTS、`task_batches`、`tasks`、`assets`、积分冻结/确认/退回、provider 调用审计。

## 目标

- `/toby-studio/picture-book` 成为可用首页，不再显示“待开发”。
- 首页提供居中的 `Toby AI绘本` AI 生成入口，只保留 AI 生成模式。
- 首页下方展示最近 4 个绘本项目卡片，`全部` 跳转到我的绘本列表页。
- 支持输入提示词、选择绘本风格、选择页数后生成绘本剧本大纲。
- 绘本创作采用线性步骤：`剧本大纲 -> 资产库 -> 绘本分镜 -> 预览导出`。
- 绘本制作过程支持草稿保存，用户离开后可从项目卡片继续编辑。
- 故事摘要仅中文。
- 剧本和脚本结构不区分中英文；每页台词/旁白和语音支持中英双语，编辑时维护中文台词/旁白和英文台词/旁白，预览/播放时可切换语言。
- 角色和背景先生成提示词，不自动生成图片；用户编辑确认后批量生成图片，支持单卡重生成。
- 绘本分镜先生成每页画面提示词、中文台词/旁白、英文台词/旁白；用户编辑确认后批量生成图片和双语音频。
- 生成操作按项目维度计费和归集，失败自动退回对应项目下的冻结积分。

## 非目标

- 本期不做上传故事和自由创作入口。
- 本期不做多人实时协同编辑。
- 本期不做复杂排版编辑器，只提供绘本预览和基础导出入口。
- 本期不新增独立音色克隆能力，语音使用现有系统音色。

## 用户流程

### 首页

路由：`/toby-studio/picture-book`

页面结构：

- 顶部标题：`Toby AI绘本`。
- 中心生成面板：
  - 左上 label：`AI 生成绘本`。
  - 大文本框：输入绘本主题、角色、教育目标或剧情提示。
  - 绘本风格下拉框。
  - 页数下拉框。
  - `生成剧本` 按钮。
- 下方项目区：
  - 标题：`我的绘本` 或 `最近项目`。
  - 默认展示 4 个项目卡片，居中排列。
  - `全部` 按钮跳转到 `/toby-studio/picture-book/projects`。
  - 草稿项目展示草稿状态和最近保存时间，点击后继续进入上次步骤。

绘本风格选项：

- 扁平矢量风
- 彩铅蜡笔风
- 拼贴艺术风
- 3D黏土盲盒风
- 新中式水墨风
- 美影厂剪纸风
- 吉卜力风
- 经典水彩风
- 迪士尼/皮克斯3D风
- 黑板粉笔画风
- 复古版画风
- 梦幻光影厚涂风

页数选项：`10`、`15`、`20`。

### Step 1：剧本大纲

进入项目编辑页后展示顶部横向步骤条：

`剧本大纲 -> 资产库 -> 绘本分镜 -> 预览导出`

剧本大纲页展示：

- 绘本风格和页数摘要。
- `故事摘要`：中文文本框，可编辑。
- `每页内容`：轮播式 card，一次聚焦一页，支持上一页/下一页、页码显示。
- 每页 card 字段：
  - 标题。
  - 画面描述，中文，可编辑。
  - 中文台词/旁白，可编辑。
  - 英文台词/旁白，可编辑。该字段默认由 AI 从中文台词/旁白翻译并润色，用户可改。

用户确认后进入资产库。进入下一步前需校验页数与所选页数一致，且每页画面描述、中文台词/旁白、英文台词/旁白不为空。

草稿规则：

- Step 1 生成剧本后立即创建项目草稿。
- 用户每次编辑故事摘要、页面内容或切换步骤时自动保存草稿。
- 保存失败时保留本地临时状态并显示重试入口。

### Step 2：资产库

资产库是角色和背景的独立步骤页，不和绘本分镜混排。

顶部仍显示横向步骤条，当前步骤为 `资产库`。

页面结构：

- 顶部 tab 或分类切换：
  - `全部角色 N`
  - `全部背景 M`
- 提示条：说明角色和背景设定会应用到后续全部绘本分镜。
- 多选/批量生成按钮。
- 角色 card：
  - 名称。
  - 类型：角色。
  - 重要程度：主角、配角、道具角色等可选字段。
  - 提示词，可编辑。
  - 参考图区域，初始为空。
  - 状态：未生成、生成中、已生成、失败。
  - 操作：生成、重新生成、设为选中图。
- 背景 card：
  - 名称。
  - 类型：背景。
  - 提示词，可编辑。
  - 参考图区域，初始为空。
  - 状态和操作同角色。

AI 在 Step 1 生成剧本时同时提炼角色和背景清单及提示词，但不生成图片。只有用户在 Step 2 主动点击生成时才提交图片生成任务并扣费。

所有角色和背景图片生成完成后才允许进入 Step 3。失败项可以重试，也可以由用户选择跳过，但跳过会在进入下一步时给出确认提示。

### Step 3：绘本分镜

绘本分镜是独立步骤页，使用卡片列表呈现，视觉可接近用户参考图，但实现时更简约并适配主题。

页面结构：

- 标题：`绘本分镜`。
- 进度：`已生成页数 / 总页数`。
- 状态按钮：未锁定、已锁定、生成中。
- 分镜 card 网格：
  - 页码。
  - 图片预览区域，初始为空。
  - 画面提示词，可编辑。
  - 中文台词/旁白，可编辑。
  - 英文台词/旁白，可编辑。
  - 图片生成状态。
  - 中文音频生成状态。
  - 英文音频生成状态。
  - 操作：生成本页、重新生成图片、重新生成中文音频、重新生成英文音频、放大预览。

Step 3 初始只生成文案字段，不自动生成图片和音频。用户确认后点击批量生成，系统为每页生成：

- 1 张绘本图片。
- 1 条中文语音。
- 1 条英文语音。

图片和音频可分别失败和重试。只有图片、中文音频、英文音频全部完成后，才允许进入预览导出。

### Step 4：预览导出

预览导出页提供成品检查和基础输出：

- 语言切换：中文、English。
- 翻页预览：显示当前语言台词/旁白和当前页图片。
- 音频播放：播放当前语言语音。
- 整本播放：按页播放，播放时自动翻页。
- 导出入口：本期先提供“导出预览包”入口，可下载图片和音频文件清单；PDF/视频成片导出可作为后续扩展。

## 视觉设计

整体风格跟随现有应用主题变量：

- 使用 `bg-background`、`bg-card`、`border`、`text-foreground`、`text-muted-foreground`、`primary`。
- 支持深色模式，不写死整页黑色或整页浅色。
- 首页生成面板居中，使用轻边框和适度阴影，不做大面积复杂装饰。
- 创作页采用顶部横向步骤条，不使用厚重左侧步骤导航。
- card 圆角保持克制，优先 8px 到 16px，和现有系统一致。
- 操作按钮使用图标加短文案，生成类主按钮使用 primary。
- 所有列表和 card 必须覆盖 loading、empty、error、success 四种状态。

## 数据模型

新增独立表，保留 JSON 状态以降低首期迁移复杂度，同时为列表、权限和恢复提供结构化字段。

### `picture_book_projects`

字段：

- `id uuid primary key`
- `workspace_id uuid not null`
- `team_id uuid not null`
- `user_id uuid not null`
- `title text not null`
- `prompt text not null`
- `style text not null`
- `page_count integer not null`
- `status text not null`
- `active_step text not null`
- `cover_url text null`
- `state jsonb not null`
- `draft_saved_at timestamptz null`
- `estimated_credits integer not null default 0`
- `actual_credits integer not null default 0`
- `is_deleted boolean not null default false`
- `deleted_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

索引：

- `(workspace_id, updated_at desc)`
- `(workspace_id, is_deleted, updated_at desc)`
- `(user_id, updated_at desc)`

`status` 值：

- `draft`
- `script_ready`
- `assets_ready`
- `storyboard_ready`
- `completed`
- `failed`

`draft` 表示可继续编辑的制作中项目，不代表生成失败。任一步骤保存后都保持为草稿或对应 ready 状态。

### `picture_book_project_charges`

用于按项目归集计费记录。底层仍可复用 `task_batches`、`tasks` 和 `credits_ledger` 做冻结/确认/退回，但绘本 UI 和项目详情按该表展示项目维度费用。

字段：

- `id uuid primary key`
- `project_id uuid not null`
- `workspace_id uuid not null`
- `team_id uuid not null`
- `user_id uuid not null`
- `charge_type text not null`
- `model text not null`
- `target_count integer not null`
- `estimated_credits integer not null`
- `actual_credits integer null`
- `status text not null`
- `batch_ids jsonb not null default '[]'`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

`charge_type` 值：

- `script_generate`
- `storyboard_prompt`
- `asset_image`
- `page_image`
- `page_audio_zh`
- `page_audio_en`

`status` 值：

- `pending`
- `processing`
- `completed`
- `partial_failed`
- `failed`
- `refunded`

### `picture_book_project_assets`

用于记录角色、背景和分镜页与生成结果的关系，便于单项重试和资产追踪。

字段：

- `id uuid primary key`
- `project_id uuid not null`
- `kind text not null`
- `ref_id text not null`
- `name text not null`
- `prompt text not null`
- `selected_asset_url text null`
- `selected_asset_id uuid null`
- `batch_id uuid null`
- `status text not null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

`kind` 值：

- `character`
- `background`
- `page_image`
- `page_audio_zh`
- `page_audio_en`

唯一约束：`(project_id, kind, ref_id)`。

`task_batches` 需要增加可选 `picture_book_project_id uuid null` 字段，类似 `video_studio_project_id`，用于历史、资产和任务关联。

## State JSON 结构

`picture_book_projects.state` 保存完整 wizard 状态：

```ts
interface PictureBookState {
  steps: {
    active: 'script' | 'assets' | 'storyboard' | 'preview'
    completed: string[]
  }
  script: {
    summaryZh: string
    pages: Array<{
      id: string
      pageNumber: number
      title: string
      visualDescriptionZh: string
      dialogueZh: string
      dialogueEn: string
    }>
  }
  assets: {
    characters: PictureBookElement[]
    backgrounds: PictureBookElement[]
  }
  storyboard: Array<{
    pageId: string
    pageNumber: number
    imagePrompt: string
    dialogueZh: string
    dialogueEn: string
    imageUrl?: string
    audioZhUrl?: string
    audioEnUrl?: string
    imageStatus: GenerationStatus
    audioZhStatus: GenerationStatus
    audioEnStatus: GenerationStatus
  }>
  settings: {
    style: string
    pageCount: 10 | 15 | 20
    imageModel?: string
    ttsModel?: string
    voiceZhId?: string
    voiceEnId?: string
    billingMode: 'project'
  }
  draft: {
    savedAt?: string
    dirty: boolean
    lastError?: string
  }
}
```

`PictureBookElement`：

```ts
interface PictureBookElement {
  id: string
  name: string
  kind: 'character' | 'background'
  role?: string
  description: string
  prompt: string
  imageUrl?: string
  selectedAssetId?: string
  status: GenerationStatus
}
```

`GenerationStatus`：

```ts
type GenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
```

## API 设计

所有路由挂在 `/api/v1/picture-book`。

### 项目

- `GET /picture-book/projects?workspace_id=&cursor=&limit=`：我的绘本列表。
- `GET /picture-book/projects/recent?workspace_id=&limit=4`：首页最近项目。
- `GET /picture-book/projects/:id`：项目详情。
- `PUT /picture-book/projects/:id`：保存项目 state、标题、封面和步骤。
- `PATCH /picture-book/projects/:id/draft`：轻量保存草稿 state 和 `draft_saved_at`，用于编辑过程自动保存。
- `PATCH /picture-book/projects/:id/name`：改名。
- `DELETE /picture-book/projects/:id`：软删除。
- `POST /picture-book/projects/:id/restore`：恢复。
- `DELETE /picture-book/projects/:id/permanent`：永久删除。

权限逻辑复用 workspace member 校验。`viewer` 无权生成和修改。

### 计费查询

- `GET /picture-book/projects/:id/charges`：获取项目维度计费记录和汇总。

返回包括：

- 项目累计预估积分。
- 项目累计实际消耗积分。
- 各步骤消耗明细。
- 失败/退回记录。

### 文本生成

- `POST /picture-book/script`

入参：

```json
{
  "workspace_id": "uuid",
  "prompt": "一只哈士奇第一次学会帮助朋友",
  "style": "吉卜力风",
  "page_count": 15
}
```

返回：

```json
{
  "project_id": "uuid",
  "title": "哈噜的奇妙朋友",
  "summary_zh": "...",
  "pages": [],
  "characters": [],
  "backgrounds": []
}
```

该接口固定调用 `qwen3.6-plus`，要求返回严格 JSON。生成成功后创建项目草稿并写入 `picture_book_project_charges` 的 `script_generate` 记录。若 JSON 解析失败，返回可重试错误，不创建半成品项目；若项目已创建后失败，项目状态标记为 `failed` 并退回对应项目费用。

### 资产提示词刷新

- `POST /picture-book/projects/:id/asset-prompts`

根据当前剧本重新提炼角色和背景提示词，用于用户重跑提示词，不生成图片。

### 分镜提示词生成

- `POST /picture-book/projects/:id/storyboard-prompts`

根据 Step 1 剧本、Step 2 角色/背景设定和已生成图片 URL，生成每页：

- 图片提示词。
- 中文台词/旁白。
- 英文台词/旁白。

不生成图片和音频。该接口固定调用 `qwen3.6-plus`，费用归集为项目 `storyboard_prompt`。

### 图片生成

- `POST /picture-book/projects/:id/generate-assets`

入参包含目标列表：

```json
{
  "workspace_id": "uuid",
  "targets": [
    { "kind": "character", "ref_id": "char_halu" },
    { "kind": "background", "ref_id": "bg_living_room" }
  ],
  "model": "seedance-2.0"
}
```

后端固定使用 `seedance-2.0` 作为绘本图片生成模型。实现时需要调整 `packages/db/scripts/seed.ts` 中对应模型 seed，使其可被绘本图片生成链路按 `image` 能力读取；不能只在前端写死模型 code。后端为每个目标调用现有图片生成链路，写入 `task_batches.picture_book_project_id`，并更新项目 asset 状态。

- `POST /picture-book/projects/:id/generate-storyboard-images`

批量生成页图片，固定使用 `seedance-2.0`，费用归集为项目 `page_image`。

### TTS 生成

- `POST /picture-book/projects/:id/generate-storyboard-audio`

批量生成中文和英文音频。固定使用 MiniMax `speech-2.8-hd` 模型。为了复用现有同步 TTS 接口，首期按页逐条请求 MiniMax TTS 并落库；如果后续长文本或并发压力变大，再拆成 worker 队列。

入参支持指定语言：

```json
{
  "workspace_id": "uuid",
  "targets": [
    { "page_id": "page_1", "language": "zh" },
    { "page_id": "page_1", "language": "en" }
  ],
  "voice_zh_id": "voice-id",
  "voice_en_id": "voice-id",
  "model": "speech-2.8-hd"
}
```

### 状态刷新

- `POST /picture-book/projects/:id/sync-batches`

前端轮询或显式刷新时，根据未完成 batch 更新 state。也可以复用已有 pending batch watcher 模式。

## 生成与计费

固定模型：

- 剧本生成：`qwen3.6-plus`。
- 脚本拆分/分镜提示词生成：`qwen3.6-plus`。
- 图片生成：`seedance-2.0`。
- 音频生成：MiniMax `speech-2.8-hd`。

seed 调整：

- `packages/db/scripts/seed.ts` 需要确保 `qwen3.6-plus` 是绘本文本生成默认模型。
- `packages/db/scripts/seed.ts` 需要确保 `speech-2.8-hd` 是绘本 TTS 默认模型。
- `packages/db/scripts/seed.ts` 需要为绘本图片生成暴露可用的 `seedance-2.0` 模型能力；当前仓库中 `seedance-2.0` 主要作为视频模型存在，实现时必须补齐绘本图片生成所需的模块、价格和参数读取方式。

计费口径：

- 所有绘本生成费用按 `project_id` 归集。
- 底层可以按单目标创建 batch，便于失败重试和退费；但用户看到的是项目费用总览和步骤费用明细。
- `picture_book_project_charges` 是项目费用展示和追踪入口。

文本生成：

- 剧本生成、资产提示词刷新、分镜提示词生成使用 `qwen3.6-plus`。
- 文本类生成也纳入项目计费，按 `qwen3.6-plus` 在 seed 中配置的价格计算。

图片生成：

- 每个角色、背景、页图片按 `seedance-2.0` 的项目图片价格扣费。
- 批量生成时后端逐目标创建 batch，避免单项失败影响全部状态。
- 图片失败退回对应目标冻结积分。

TTS：

- 中文语音和英文语音分别计费，但归集到同一项目。
- 固定使用 `speech-2.8-hd`，按现有 `/tts/generate` 规则：按字符数向上取整到千字单位乘单价。
- 每页每语言单独记录 batch，便于重试和单项退费。

防重复：

- 生成接口必须要求 `idempotency_key` 或由后端按 `projectId + kind + refId + promptHash + language` 生成幂等 key。
- 前端按钮在提交后进入 loading，禁止重复提交。

## 错误处理

页面状态覆盖：

- 首页项目列表：loading、empty、error、success。
- 剧本生成：生成中、失败重试、JSON 格式错误提示。
- 草稿保存：保存中、已保存、保存失败、本地待同步。
- 资产库：单 card 独立状态，失败项可重试。
- 绘本分镜：图片、中文语音、英文语音状态分开显示。
- 预览导出：缺失图片或音频时显示缺失项，并引导返回对应步骤。

后端错误码：

- `FORBIDDEN`
- `PROJECT_NOT_FOUND`
- `VALIDATION_ERROR`
- `SCRIPT_GENERATION_FAILED`
- `ASSET_PROMPT_FAILED`
- `STORYBOARD_PROMPT_FAILED`
- `INSUFFICIENT_CREDITS`
- `IMAGE_GENERATION_FAILED`
- `TTS_GENERATION_FAILED`
- `BATCH_SYNC_FAILED`

## 测试策略

### 后端

- `packages/types`：新增绘本共享类型测试。
- `packages/db`：迁移类型构建。
- `apps/api`：
  - 项目权限测试。
  - 剧本 JSON 解析测试。
  - 资产/分镜目标校验测试。
  - TTS 批量目标校验测试。
  - 项目费用归集测试。
  - 草稿保存和恢复测试。
  - 积分不足返回 402 测试。

### 前端

- 纯函数测试：
  - 绘本 state normalize。
  - 草稿 dirty/saved 状态。
  - 步骤解锁逻辑。
  - 批量生成目标筛选。
- 页面手测：
  - 首页生成面板。
  - 最近 4 个项目。
  - 剧本轮播 card 编辑。
  - 资产库角色/背景切换与批量生成状态。
  - 绘本分镜图片和双语音频状态。
  - 深色主题适配。

### 构建验证

计划执行：

```bash
pnpm --filter @aigc/types build
pnpm --filter @aigc/db build
pnpm --filter @aigc/api build
pnpm --filter @aigc/web build
```

若实现涉及 worker：

```bash
pnpm --filter @aigc/worker build
```

## 实施顺序

1. 新增共享类型和数据库迁移。
2. 调整 seed：补齐绘本默认模型 `qwen3.6-plus`、`speech-2.8-hd`、`seedance-2.0` 的配置。
3. 新增 API 项目 CRUD、草稿保存和 state 保存。
4. 接入剧本生成接口。
5. 接入资产提示词与分镜提示词接口。
6. 接入角色/背景/页图片批量生成。
7. 接入中英双语 TTS 批量生成。
8. 实现前端首页、项目列表、草稿恢复和项目编辑 wizard。
9. 实现预览导出基础能力。
10. 补充测试、构建和浏览器验证。

## 风险与注意事项

- 批量生成 20 页时，图片和中英双语音频数量多，必须避免一次性阻塞 UI。
- TTS 目前是 API 同步生成，批量生成可能较慢；首期应限制并发，必要时后续迁移到 worker。
- `seedance-2.0` 当前更接近视频生成模型配置，若 provider 实际不支持静态图片输出，需要在实现前确认可用参数或增加绘本专用图片模型映射。
- 英文语音需选择适合英文的系统音色，不能默认复用中文音色。
- 分镜页修改提示词后重生成，会覆盖当前选中结果；需要保留历史可作为后续增强。
- 故事摘要不做双语，脚本结构也不拆中英文；但每页英文台词/旁白必须存在，否则英文预览和英文语音无法完成。
- `.superpowers/brainstorm/` 是本地视觉伴随产物，不应提交到仓库。

## 自检结论

- 无 `TBD` 或未定字段。
- 已明确首页只保留 AI 生成。
- 已明确草稿保存、项目计费、固定模型和 seed 调整要求。
- 已明确故事摘要仅中文，脚本不区分中英文，每页台词/旁白和语音中英双语。
- 已明确角色/背景与绘本分镜是独立步骤页。
- 已明确数据表、API、计费、错误和测试范围。
