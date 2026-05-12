import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 扩展 provider_models 表的 module 字段约束，
 * 新增 avatar 和 action_imitation 两个模块类型
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS chk_pm_module`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS chk_pm_module`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)
}
