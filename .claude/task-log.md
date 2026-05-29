# Task Log — Toby Studio AI 短剧模块

## 2026-05-29 — Task 1 共享类型完成

### 执行背景
用户确认采用 Subagent-Driven Development 执行 `docs/superpowers/plans/2026-05-29-short-drama.md`，目标是实现 Toby Studio AI 短剧模块 MVP。当前工作区是隔离 worktree：`.claude/worktrees/short-drama-mvp`。

### 本轮完成内容

**Task 1: Shared Short Drama Types** 已完成：
- 新增 `packages/types/src/short-drama.ts`
- 新增 `packages/types/src/short-drama.test.ts`
- 修改 `packages/types/src/index.ts`
- 修改 `packages/types/package.json`，增加运行测试所需的 `tsx` 和 `@types/node`
- 更新 `pnpm-lock.yaml`

### Review 过程

1. 实现子代理完成初版提交：`31f27b9 feat: add short drama shared types`。
2. spec compliance review 通过，确认 Task 1 必需文件、常量、类型、helper 和测试命令符合规格。
3. code quality review 首轮失败，指出：
   - `SHORT_DRAMA_STYLE_TABS` 混成具体风格，需改为页签 `全部/真人/2D/3D`
   - 模型常量与计划不一致
   - `ShortDramaStepId` 多了设计外的 `export` 步骤
   - `normalizeShortDramaState` 对 nested partial 支持不足，可能丢失合法已有 state
   - `canEnterShortDramaStep` 未充分体现 locks 线性进入逻辑
4. 修复子代理完成修复提交：`2e79360 fix: align short drama shared types`。
5. code quality 复审通过，确认无 Critical / Important / Minor 问题。

### 合并到当前 worktree

子代理使用独立 worktree 完成实现。通过 cherry-pick 合并到当前 `short-drama-mvp` worktree：
- `08218e5 feat: add short drama shared types`
- `87801cd fix: align short drama shared types`

合并后发现 `pnpm-lock.yaml` 因新增包内测试依赖需要同步，已执行 `pnpm install` 并提交：
- `e3bc2b8 chore: sync short drama types lockfile`

### 验证结果

在当前 worktree 执行：
- `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts` ✅ 输出 `✓ All tests passed`
- `pnpm --filter @aigc/types build` ✅ TypeScript 构建成功

### 取舍与注意事项

- 保留 `tsx` 和 `@types/node` 在 `packages/types/package.json` 的 devDependencies，因为计划要求直接运行 `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts`，根目录原本不提供该命令。
- `ShortDramaStepId` 按设计保持三阶段：`script`、`assets`、`episodes`。单集导出属于 `episodes` 阶段内部能力，不作为独立 step。
- `normalizeShortDramaState` 使用 DeepPartial 支持恢复部分 state，避免草稿或 API 返回部分字段时导致合法进度丢失。

### 下一步
进入 Task 2: Database Migration And Schema。需要新增短剧项目主表迁移、必要索引/约束，并同步 DB 类型。继续保持 TDD、小步提交和两阶段 review。

## 2026-05-29 — Task 2 数据库迁移与 schema 完成

### 本轮完成内容

**Task 2: Database Migration And Schema** 已完成：
- 新增 `packages/db/migrations/052_short_drama.ts`
- 修改 `packages/db/src/schema.ts`
- 修改 `packages/db/scripts/seed.ts`

### 实现内容

1. 新增 `short_drama_projects` 表，覆盖短剧项目基础字段、步骤状态、`state jsonb`、积分统计、草稿时间、软删除和时间戳。
2. 添加数据库约束：
   - `aspect_ratio` 仅允许 `9:16`、`16:9`
   - `episode_count` 限制为 `1..50`
   - `status` 限制为短剧项目状态集合
   - `active_step` 限制为 `script/assets/episodes`
3. 添加复合索引以支持列表查询：
   - `workspace_id + updated_at desc`
   - `workspace_id + is_deleted + updated_at desc`
   - `user_id + updated_at desc`
4. 扩展 `task_batches`：
   - `short_drama_project_id`
   - `short_drama_episode_id`
   - `short_drama_segment_id`
5. 同步 Kysely DB 类型：新增 `ShortDramaProjectsTable`，并扩展 `TaskBatchesTable`。
6. 在 seed 中通过现有 `provider_models` 架构加入短剧单集合成导出费用配置，保留可查询 code：`short_drama_episode_export_credits`，费用为 2 A豆。

### Review 过程

