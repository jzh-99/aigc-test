import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('music_tracks')
    .addColumn('lyrics_sections', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('duration_seconds', 'double precision')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('music_tracks')
    .dropColumn('duration_seconds')
    .dropColumn('lyrics_sections')
    .execute()
}
