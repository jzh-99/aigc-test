import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('picture_book_projects')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('title', 'text', (col) =>
      col.notNull().defaultTo('未命名绘本')
    )
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('style', 'varchar(100)', (col) => col.notNull())
    .addColumn('page_count', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(30)', (col) =>
      col.notNull().defaultTo('draft')
    )
    .addColumn('active_step', 'varchar(30)', (col) =>
      col.notNull().defaultTo('script')
    )
    .addColumn('cover_url', 'text')
    .addColumn('state', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .addColumn('draft_saved_at', 'timestamptz')
    .addColumn('estimated_credits', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('actual_credits', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('is_deleted', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_projects_page_count CHECK (page_count IN (10,15,20))`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_projects_status CHECK (status IN ('draft','script_ready','assets_ready','storyboard_ready','completed','failed'))`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_projects_active_step CHECK (active_step IN ('script','assets','storyboard','preview'))`.execute(db)

  await db.schema
    .createIndex('idx_picture_book_projects_workspace_updated')
    .on('picture_book_projects')
    .columns(['workspace_id', 'updated_at desc'])
    .execute()

  await db.schema
    .createIndex('idx_picture_book_projects_workspace_deleted')
    .on('picture_book_projects')
    .columns(['workspace_id', 'is_deleted', 'updated_at desc'])
    .execute()

  await db.schema
    .createIndex('idx_picture_book_projects_user_updated')
    .on('picture_book_projects')
    .columns(['user_id', 'updated_at desc'])
    .execute()

  await db.schema
    .createTable('picture_book_project_charges')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('picture_book_projects.id').onDelete('cascade')
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('charge_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('model', 'varchar(100)', (col) => col.notNull())
    .addColumn('target_count', 'integer', (col) => col.notNull())
    .addColumn('estimated_credits', 'integer', (col) => col.notNull())
    .addColumn('actual_credits', 'integer')
    .addColumn('status', 'varchar(30)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('batch_ids', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`)
    )
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`ALTER TABLE picture_book_project_charges ADD CONSTRAINT chk_picture_book_project_charges_status CHECK (status IN ('pending','processing','completed','partial_failed','failed','refunded'))`.execute(db)

  await db.schema
    .createIndex('idx_picture_book_project_charges_project')
    .on('picture_book_project_charges')
    .column('project_id')
    .execute()

  await db.schema
    .createTable('picture_book_project_assets')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('picture_book_projects.id').onDelete('cascade')
    )
    .addColumn('kind', 'varchar(30)', (col) => col.notNull())
    .addColumn('ref_id', 'varchar(100)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('selected_asset_url', 'text')
    .addColumn('selected_asset_id', 'uuid', (col) => col.references('assets.id'))
    .addColumn('batch_id', 'uuid', (col) =>
      col.references('task_batches.id').onDelete('set null')
    )
    .addColumn('status', 'varchar(30)', (col) =>
      col.notNull().defaultTo('idle')
    )
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`ALTER TABLE picture_book_project_assets ADD CONSTRAINT chk_picture_book_project_assets_kind CHECK (kind IN ('character','background','page_image','page_audio_zh','page_audio_en'))`.execute(db)
  await sql`ALTER TABLE picture_book_project_assets ADD CONSTRAINT chk_picture_book_project_assets_status CHECK (status IN ('idle','pending','processing','completed','failed'))`.execute(db)

  await db.schema
    .createIndex('idx_picture_book_project_assets_project')
    .on('picture_book_project_assets')
    .column('project_id')
    .execute()

  await db.schema
    .createIndex('idx_picture_book_project_assets_project_kind_ref')
    .on('picture_book_project_assets')
    .columns(['project_id', 'kind', 'ref_id'])
    .unique()
    .execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('picture_book_project_id', 'uuid', (col) =>
      col.references('picture_book_projects.id').onDelete('set null')
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task_batches')
    .dropColumn('picture_book_project_id')
    .execute()

  await db.schema.dropTable('picture_book_project_assets').ifExists().execute()
  await db.schema.dropTable('picture_book_project_charges').ifExists().execute()
  await db.schema.dropTable('picture_book_projects').ifExists().execute()
}
