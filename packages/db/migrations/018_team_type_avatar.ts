import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS chk_teams_team_type`.execute(db)
  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_team_type CHECK (team_type IN ('standard', 'company_a', 'avatar_enabled'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS chk_teams_team_type`.execute(db)
  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_team_type CHECK (team_type IN ('standard', 'company_a'))`.execute(db)
}
