import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add quota_period and quota_reset_at to team_members
  await db.schema
    .alterTable('team_members')
    .addColumn('quota_period', 'varchar(10)')
    .execute()

  await db.schema
    .alterTable('team_members')
    .addColumn('quota_reset_at', 'timestamptz')
    .execute()

  await sql`ALTER TABLE team_members ADD CONSTRAINT chk_tm_quota_period CHECK (quota_period IS NULL OR quota_period IN ('weekly','monthly'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE team_members DROP CONSTRAINT IF EXISTS chk_tm_quota_period`.execute(db)
  await db.schema.alterTable('team_members').dropColumn('quota_reset_at').execute()
  await db.schema.alterTable('team_members').dropColumn('quota_period').execute()
}
