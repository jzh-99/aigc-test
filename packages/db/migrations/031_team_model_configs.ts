import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('team_model_configs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(db.fn('gen_random_uuid', [])))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull().references('provider_models.id').onDelete('cascade'))
    .addColumn('is_active', 'boolean', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(db.fn('now', [])))
    .execute()

  await db.schema
    .alterTable('team_model_configs')
    .addUniqueConstraint('uq_team_model_configs_team_model', ['team_id', 'model_id'])
    .execute()

  await db.schema
    .createIndex('idx_team_model_configs_team')
    .on('team_model_configs')
    .column('team_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_team_model_configs_team').execute()
  await db.schema.dropTable('team_model_configs').execute()
}
