import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 给 provider_models 表新增 resolution 字段：
 * - resolution: 模型默认分辨率标识（如 "720p"、"1080p"），可空
 *   用于 params_pricing 规则匹配的默认值，也可由请求 params.resolution 覆盖
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS resolution text`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS resolution`.execute(db)
}
