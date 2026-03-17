import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // teams: add soft delete fields
  await db.schema
    .alterTable('teams')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
  await db.schema
    .alterTable('teams')
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  // workspaces: add soft delete fields
  await db.schema
    .alterTable('workspaces')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
  await db.schema
    .alterTable('workspaces')
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  // assets: already has is_deleted, add deleted_at
  await db.schema
    .alterTable('assets')
    .addColumn('deleted_at', 'timestamptz')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('assets').dropColumn('deleted_at').execute()
  await db.schema.alterTable('workspaces').dropColumn('deleted_at').execute()
  await db.schema.alterTable('workspaces').dropColumn('is_deleted').execute()
  await db.schema.alterTable('teams').dropColumn('deleted_at').execute()
  await db.schema.alterTable('teams').dropColumn('is_deleted').execute()
}
