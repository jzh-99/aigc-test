import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('teams')
    .addColumn('team_type', 'varchar(50)', (col) => col.notNull().defaultTo('standard'))
    .execute()

  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_team_type CHECK (team_type IN ('standard', 'company_a'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS chk_teams_team_type`.execute(db)
  await db.schema.alterTable('teams').dropColumn('team_type').execute()
}
