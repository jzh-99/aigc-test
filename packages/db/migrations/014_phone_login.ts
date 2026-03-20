import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Make email nullable (existing accounts keep their email)
  await db.schema
    .alterTable('users')
    .alterColumn('email', (col) => col.dropNotNull())
    .execute()

  // Add phone column (nullable, unique)
  await db.schema
    .alterTable('users')
    .addColumn('phone', 'varchar(20)', (col) => col.unique())
    .execute()

  // Add account column as nullable first so we can backfill
  await db.schema
    .alterTable('users')
    .addColumn('account', 'varchar(254)', (col) => col.unique())
    .execute()

  // Backfill account from email for existing users
  await sql`UPDATE users SET account = email WHERE account IS NULL AND email IS NOT NULL`.execute(db)

  // Now add NOT NULL constraint
  await sql`ALTER TABLE users ALTER COLUMN account SET NOT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').dropColumn('account').execute()
  await db.schema.alterTable('users').dropColumn('phone').execute()
  await db.schema
    .alterTable('users')
    .alterColumn('email', (col) => col.setNotNull())
    .execute()
}