1. 实现子代理完成初版提交：`818d8f4 feat: add short drama database schema`，状态 `DONE_WITH_CONCERNS`。
2. spec compliance review 首轮失败，指出：
   - 使用单列索引替代复合索引，不符合计划和现有迁移风格。
   - seed 中费用配置使用 `short-drama-episode-export`，未保留 `short_drama_episode_export_credits` key/code 语义。
3. 修复子代理完成修复提交：`c1ecb928 fix: align short drama database schema`。
4. spec compliance 复审失败，指出迁移文件编号 `037_short_drama.ts` 与现有迁移冲突，需使用 `052_short_drama.ts`。
5. 修复子代理完成迁移编号修复提交：`476ba0c fix: use next short drama migration number`。
6. 将实现和修复 cherry-pick 到当前 worktree 后，再次进行 spec compliance 复审，结论 PASS。
7. code quality review 首轮失败，指出 `down` migration 未显式删除 `up` 创建的 3 个索引，与同类迁移风格不一致。
8. 修复子代理完成修复提交：`efcfbc5 fix: drop short drama indexes in rollback`。
9. 将索引回滚修复 cherry-pick 到当前 worktree 后，code quality 复审通过，确认无新的 Critical / Important 问题。

### 合并到当前 worktree

当前 `short-drama-mvp` worktree 已包含以下 Task 2 提交：
- `d47d6ba feat: add short drama database schema`
- `7dbb552 fix: align short drama database schema`
- `dbc4445 fix: use next short drama migration number`
- `b50d1b2 fix: drop short drama indexes in rollback`

### 验证结果

在当前 worktree 执行：
- `pnpm --filter @aigc/db build` ✅ TypeScript 构建成功

### 取舍与注意事项

- 仓库没有通用 `system_configs` 表，因此短剧导出费用沿用现有 `provider_models` 费用配置架构，但必须保留 `short_drama_episode_export_credits` 作为后续代码可查询的 code/key。
- `down` migration 显式删除索引，虽然 PostgreSQL 删除表时会自动清理索引，但此处按 `026_video_studio_projects.ts`、`030_video_studio_series_projects.ts` 的同类迁移风格保持一致。
- 实现子代理曾在独立 worktree 完成修复；所有最终提交已 cherry-pick 到当前 `short-drama-mvp` worktree。

### 下一步
进入 Task 5: Text Generation API。需要实现剧本摘要、分集梗概、资产提示词和单集分镜文本生成接口，继续保持权限校验、余额预检查、结构化 JSON 校验和状态回写。

## 2026-05-29 — Task 4 项目 CRUD API 完成

### 本轮完成内容

**Task 4: Project CRUD API** 已完成：
- 新增 `apps/api/src/routes/short-drama.ts`
- 新增 `apps/api/src/routes/short-drama/post-projects.ts`
- 新增 `apps/api/src/routes/short-drama/get-projects.ts`
- 新增 `apps/api/src/routes/short-drama/get-project-id.ts`
- 新增 `apps/api/src/routes/short-drama/put-project-id.ts`
- 新增 `apps/api/src/routes/short-drama/delete-project-id.ts`
- 修改 `apps/api/src/app.ts`，注册短剧路由并补充 CORS `PUT` 方法

### 实现内容

1. `POST /short-drama/projects`：创建短剧项目，校验 workspace 写权限、创意、比例和集数，初始化默认 state 并返回 `projectId`。
2. `GET /short-drama/projects`：按 workspace 查询未删除项目，支持 `cursor` 和 `limit`，按 `updated_at desc` 分页，limit 上限 100。
3. `GET /short-drama/projects/recent`：查询最近短剧项目，limit 上限 20。
4. `GET /short-drama/projects/:id`：校验项目访问权限并返回详情。
5. `GET /short-drama/projects/:id/export-status`：返回当前项目 `state.exports`。
6. `PUT /short-drama/projects/:id`：校验写权限，保存 state、标题、封面、状态、active step，并更新草稿时间。
7. `DELETE /short-drama/projects/:id`：校验写权限后执行软删除。
8. 所有短剧 API 统一挂载到 `/api/v1/short-drama/*`，由全局 JWT 插件保护认证。

### Review 过程

