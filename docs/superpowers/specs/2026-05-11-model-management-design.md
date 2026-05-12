# 模型管理功能设计文档

**日期**：2026-05-11  
**状态**：待实现

---

## 一、背景与目标

当前系统中，图片、视频、数字人、动作模仿等功能的模型选项全部硬编码在前端文件中，数字人和动作模仿的模型 key 也写死在 API 路由里。`provider_models` 和 `providers` 两张表虽然存在，但只有 `generate.ts` 在校验积分时查询，没有任何管理界面。

本期目标：
1. 在管理后台新增模型管理，admin 可查询和修改全局模型配置
2. 在管理后台团队列表中，admin 可为每个团队单独开启/关闭各模型
3. 前端各功能页面改为动态获取模型列表，不再硬编码

---

## 二、整体架构

```
前端 (apps/web)
  ① 管理后台 → 模型管理 tab（查询/编辑全局模型，按 module 分 tab）
  ② 管理后台 → 团队列表 → 模型配置（团队级开关，按 module 分组）
  ③ 各功能页面改为动态获取模型列表（SWR + 共享 hook）
        ↓ HTTP
API (apps/api)
  ① GET/PATCH /admin/models/*          仅 admin
  ② GET/PUT   /admin/teams/:id/model-configs/*   仅 admin
  ③ GET /models?module=xxx             所有登录用户
        ↓ Kysely
数据库 (packages/db)
  provider_models（现有，全局配置）
  team_model_configs（新增，团队级开关）
```

**数据合并规则**：`GET /models` 返回当前用户所在团队可用的模型。合并逻辑：
- `is_active`：优先用 `team_model_configs.is_active`，无覆盖记录则用 `provider_models.is_active`
- 其他字段（名称、积分等）：全部沿用全局 `provider_models` 的值，团队层面不可修改

---

## 三、数据库变更

### 新增表 `team_model_configs`

```sql
CREATE TABLE team_model_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  model_id    uuid NOT NULL REFERENCES provider_models(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (team_id, model_id)
);

CREATE INDEX idx_team_model_configs_team ON team_model_configs(team_id);
```

### packages/db/src/schema.ts 新增类型

```typescript
export interface TeamModelConfigsTable {
  id: Generated<string>
  team_id: string
  model_id: string
  is_active: boolean
  created_at: Generated<Date>
  updated_at: Generated<Date>
}
```

`Database` 接口新增 `team_model_configs: TeamModelConfigsTable`。

### 数字人和动作模仿模型入库

在 `seed-volcengine.ts` 补充两条 `provider_models` 记录：

| code | name | module | is_active |
|------|------|--------|-----------|
| `jimeng_realman_avatar_picture_omni_v15` | 数字人生成 | `avatar` | true |
| `jimeng_dreamactor_m20_gen_video` | 动作模仿 | `action_imitation` | true |

---

## 四、API 端点设计

### 4.1 全局模型管理（仅 admin）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/admin/models` | 查询所有模型，支持 `?module=` 筛选，含 provider 信息 |
| GET | `/admin/models/:id` | 查询单个模型详情 |
| PATCH | `/admin/models/:id` | 修改模型配置（name、credit_cost、params_pricing、params_schema、is_active） |

### 4.2 团队模型配置（仅 admin）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/admin/teams/:id/model-configs` | 查询该团队所有模型的开关状态（含全局默认值，按 module 分组） |
| PUT | `/admin/teams/:id/model-configs/:modelId` | 设置某模型对该团队的开关（`{ is_active: boolean }`） |
| DELETE | `/admin/teams/:id/model-configs/:modelId` | 删除覆盖记录，恢复为全局默认 |

### 4.3 前端动态获取（所有登录用户）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/models?module=image` | 获取当前用户所在团队可用的模型列表 |

响应结构：
```typescript
interface ModelItem {
  id: string
  code: string
  name: string
  module: string
  credit_cost: number
  params_pricing: unknown
  params_schema: unknown
  is_active: boolean        // 已合并团队覆盖
  provider_code: string
}
```

合并 SQL 逻辑（Kysely）：
```sql
SELECT
  pm.*,
  p.code AS provider_code,
  COALESCE(tmc.is_active, pm.is_active) AS is_active
FROM provider_models pm
JOIN providers p ON p.id = pm.provider_id
LEFT JOIN team_model_configs tmc
  ON tmc.model_id = pm.id AND tmc.team_id = :teamId
WHERE pm.module = :module
  AND COALESCE(tmc.is_active, pm.is_active) = true
```

---

## 五、前端改造范围

### 5.1 管理后台新增组件

| 文件 | 说明 |
|------|------|
| `components/admin/model-table.tsx` | 全局模型列表，按 module 分 tab，支持编辑 |
| `components/admin/model-edit-dialog.tsx` | 编辑模型信息弹窗 |
| `components/admin/team-model-config.tsx` | 团队模型开关配置面板，按 module 分组 |

`app/(dashboard)/admin/page.tsx` 新增"模型管理" tab。  
`components/admin/team-table.tsx` 团队行操作新增"模型配置"入口。

### 5.2 各功能页面动态化

新增共享 hook：`hooks/use-models.ts`，封装 `GET /models?module=xxx` 的 SWR 请求。

| 文件 | 改动 |
|------|------|
| `components/generation/generation-panel.tsx` | 图片/视频模型列表改为 `useModels('image')` / `useModels('video')` |
| `components/canvas/panels/panel-constants.ts` | 移除 `IMAGE_MODEL_OPTIONS`、`VIDEO_MODEL_OPTIONS` 硬编码常量 |
| `hooks/use-generate.ts` | 移除 `MODEL_CODE_MAP`，改为直接使用 API 返回的 `code` |
| `stores/generation-store.ts` | 移除 `MODEL_REVERSE_MAP` |
| `components/video-studio/step-video.tsx` | 视频模型列表改为 `useModels('video')` |
| `components/video-studio/step-characters.tsx` | 图片模型列表改为 `useModels('image')` |

### 5.3 数字人和动作模仿

前端这两个功能**不展示模型选择器**（只有一个模型），但 API 路由改为从数据库动态读取激活的模型 code：

- `apps/api/src/routes/avatar.ts`：移除 `OMNI_REQ_KEY` 硬编码，改为查询 `provider_models` 中 `module='avatar'` 且 `is_active=true` 的第一条记录
- `apps/api/src/routes/action-imitation.ts`：同上，`module='action_imitation'`

---

## 六、packages/types 变更

新增跨应用共享类型：

```typescript
// packages/types/src/api.ts
export interface ModelItem {
  id: string
  code: string
  name: string
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation'
  credit_cost: number
  params_pricing: unknown
  params_schema: unknown
  is_active: boolean
  provider_code: string
}

export interface TeamModelConfig {
  model_id: string
  is_active: boolean
}
```

---

## 七、注意事项

1. **视频生成积分**：`videos.ts` 目前用硬编码的 `VIDEO_CREDITS_MAP` 计算积分，本期需同步改为从 `provider_models.credit_cost` 读取，保持与图片生成逻辑一致。
2. **`params_schema` 字段**：目前 seed 里有定义但未被使用，本期暂不接入参数校验，只做展示和编辑。
3. **缓存**：`GET /models` 是高频接口，建议前端 SWR 设置较长的 `revalidateOnFocus: false`，避免频繁请求。
4. **迁移顺序**：先执行数据库迁移（新增 `team_model_configs` 表），再补充 seed 数据（数字人/动作模仿模型），最后部署 API 和前端。
5. **向后兼容**：前端改为动态获取后，若 API 请求失败，需有降级处理（显示加载态/错误态），不能白屏。
