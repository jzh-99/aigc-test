import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username)`.execute(db)
}
