# provider_models.avatar + 移除 @lobehub/icons 设计

> 日期：2026-06-13
> 状态：待评审
> 任务等级：L2（数据库加字段 + 前端渲染链路改造）

## 1. 背景与目标

当前模型图标依赖 `@lobehub/icons` 第三方库，通过 `model-images.ts` 里的映射表 + `ModelIcon`/`ProviderIcon` 组件渲染。该库体积大（需 `next/dynamic` 异步加载避免进首屏 bundle），且图标风格与品牌资源不可控。

**目标**：

1. 在 `provider_models` 表增加 `avatar` 字段，模型图标改为从数据库读取自托管图片。
2. 移除 `@lobehub/icons`（及无直接引用的 `@lobehub/ui`）依赖。
3. 图标资源由运营提供，已上传 TOS（`assets/llm/*.png`）。

## 2. 范围边界

**本次做**：

- DB 迁移新增 `provider_models.avatar` 字段（`TEXT NULL`）。
- 打通 `DB → API → 类型 → 前端组件` 的 avatar 数据链路。
- seed 脚本为 image/video 模块的模型填充 avatar。
- admin 后台模型编辑弹窗支持编辑 avatar。
- 移除 `@lobehub/icons` 与 `@lobehub/ui` 依赖及相关代码。

**本次不做**（排除项）：

- 不采用 L3-A「供应商凭据落库 + 模型切换」大计划，仅做本次图标字段改造。
- 不新增 `providers.logo_url` 字段（avatar 放在模型级，见下方决策）。
- 不为 avatar 单独做上传组件（admin 编辑用文本输入 URL + 预览）。
- 不改动非 image/video 模块（tts/music/agent/数字人/动作模仿）的图标——这些模型不填 avatar，走统一占位图标。

## 3. 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| avatar 放在哪张表 | `provider_models`（模型级）| 同一 provider 下存在不同品牌模型（如 `gpt-image-2` 挂在 nano-banana provider 下却用 OpenAI 图标），必须按 model code 粒度映射，不能按 provider。|
| 兜底策略 | 统一占位图标（lucide `Sparkles`）| 没填 avatar 的模型统一显示占位图标，彻底摆脱 lobehub。|
| URL 存储格式 | **方案 A：DB 存完整存储 URL**，seed 用 `TOS_PUBLIC_URL` + key 动态拼接 | 与项目惯例（avatar_url / demo_audio_url / storage_url 均存完整 URL）一致；signAssetUrl 直接处理；dev/prod 通过环境变量自动适配。|
| 维护方式 | seed 填充 + admin 后台可编辑 | seed 覆盖初始数据，admin 支持后续调整。|

### 3.1 方案 A 落地细节

DB 字段存完整公网存储 URL，例如：

```
https://toby-ai-dev.tos-cn-shanghai.volces.com/assets/llm/openai.png
```

- API `/models` 响应时用 `signAssetUrl(avatar)` 签名后返回前端（与 avatar_url/demo_audio_url 机制一致）。
- API `/admin/models` 返回**原始存储 URL**（供编辑回显，不签名）。
- seed 拼接方式：`avatar: \`${process.env.TOS_PUBLIC_URL}/assets/llm/<icon>.png\``，运行时按目标环境的 `TOS_PUBLIC_URL`（dev=toby-ai-dev，prod=toby-ai-prod）自动生成正确域名，无需写死。

## 4. 数据链路

**现状**：

```
DB provider_models (无 avatar)
  → API /models (select pm 字段 + p.code as provider_code)
  → ModelItem (有 provider_code, 无 avatar)
  → useModels hook
  → ModelBrandIcon (modelCode + providerCode → @lobehub/icons 渲染)
```

**目标**：

```
DB provider_models.avatar (完整存储 URL)
  → API /models (select pm.avatar + signAssetUrl 签名)
  → ModelItem.avatar (签名后 URL)
  → useModels hook
  → ModelBrandIcon (avatar → <img>; 无 → Sparkles 占位)
```

## 5. 详细改动清单（7 层）

### 5.1 DB 层（packages/db）

- 新增迁移 `062_provider_models_avatar.ts`：
  ```sql
  ALTER TABLE provider_models ADD COLUMN avatar TEXT NULL;
  ```
- [schema.ts](packages/db/src/schema.ts) `ProviderModelsTable` 新增 `avatar: string | null`。

### 5.2 类型层（packages/types）

- [api.ts](packages/types/src/api.ts) `ModelItem` 新增 `avatar: string | null`。
- 构建 `@aigc/types` 包（下游应用依赖）。

### 5.3 API 层（apps/api）

- [`/models`](apps/api/src/routes/models/get.ts)：select 加 `pm.avatar`；响应 map 时 `avatar: await signAssetUrl(r.avatar)` 签名。
- [`/admin/models`](apps/api/src/routes/admin/get-models.ts)：select 加 `pm.avatar`，返回原始 URL（编辑回显用）。
- [`/admin/models/:id`](apps/api/src/routes/admin/patch-models-id.ts) PATCH：Body 加 `avatar?: string | null`，`updates.avatar = avatar ?? null`。

### 5.4 数据填充（packages/db seed.ts）

