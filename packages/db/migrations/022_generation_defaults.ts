import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('generation_defaults', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('generation_defaults')
    .execute()
}
