import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 给 provider_models 表新增两个字段：
 * - description: 模型描述文本（对应前端 desc 字段）
 * - video_categories: 视频模型所属分类数组（jsonb），值为 multimodal/frames/components，非视频模型为 null
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS description text`.execute(db)
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS video_categories jsonb`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS video_categories`.execute(db)
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS description`.execute(db)
}
