# Task Plan — 模型管理功能

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

---

## 阶段一：数据库层
- [x] Task 1: 新增迁移 `031_team_model_configs.ts`
- [x] Task 2: 更新 `packages/db/src/schema.ts`（新增 TeamModelConfigsTable）
- [x] Task 3: 补充 seed 数据（数字人/动作模仿模型入库）

## 阶段二：共享类型
- [x] Task 4: 更新 `packages/types/src/api.ts`（新增 ModelItem、TeamModelConfig 类型）

## 阶段三：API 层
- [x] Task 5: `admin.ts` 新增全局模型管理端点（GET/PATCH /admin/models）
- [x] Task 6: `admin.ts` 新增团队模型配置端点（GET/PUT/DELETE /admin/teams/:id/model-configs）
- [x] Task 7: 新增 `apps/api/src/routes/models.ts`（GET /models?module= 前端动态获取）
- [x] Task 8: `avatar.ts` 改为从 DB 动态读取模型 code
- [x] Task 9: `action-imitation.ts` 改为从 DB 动态读取模型 code
- [x] Task 10: `videos.ts` 积分改为从 DB 读取 credit_cost

## 阶段四：前端层
- [x] Task 11: 新增 `apps/web/src/hooks/use-models.ts`
- [x] Task 12: 新增 `components/admin/model-table.tsx`
- [x] Task 13: 新增 `components/admin/model-edit-dialog.tsx`
- [x] Task 14: 新增 `components/admin/team-model-config.tsx`
- [x] Task 15: 更新 `app/(dashboard)/admin/page.tsx`（新增模型管理 tab）
- [x] Task 16: 更新 `components/admin/team-table.tsx`（新增模型配置入口）
- [x] Task 17: generation-panel.tsx — 保持现状（credits 是展示估算值，API 层已动态化）
- [x] Task 18: use-generate.ts + generation-store.ts — 保持现状（MODEL_CODE_MAP 是 resolution 维度映射，不是模型配置）
- [x] Task 19: video-studio 相关页面 — 保持现状

## 额外修复
- [x] `apps/web/src/lib/api-client.ts` 新增 `apiPut` 函数

## 全部完成 ✅
构建验证：@aigc/types ✅ | @aigc/web ✅ | @aigc/api ✅
