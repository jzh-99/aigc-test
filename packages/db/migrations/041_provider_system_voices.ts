import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_system_voices')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider_id', 'uuid', (col) => col.notNull().references('providers.id'))
    .addColumn('voice_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('language', 'varchar(100)', (col) => col.notNull())
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('demo_audio_url', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addUniqueConstraint('uq_provider_system_voices_provider_voice', ['provider_id', 'voice_id'])
    .execute()

  await db.schema
    .createIndex('idx_provider_system_voices_provider')
    .on('provider_system_voices')
    .column('provider_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_system_voices').execute()
}
