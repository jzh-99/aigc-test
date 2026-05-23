import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 给图片模型新增生成模式与参考图片数量限制。
 * 文生图固定 0 张参考图，图生图按模型配置限制最大张数。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS image_categories jsonb`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS image_categories`.execute(db)
}
