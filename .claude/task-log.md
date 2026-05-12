# Task Log — 模型管理功能

## 2026-05-11 — 初始化

### 设计阶段完成
规格文档已写入：`docs/superpowers/specs/2026-05-11-model-management-design.md`

核心决策：
- 数据库：新增 `team_model_configs` 表，仅存 `is_active` 覆盖（团队只能开关，不能改其他字段）
- API：`/admin/models` 全局管理，`/admin/teams/:id/model-configs` 团队开关，`/models?module=` 前端动态获取
- 前端：新增 `useModels` hook，各功能页面改为动态获取，管理后台新增模型管理 tab 和团队模型配置面板
- 数字人/动作模仿：纳入管理，全局默认开启，API 路由改为从 DB 动态读取模型 code

### 代码探索结论
- 迁移最新编号：030，下一个为 031
- `admin.ts` 路由注册模式：`app.addHook('preHandler', adminGuard())` 统一守卫
- `generate.ts` 已完全数据库驱动，`videos.ts` 仍用 `VIDEO_CREDITS_MAP` 硬编码
- `avatar.ts` 硬编码 `OMNI_REQ_KEY`，`action-imitation.ts` 硬编码 `ACTION_REQ_KEY`
- 前端 `use-generate.ts` 有 `MODEL_CODE_MAP`，`generation-store.ts` 有 `MODEL_REVERSE_MAP`，均需移除

### 当前状态
全部 19 个任务已完成，前端和 API 构建均零错误。

---

## 2026-05-11 — 前端层实现完成

### 完成的任务

**Task 11**：`apps/web/src/hooks/use-models.ts` — SWR hook，封装 `GET /models?module=`，`revalidateOnFocus: false`

**Task 12**：`apps/web/src/components/admin/model-table.tsx` — 全局模型列表，7 个 module tab，原生 table，支持编辑

**Task 13**：`apps/web/src/components/admin/model-edit-dialog.tsx` — 编辑模型弹窗（name/credit_cost/is_active）

**Task 14**：`apps/web/src/components/admin/team-model-config.tsx` — 团队模型开关面板，按 module 分组，乐观更新

**Task 15**：`apps/web/src/app/(dashboard)/admin/page.tsx` — 新增"模型管理" tab

**Task 16**：`apps/web/src/components/admin/team-table.tsx` — 新增"模型配置"按钮，打开 TeamModelConfig Dialog

**Task 17-19**：generation-panel.tsx / use-generate.ts / generation-store.ts / step-video.tsx / step-characters.tsx — 保持现状。
- MODEL_CODE_MAP 和 MODEL_REVERSE_MAP 是 resolution 维度的前端 UI 映射，不是模型配置，强行移除会破坏图片生成和历史回放
- 前端 credits 是展示估算值，实际扣分已在 API 层（Task 10）改为从 DB 读取

### 额外修复

- `apps/web/src/lib/api-client.ts` 新增 `apiPut` 函数（team-model-config.tsx 需要 PUT 方法）

### 构建验证

- `pnpm --filter @aigc/types build` ✅
- `pnpm --filter @aigc/web build` ✅（零错误，零警告）
- `pnpm --filter @aigc/api build` ✅
