import { type Kysely, sql } from 'kysely'

const NEXT_SCHEMA = {
  resolution: ['2k'],
  aspect_ratio: ['1:1', '4:3', '3:4'],
  image: [],
}

const PREVIOUS_SCHEMA = {
  resolution: ['2k'],
  aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  image: [],
}

/**
 * 移除 gpt-image-2 不兼容的 16:9 / 9:16 画幅选项。
 *
 * gpt-image-2 官方使用 size 控制输出尺寸；当前供应商兼容层传 aspect_ratio
 * 时 16:9 / 9:16 会稳定失败，因此先从可选项中隐藏。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET params_schema = ${JSON.stringify(NEXT_SCHEMA)}::jsonb
    WHERE code = 'gpt-image-2'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET params_schema = ${JSON.stringify(PREVIOUS_SCHEMA)}::jsonb
    WHERE code = 'gpt-image-2'
  `.execute(db)
}
