import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. workspace_members table
  await db.schema
    .createTable('workspace_members')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull().defaultTo('editor'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addUniqueConstraint('uq_workspace_members', ['workspace_id', 'user_id'])
    .execute()

  await sql`ALTER TABLE workspace_members ADD CONSTRAINT chk_ws_member_role CHECK (role IN ('admin','editor','viewer'))`.execute(db)

  await db.schema
    .createIndex('idx_ws_members_user')
    .on('workspace_members')
    .column('user_id')
    .execute()

  // 2. Add credit_quota and credit_used to team_members
  await db.schema
    .alterTable('team_members')
    .addColumn('credit_quota', 'integer')
    .execute()

  await db.schema
    .alterTable('team_members')
    .addColumn('credit_used', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('team_members').dropColumn('credit_used').execute()
  await db.schema.alterTable('team_members').dropColumn('credit_quota').execute()
  await db.schema.dropTable('workspace_members').execute()
}
