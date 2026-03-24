import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add password_change_required column (default false)
  await db.schema
    .alterTable('users')
    .addColumn('password_change_required', 'boolean', (col) => col.defaultTo(false).notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('password_change_required')
    .execute()
}
