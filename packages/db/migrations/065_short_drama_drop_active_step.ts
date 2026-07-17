import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 去掉 short_drama_projects.active_step 列，步骤状态统一由 state JSONB 的
 * state.steps.active 承载（前端 stepper / 页面内容 / 轮询的唯一依据）。
 *
 * 背景：active_step 列与 state.steps.active 是冗余双数据源，曾因 PUT 只更新列、
 * 漏写 state.steps.active 导致步骤切换失效。去掉列根治双数据源不一致隐患。
 * state.steps.active 经 normalizeShortDramaState 始终有值，列数据可安全丢弃。
 *
 * 注意：060_db_comments.ts:553 对该列的 COMMENT 随 DROP COLUMN 自动清除，无需单独处理。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE short_drama_projects DROP CONSTRAINT IF EXISTS chk_short_drama_active_step`.execute(db)
  await sql`ALTER TABLE short_drama_projects DROP COLUMN active_step`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 回填：从 state.steps.active 取值，保证回滚后列数据与 state 一致
  await sql`ALTER TABLE short_drama_projects ADD COLUMN active_step varchar(30)`.execute(db)
  await sql`UPDATE short_drama_projects SET active_step = COALESCE(state->'steps'->>'active', 'script')`.execute(db)
  await sql`ALTER TABLE short_drama_projects ALTER COLUMN active_step SET NOT NULL`.execute(db)
  await sql`ALTER TABLE short_drama_projects ALTER COLUMN active_step SET DEFAULT 'script'`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_active_step CHECK (active_step IN ('script','assets','episodes'))`.execute(db)
}
