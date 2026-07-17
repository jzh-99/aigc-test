import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 将图片/视频模型的参考素材限制统一到 category_references。
 * 以 video_categories 的完整 limits 结构为准，迁移完成后删除旧字段。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS category_references jsonb`.execute(db)

  await sql`
    UPDATE provider_models
    SET category_references = video_categories
    WHERE module = 'video'
      AND video_categories IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET category_references = jsonb_build_object(
      'image_to_image',
      jsonb_build_object(
        'label', COALESCE(image_categories->'image_to_image'->>'label', '图生图'),
        'limits', jsonb_build_object(
          'image', COALESCE(image_categories->'image_to_image'->'limits'->'image', jsonb_build_object('min', 0, 'max', 0)),
          'video', jsonb_build_object('min', 0, 'max', 0),
          'audio', jsonb_build_object('min', 0, 'max', 0)
        )
      )
    )
    WHERE module = 'image'
      AND image_categories IS NOT NULL
  `.execute(db)

  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS video_categories`.execute(db)
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS image_categories`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS video_categories jsonb`.execute(db)
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS image_categories jsonb`.execute(db)

  await sql`
    UPDATE provider_models
    SET video_categories = category_references
    WHERE module = 'video'
      AND category_references IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE provider_models
    SET image_categories = category_references
    WHERE module = 'image'
      AND category_references IS NOT NULL
  `.execute(db)

  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS category_references`.execute(db)
}
