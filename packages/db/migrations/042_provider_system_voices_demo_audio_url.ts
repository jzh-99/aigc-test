import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 兼容已存在的 provider_system_voices 表。
 * 早期本地库可能已执行过建表迁移，但表内没有 demo_audio_url。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_system_voices ADD COLUMN IF NOT EXISTS demo_audio_url text`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_system_voices DROP COLUMN IF EXISTS demo_audio_url`.execute(db)
}