1. 实现子代理完成初版提交：`0213e73 feat: add short drama project CRUD routes`。
2. spec compliance review 首轮失败，指出实现子代理 worktree 中 `packages/db/src/schema.ts` 回退了 Task 2 的 `task_batches` 短剧关联字段。
3. 修复子代理恢复字段并提交：`810e53c fix: preserve short drama batch schema fields`。
4. 将实现和修复以 `--no-commit` cherry-pick 到当前 worktree 后，确认当前 worktree 没有 `packages/db/src/schema.ts` diff，避免覆盖已 review 通过的数据层代码。
5. code quality review 首轮指出状态枚举、标题长度魔法数字、`text_model` 说明和 state normalize 返回需要修复；同时指出 auth guard 但经核查全局 `jwt-auth` 已覆盖 `/api/v1/short-drama/*`。
6. 修复子代理在当前 worktree 修复上述实际问题。
7. code quality 复审又指出 CORS methods 缺少 `PUT`，已在 `apps/api/src/app.ts` 中补充。
8. 最终 code quality 复审通过，确认 Task 4 无阻塞性问题。

### 合并到当前 worktree

Task 4 已合并到当前 `short-drama-mvp` worktree：
- `378e724 feat: add short drama project CRUD routes`

### 验证结果

在当前 worktree 执行：
- `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts` ✅ 输出 `✓ All tests passed`
- `pnpm --filter @aigc/types build` ✅ TypeScript 构建成功
- `pnpm --filter @aigc/api build` ✅ TypeScript 构建成功

### 取舍与注意事项

- `text_model` 作为创建项目入参保留以符合 API 设计，但第一版由共享默认模型管理，后端不信任也不使用前端传入模型。
- 短剧路由没有重复添加局部 auth guard，因为全局 `jwt-auth` 插件已对非 PUBLIC_ROUTES 强制认证，`/api/v1/short-drama/*` 不在公开路由列表中。
- 合并时只引入 Task 4 路由和 `app.ts` 注册/CORS 变更，没有覆盖 Task 1/2/3 已 review 通过的共享类型、DB schema 和 API helper。

### 下一步
进入 Task 5: Text Generation API。需要实现剧本摘要、分集梗概、资产提示词和单集分镜文本生成接口，继续保持权限校验、余额预检查、结构化 JSON 校验和状态回写。

## 2026-05-29 — Task 3 API 共享 helper 与测试完成

### 本轮完成内容

**Task 3: API Shared Helpers And Tests** 已完成：
- 新增 `apps/api/src/routes/short-drama/_shared.ts`
- 新增 `apps/api/src/__tests__/short-drama-validation.test.ts`

### 实现内容

1. 新增短剧 API 共享常量：
   - `SHORT_DRAMA_SOURCE_MODULE = 'toby_studio'`
   - `SHORT_DRAMA_SOURCE_FEATURE = 'short_drama'`
   - `SHORT_DRAMA_EXPORT_QUEUE = 'short-drama-export-queue'`
   - `SHORT_DRAMA_EXPORT_COST_KEY = 'short_drama_episode_export_credits'`
2. 新增 JSON 提取 helper，支持从 fenced json code block 或普通字符串中提取首个 JSON object，失败时返回中文可读错误。
3. 新增集数、时长和文本计费 helper，统一后续短剧 API 的基础校验和 A 豆计算。
4. 新增 `makeShortDramaSourceMetadata`，输出 snake_case 来源字段，用于资产库/历史来源隔离。
5. 新增 workspace/project access helper，校验 workspace 未删除、用户 membership、viewer 写权限限制、项目未软删，并返回 normalize 后的 `ShortDramaState`。
6. 新增短剧 validation 单元测试，覆盖 JSON 提取、集数上限、时长档位、文本计费和 source metadata。

### Review 过程

1. 实现子代理完成提交：`4c6d618 feat: add short drama api helpers`。
2. spec compliance review 通过，确认必需常量、函数语义、测试覆盖和验证命令符合 Task 3 规格。
3. code quality review 通过，确认类型安全、访问控制、安全性、可维护性和测试质量达标。
4. review 注意到实现子代理在独立 worktree 中同步了 Task 1/2 基础文件；合并到当前 worktree 时实际只引入 Task 3 新增的 API helper 与测试文件，未覆盖已 review 通过的共享类型和 DB schema。

### 合并到当前 worktree

Task 3 已合并到当前 `short-drama-mvp` worktree：
- `4671d5b feat: add short drama api helpers`

### 验证结果

在当前 worktree 执行：
- `pnpm --filter @aigc/api exec tsx src/__tests__/short-drama-validation.test.ts` ✅ 所有测试通过
- `pnpm --filter @aigc/api build` ✅ TypeScript 构建成功

### 取舍与注意事项