- 在 image/video 模块的 model 对象上新增 `avatar` 字段，insert 的 `values` 与 `onConflict.doUpdateSet` 同步加上 `avatar`。
- 填充规则见第 6 节映射表。
- seed 拼接用 `process.env.TOS_PUBLIC_URL`（运行环境已配置）。

### 5.5 前端渲染（apps/web）

- [model-brand-icon.tsx](apps/web/src/components/generation/shared/model-brand-icon.tsx)：
  - props 改为 `{ avatar?: string | null; modelCode: string; size: number }`：保留 modelCode 仅用于 `<img alt>` 无障碍标签，移除 providerCode（不再需要 lobehub 映射）。
  - 有 `avatar` → 渲染 `<img src={avatar} />`（带 width/height、object-contain、alt）。
  - 无 `avatar` → 渲染 lucide `Sparkles` 占位图标。
  - **删除全部 `@lobehub/icons` 导入**。
- [image-panel.tsx](apps/web/src/components/generation/image/image-panel.tsx) / [video-panel.tsx](apps/web/src/components/generation/video/video-panel.tsx)：
  - 调用处改为 `<ModelBrandIcon avatar={m.avatar} size={...} />`。
  - `next/dynamic` 异步加载改回普通 `import`（已无重依赖，简化首屏逻辑）。
- [model-images.ts](apps/web/src/lib/model-images.ts)：删除全部 lobehub 导入与映射表（`MODEL_DIRECT_ICONS` / `MODEL_TO_ICON_PROVIDER`）。该文件不再被引用，可直接删除。

### 5.6 admin 编辑（apps/web）

- [model-edit-dialog.tsx](apps/web/src/components/admin/model-edit-dialog.tsx)：
  - 新增 avatar 输入框（`Input` 文本框 + 旁边小图预览）。
  - state 增加 `avatar`，`useEffect` 初始化 `setAvatar(model.avatar ?? '')`。
  - `handleSubmit` 的 PATCH body 增加 `avatar: avatar.trim() || null`。

### 5.7 依赖移除

- [apps/web/package.json](apps/web/package.json)：移除 `@lobehub/icons`（`@lobehub/ui` 经 grep 确认无任何直接引用，一并移除）。
- 执行 `pnpm install` 更新 lockfile。

## 6. avatar 模型级映射表

> 资源目录：`assets/llm/`，域名由 `TOS_PUBLIC_URL` 提供。

| model code | 图标文件 | 模块 | 所属 provider（seed）|
|---|---|---|---|
| `gemini-3.1-flash-image-preview` | `nanoBanana.png` | image | nano-banana |
| `nano-banana-2` | `nanoBanana.png` | image | nano-banana |
| `gpt-image-2` | `openai.png` | image | nano-banana ⚠️ |
| `seedream-5.0-lite` | `volcengine.png` | image | volcengine |
| `seedream-4.5` | `volcengine.png` | image | volcengine |
| `seedream-4.0` | `volcengine.png` | image | volcengine |
| `seedance-1.5-pro` | `volcengine.png` | video | volcengine |
| `seedance-2.0` | `volcengine.png` | video | volcengine |
| `seedance-2.0-fast` | `volcengine.png` | video | volcengine |

⚠️ `gpt-image-2` 虽挂在 nano-banana provider 下，但品牌图标为 OpenAI，正是「模型级映射」的核心例证。

其余模型（qwen agent、comfly、jimeng 数字人/动作模仿、mureka music、minimax tts）**不填 avatar**，统一显示占位图标。

## 7. 风险与注意事项

1. **迁移顺序**：`062_provider_models_avatar.ts` 必须在所有读 `provider_models` 的代码部署前执行，否则 API select `pm.avatar` 会因列不存在报错。API 与 DB 迁移需配套上线。
2. **签名性能**：`/models` 列表对每条记录 `signAssetUrl`，建议用 `Promise.all` 并行（参考 system-voices 的写法），避免串行阻塞。
3. **环境变量依赖**：seed 拼接 avatar 依赖 `process.env.TOS_PUBLIC_URL`，需保证 seed 运行环境已配置该变量，否则生成 `undefined/assets/...`。实现时做存在性校验或回退。
4. **图片加载失败**：`<img>` 渲染需处理 `onError`——图片加载失败时回退到占位图标，避免显示裂图。
5. **类型包重建**：修改 `packages/types` 后需 `pnpm --filter @aigc/types build`，否则下游应用拿不到新字段类型。
6. **CLAUDE.md 本地验证边界**：前端改动完成后即结束，不执行构建/刷新/重启等后续预览动作。

## 8. 验证要点

- [ ] 迁移执行成功，`provider_models.avatar` 列存在。
- [ ] seed 后，image/video 模块模型 avatar 已填，其余为 NULL。
- [ ] `/models` 返回的 avatar 为签名 URL，前端 `<img>` 正常显示图标。
- [ ] 无 avatar 的模型显示 `Sparkles` 占位图标。
- [ ] admin 编辑弹窗可修改 avatar 并保存生效。
- [ ] 全仓库 grep `@lobehub` 无残留引用，依赖已从 package.json 移除。
- [ ] `pnpm lint` 通过。
