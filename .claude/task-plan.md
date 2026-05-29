# Task Plan — Toby Studio AI 短剧模块

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

---

## 实施计划来源
- 设计文档：`docs/superpowers/specs/2026-05-29-short-drama-design.md`
- 实施计划：`docs/superpowers/plans/2026-05-29-short-drama.md`
- 执行模式：Subagent-Driven Development，每个任务实现后先做 spec compliance review，再做 code quality review。
- 工作区：`.claude/worktrees/short-drama-mvp`

---

## 阶段一：共享类型与数据层
- [x] Task 1: Shared Short Drama Types — 新增 `packages/types/src/short-drama.ts`、测试与导出
- [x] Task 2: Database Migration And Schema — 新增 `short_drama_projects` 迁移与 DB 类型

## 阶段二：API 基础与项目 CRUD
- [~] Task 3: API Shared Helpers And Tests
- [ ] Task 4: Project CRUD API

## 阶段三：生成、资产、同步与导出 API
- [ ] Task 5: Text Generation API
- [ ] Task 6: Asset Image, Upload, Segment Video, And Sync API
- [ ] Task 7: Export API And Worker Queue Types

## 阶段四：Worker
- [ ] Task 8: Export Worker

## 阶段五：前端基础与首页
- [ ] Task 9: Frontend API, Styles, And Project Hook
- [ ] Task 10: Short Drama Home Page

## 阶段六：制作页与单集编辑
- [ ] Task 11: Project Editor Steps
- [ ] Task 12: Episode Editor UI

## 阶段七：隔离、文档与验证
- [ ] Task 13: Asset And History Source Isolation
- [ ] Task 14: Documentation, Full Verification, And Cleanup

---

## 当前进度
- Task 1 已完成并通过两阶段 review。
- Task 1 合并到当前 worktree 的提交：
  - `08218e5 feat: add short drama shared types`
  - `87801cd fix: align short drama shared types`
  - `e3bc2b8 chore: sync short drama types lockfile`
- Task 1 验证命令：
  - `pnpm --filter @aigc/types exec tsx src/short-drama.test.ts` ✅
  - `pnpm --filter @aigc/types build` ✅
- Task 2 已完成并通过两阶段 review。
- Task 2 合并到当前 worktree 的提交：
  - `d47d6ba feat: add short drama database schema`
  - `7dbb552 fix: align short drama database schema`
  - `dbc4445 fix: use next short drama migration number`
  - `b50d1b2 fix: drop short drama indexes in rollback`
- Task 2 验证命令：
  - `pnpm --filter @aigc/db build` ✅

## 下一步
- Task 3: API Shared Helpers And Tests — 新增短剧 API 共享 helper、fixture 和基础测试。