- 当前测试聚焦纯 helper 和 validation，数据库交互型 access helper 未做集成测试；后续 Project CRUD API 会通过路由级测试继续覆盖权限路径。
- `makeShortDramaSourceMetadata` 使用 snake_case 字段，与数据库和资产/历史来源隔离字段保持一致。
- JSON 解析失败统一返回 `AI 返回格式错误，请重试`，避免向前端暴露解析细节；如后续需要排障，应在调用方记录安全日志。

### 下一步
进入 Task 5: Text Generation API。需要实现剧本摘要、分集梗概、资产提示词和单集分镜文本生成接口，继续保持权限校验、余额预检查、结构化 JSON 校验和状态回写。

## 2026-05-29 — Task 4 项目 CRUD API 完成

### 本轮完成内容

**Task 4: Project CRUD API** 已完成：
- 新增 `apps/api/src/routes/short-drama.ts`
- 新增 `apps/api/src/routes/short-drama/post-projects.ts`
- 新增 `apps/api/src/routes/short-drama/get-projects.ts`
- 新增 `apps/api/src/routes/short-drama/get-project-id.ts`
- 新增 `apps/api/src/routes/short-drama/put-project-id.ts`
- 新增 `apps/api/src/routes/short-drama/delete-project-id.ts`
- 修改 `apps/api/src/app.ts`，注册短剧路由并补充 CORS `PUT` 方法

### 实现内容

1. `POST /short-drama/projects`：创建短剧项目，校验 workspace 写权限、创意、比例和集数，初始化默认 state 并返回 `projectId`。
2. `GET /short-drama/projects`：按 workspace 查询未删除项目，支持 `cursor` 和 `limit`，按 `updated_at desc` 分页，limit 上限 100。
3. `GET /short-drama/projects/recent`：查询最近短剧项目，limit 上限 20。
4. `GET /short-drama/projects/:id`：校验项目访问权限并返回详情。
5. `GET /short-drama/projects/:id/export-status`：返回当前项目 `state.exports`。
6. `PUT /short-drama/projects/:id`：校验写权限，保存 state、标题、封面、状态、active step，并更新草稿时间。
7. `DELETE /short-drama/projects/:id`：校验写权限后执行软删除。
8. 所有短剧 API 统一挂载到 `/api/v1/short-drama/*`，由全局 JWT 插件保护认证。

### Review 过程

1. 实现子代理完成初版提交：`0213e73 feat: add short drama project CRUD routes`。
2. spec compliance review 首轮失败，指出实现子代理 worktree 中 `packages/db/src/schema.ts` 回退了 Task 2 的 `task_batches` 短剧关联字段。
3. 修复子代理恢复字段并提交：`810e53c fix: preserve short drama batch schema fields`。
4. 将实现和修复以 `--no-commit` cherry-pick 到当前 worktree 后，确认当前 worktree 没有 `packages/db/src/schema.ts` diff，避免覆盖已 review 通过的数据层代码。
5. code quality review 首轮指出状态枚举、标题长度魔法数字、`text_model` 说明和 state normalize 返回需要修复；同时指出 auth guard 但经核查全局 `jwt-auth` 已覆盖 `/api/v1/short-drama/*`。
6. 修复子代理在当前 worktree 修复上述实际问题。
7. code quality 复审又指出 CORS methods 缺少 `PUT`，已在 `apps/api/src/app.ts` 中补充。
8. 最终 code quality 复审通过，确认 Task 4 无阻塞性问题。

### 合并到当前 worktree

Task 4 已合并到当前 `short-drama-mvp` worktree：
- `378e724 feat: add short drama project CRUD routes`

### 验证结果

在当前 worktree 执行：
- `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts` ✅ 输出 `✓ All tests passed`
- `pnpm --filter @aigc/types build` ✅ TypeScript 构建成功
- `pnpm --filter @aigc/api build` ✅ TypeScript 构建成功

### 取舍与注意事项

- `text_model` 作为创建项目入参保留以符合 API 设计，但第一版由共享默认模型管理，后端不信任也不使用前端传入模型。
- 短剧路由没有重复添加局部 auth guard，因为全局 `jwt-auth` 插件已对非 PUBLIC_ROUTES 强制认证，`/api/v1/short-drama/*` 不在公开路由列表中。
- 合并时只引入 Task 4 路由和 `app.ts` 注册/CORS 变更，没有覆盖 Task 1/2/3 已 review 通过的共享类型、DB schema 和 API helper。

### 下一步
进入 Task 5: Text Generation API。需要实现剧本摘要、分集梗概、资产提示词和单集分镜文本生成接口，继续保持权限校验、余额预检查、结构化 JSON 校验和状态回写。