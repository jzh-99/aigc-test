import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('assets')
    .addColumn('thumbnail_url', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('assets')
    .dropColumn('thumbnail_url')
    .execute()
}
