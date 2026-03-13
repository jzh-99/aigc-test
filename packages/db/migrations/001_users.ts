import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('email', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('username', 'varchar(100)', (col) => col.unique().notNull())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'varchar(20)', (col) => col.defaultTo('member'))
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('active'))
    .addColumn('plan_tier', 'varchar(20)', (col) => col.defaultTo('free'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute()

  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('admin','member'))`.execute(db)
  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (status IN ('active','suspended','deleted'))`.execute(db)
  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_plan_tier CHECK (plan_tier IN ('free','basic','pro','enterprise'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
