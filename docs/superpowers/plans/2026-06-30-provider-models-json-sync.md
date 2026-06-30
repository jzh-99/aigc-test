# Provider Models JSON Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 `models.json` 初始化 `provider_models`，并支持业管单模型规格回调同步。

**Architecture:** 新增一个共享转换模块承接 `models.json` 与 Toby 回调两种输入。数据库把 `provider_models.provider_id` 迁移为 `provider_code`，查询用 `provider_code = providers.code` 逻辑关联。

**Tech Stack:** TypeScript、Kysely、Fastify、node:test、pnpm。

---

### Task 1: 文档与任务记录

**Files:**
- Create: `docs/superpowers/specs/2026-06-30-provider-models-json-sync-design.md`
- Create: `docs/superpowers/plans/2026-06-30-provider-models-json-sync.md`
- Modify: `.claude/task-log.md`
- Modify: `.claude/task-plan.md`

- [ ] 记录目标、设计、任务拆解和验证范围。

### Task 2: 转换模块 TDD

**Files:**
- Create: `packages/db/src/provider-models-json.ts`
- Create: `packages/db/src/provider-models-json.test.ts`

- [ ] 先写失败测试：验证 `modelCode/modelName/modelProvider/modelType/paramsSchema/paramsPricing` 转成 DB 行。
- [ ] 运行 `pnpm --filter @aigc/db exec tsx --test src/provider-models-json.test.ts`，确认因模块不存在失败。
- [ ] 实现最小转换逻辑。
- [ ] 再写旧版 Toby `params` 转换测试并实现。
- [ ] 再写非法 `modelType` 测试并实现。

### Task 3: 数据库迁移与 schema

**Files:**
- Create: `packages/db/migrations/080_provider_models_provider_code.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/provider-models-provider-code-migration.test.ts`

- [ ] 先写迁移源码断言测试。
- [ ] 新增迁移：添加并回填 `provider_code`、替换唯一键和索引、删除 `provider_id`。
- [ ] 更新 `ProviderModelsTable` 类型。

### Task 4: seed 改为 JSON 数据源

**Files:**
- Modify: `packages/db/scripts/seed.ts`

- [ ] 引入转换模块和 `models.json` 读取。
- [ ] 清空旧 `provider_models` 后插入 JSON 转换结果。
- [ ] 移除或跳过旧硬编码 `provider_models` 初始化块，保留 `providers` 与系统音色。

### Task 5: API 查询和生成链路改 provider_code

**Files:**
- Modify: `apps/api/src/routes/models/get.ts`
- Modify: `apps/api/src/routes/admin/get-models.ts`
- Modify: `apps/api/src/routes/admin/get-models-id.ts`
- Modify: `apps/api/src/routes/admin/get-teams-id-model-configs.ts`
- Modify: `apps/api/src/routes/generate/post-image.ts`
- Modify: `apps/api/src/routes/videos/post-generate.ts`
- Modify: `apps/api/src/routes/tts/post-generate.ts`
- Modify: `apps/api/src/routes/music/_shared.ts`
- Modify: `apps/api/src/routes/short-drama/post-generate-assets.ts`
- Modify: `apps/api/src/routes/short-drama/post-generate-segment-video.ts`

- [ ] 把 `providers.id = provider_models.provider_id` 改为 `providers.code = provider_models.provider_code`。
- [ ] 所有选择 `provider_code` 的接口直接返回 `pm.provider_code` 或保持 join 后返回一致值。

### Task 6: Toby 回调 upsert

**Files:**
- Modify: `apps/api/src/routes/external/toby/post-specification-config.ts`

- [ ] 解密验签后调用转换模块。
- [ ] 按 `(provider_code, code)` upsert `provider_models`。
- [ ] 返回 Toby 入站加密成功响应。

### Task 7: 验证

**Commands:**
- `pnpm --filter @aigc/db exec tsx --test src/provider-models-json.test.ts src/provider-models-provider-code-migration.test.ts`
- `pnpm --filter @aigc/db build`
- `pnpm --filter @aigc/api build`

- [ ] 修复类型错误。
- [ ] 汇总无法执行的验证和风险。
