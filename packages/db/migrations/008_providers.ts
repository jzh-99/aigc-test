import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // providers
  await db.schema
    .createTable('providers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('code', 'varchar(50)', (col) => col.unique().notNull())
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('region', 'varchar(10)', (col) => col.notNull())
    .addColumn('modules', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('is_active', 'boolean', (col) =>
      col.notNull().defaultTo(true)
    )
    .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .execute()

  await sql`ALTER TABLE providers ADD CONSTRAINT chk_providers_region CHECK (region IN ('cn','global'))`.execute(db)

  // provider_models
  await db.schema
    .createTable('provider_models')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('provider_id', 'uuid', (col) =>
      col.notNull().references('providers.id')
    )
    .addColumn('code', 'varchar(100)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('module', 'varchar(20)', (col) => col.notNull())
    .addColumn('credit_cost', 'integer', (col) => col.notNull())
    .addColumn('params_pricing', 'jsonb', (col) =>
      col.notNull().defaultTo('{}')
    )
    .addColumn('params_schema', 'jsonb', (col) =>
      col.notNull().defaultTo('{}')
    )
    .addColumn('is_active', 'boolean', (col) =>
      col.notNull().defaultTo(true)
    )
    .addUniqueConstraint('uq_provider_models_code', ['provider_id', 'code'])
    .execute()

  await sql`ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)

  await db.schema
    .createIndex('idx_provider_models_provider')
    .on('provider_models')
    .columns(['provider_id'])
    .execute()

  // voice_profiles
  await db.schema
    .createTable('voice_profiles')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('provider', 'varchar(50)', (col) => col.notNull())
    .addColumn('external_voice_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('sample_asset_id', 'uuid', (col) =>
      col.references('assets.id')
    )
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('is_deleted', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE voice_profiles ADD CONSTRAINT chk_vp_status CHECK (status IN ('pending','ready','failed'))`.execute(db)

  // prompt_filter_rules
  await db.schema
    .createTable('prompt_filter_rules')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('pattern', 'text', (col) => col.notNull())
    .addColumn('type', 'varchar(10)', (col) => col.notNull())
    .addColumn('action', 'varchar(10)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', (col) =>
      col.notNull().defaultTo(true)
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE prompt_filter_rules ADD CONSTRAINT chk_pfr_type CHECK (type IN ('keyword','regex'))`.execute(db)
  await sql`ALTER TABLE prompt_filter_rules ADD CONSTRAINT chk_pfr_action CHECK (action IN ('reject','flag'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('prompt_filter_rules').execute()
  await db.schema.dropTable('voice_profiles').execute()
  await db.schema.dropTable('provider_models').execute()
  await db.schema.dropTable('providers').execute()
}
