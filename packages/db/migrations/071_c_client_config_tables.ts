import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const defaultClientScopes = sql`ARRAY['mini_program', 'enterprise', 'screen']::text[]`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('creation_templates')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('cover_url', 'text')
    .addColumn('work_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('client_scopes', sql`text[]`, (col) => col.notNull().defaultTo(defaultClientScopes))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute()

  await db.schema
    .createTable('daily_news')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('summary', 'text')
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('source', 'varchar(255)')
    .addColumn('published_at', 'timestamptz')
    .addColumn('client_scopes', sql`text[]`, (col) => col.notNull().defaultTo(defaultClientScopes))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute()

  await db.schema
    .createTable('prompt_inspirations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('word', 'varchar(255)', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('work_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('client_scopes', sql`text[]`, (col) => col.notNull().defaultTo(defaultClientScopes))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute()

  await db.schema
    .createTable('music_styles')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('style_key', 'varchar(100)', (col) => col.notNull())
    .addColumn('client_scopes', sql`text[]`, (col) => col.notNull().defaultTo(defaultClientScopes))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addUniqueConstraint('uq_music_styles_style_key', ['style_key'])
    .execute()

  await db.schema
    .createTable('mini_user_auth_records')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('openid', 'varchar(128)', (col) => col.notNull())
    .addColumn('unionid', 'varchar(128)')
    .addColumn('auth_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('auth_scope', 'varchar(100)', (col) => col.notNull())
    .addColumn('auth_status', 'varchar(30)', (col) => col.notNull().defaultTo('authorized'))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('authorized_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .execute()

  await sql`ALTER TABLE mini_user_auth_records ADD CONSTRAINT chk_mini_user_auth_records_status CHECK (auth_status IN ('authorized', 'revoked'))`.execute(db)

  await db.schema
    .createTable('mini_user_push_rules')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('openid', 'varchar(128)')
    .addColumn('scene', 'varchar(100)', (col) => col.notNull())
    .addColumn('template_id', 'varchar(255)')
    .addColumn('is_enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addUniqueConstraint('uq_mini_user_push_rules_user_scene', ['user_id', 'scene'])
    .execute()

  await sql`ALTER TABLE provider_system_voices ADD COLUMN client_scopes text[] NOT NULL DEFAULT ARRAY['mini_program', 'enterprise', 'screen']::text[]`.execute(db)
  await db.schema
    .alterTable('provider_system_voices')
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS chk_teams_team_type`.execute(db)
  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_team_type CHECK (team_type IN ('standard', 'company_a', 'avatar_enabled', 'personal'))`.execute(db)

  await db.schema.createIndex('idx_creation_templates_scope_active').on('creation_templates').columns(['is_active', 'sort_order']).execute()
  await db.schema.createIndex('idx_daily_news_active_published').on('daily_news').columns(['is_active', 'published_at desc']).execute()
  await db.schema.createIndex('idx_prompt_inspirations_active_order').on('prompt_inspirations').columns(['is_active', 'sort_order']).execute()
  await db.schema.createIndex('idx_music_styles_active_order').on('music_styles').columns(['is_active', 'sort_order']).execute()
  await db.schema.createIndex('idx_mini_user_auth_records_openid').on('mini_user_auth_records').column('openid').execute()
  await db.schema.createIndex('idx_mini_user_push_rules_user').on('mini_user_push_rules').column('user_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM teams WHERE team_type = 'personal') THEN
        RAISE EXCEPTION 'Cannot rollback 071_c_client_config_tables while personal teams exist';
      END IF;
    END $$;
  `.execute(db)

  await sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS chk_teams_team_type`.execute(db)
  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_team_type CHECK (team_type IN ('standard', 'company_a', 'avatar_enabled'))`.execute(db)

  await db.schema.alterTable('provider_system_voices').dropColumn('sort_order').execute()
  await db.schema.alterTable('provider_system_voices').dropColumn('client_scopes').execute()

  await db.schema.dropTable('mini_user_push_rules').ifExists().execute()
  await db.schema.dropTable('mini_user_auth_records').ifExists().execute()
  await db.schema.dropTable('music_styles').ifExists().execute()
  await db.schema.dropTable('prompt_inspirations').ifExists().execute()
  await db.schema.dropTable('daily_news').ifExists().execute()
  await db.schema.dropTable('creation_templates').ifExists().execute()
}
