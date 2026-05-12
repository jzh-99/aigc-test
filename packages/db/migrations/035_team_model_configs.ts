import type { Kysely } from 'kysely'

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('team_model_configs')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(db.fn('gen_random_uuid', [])))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull().references('provider_models.id').onDelete('cascade'))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .execute()

  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_team_model_configs_team_model'
      ) THEN
        ALTER TABLE team_model_configs ADD CONSTRAINT uq_team_model_configs_team_model UNIQUE (team_id, model_id);
      END IF;
    END $$
  `.execute(db)

  await db.schema
    .createIndex('idx_team_model_configs_team')
    .ifNotExists()
    .on('team_model_configs')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_team_model_configs_team').ifExists().execute()
  await db.schema.dropTable('team_model_configs').ifExists().execute()
}
