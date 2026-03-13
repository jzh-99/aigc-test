import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // task_batches
  await db.schema
    .createTable('task_batches')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id')
    )
    .addColumn('credit_account_id', 'uuid', (col) =>
      col.notNull().references('credit_accounts.id')
    )
    .addColumn('parent_batch_id', 'uuid', (col) =>
      col.references('task_batches.id').onDelete('set null')
    )
    .addColumn('idempotency_key', 'varchar(64)', (col) =>
      col.unique().notNull()
    )
    .addColumn('module', 'varchar(20)', (col) => col.notNull())
    .addColumn('provider', 'varchar(50)', (col) => col.notNull())
    .addColumn('model', 'varchar(100)', (col) => col.notNull())
    .addColumn('prompt', 'text', (col) => col.notNull())
    .addColumn('params', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('quantity', 'smallint', (col) => col.notNull().defaultTo(1))
    .addColumn('completed_count', 'smallint', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('failed_count', 'smallint', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('estimated_credits', 'integer', (col) => col.notNull())
    .addColumn('actual_credits', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('is_hidden', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('is_deleted', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_status CHECK (status IN ('pending','processing','completed','partial_complete','failed'))`.execute(db)

  await db.schema
    .createIndex('idx_batches_user')
    .on('task_batches')
    .columns(['user_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_batches_idem')
    .on('task_batches')
    .columns(['idempotency_key'])
    .execute()

  // Partial index for timeout-guardian: efficiently scans only 'processing' rows
  await sql`CREATE INDEX idx_batches_processing ON task_batches (status, created_at) WHERE status = 'processing'`.execute(db)

  // tasks
  await db.schema
    .createTable('tasks')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col.notNull().references('task_batches.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('version_index', 'smallint', (col) => col.notNull())
    .addColumn('queue_job_id', 'varchar(255)')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('retry_count', 'smallint', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('estimated_credits', 'integer', (col) => col.notNull())
    .addColumn('credits_cost', 'integer')
    .addColumn('provider_cost_raw', 'jsonb')
    .addColumn('processing_started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('error_message', 'text')
    .execute()

  await sql`ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status CHECK (status IN ('pending','processing','completed','failed'))`.execute(db)

  await db.schema
    .createIndex('idx_tasks_batch')
    .on('tasks')
    .columns(['batch_id'])
    .execute()

  await db.schema
    .createIndex('idx_tasks_ext_id')
    .on('tasks')
    .columns(['external_task_id'])
    .execute()

  // Partial index for timeout-guardian: scans active tasks
  await sql`CREATE INDEX idx_tasks_active ON tasks (processing_started_at) WHERE status IN ('pending','processing')`.execute(db)

  // assets
  await db.schema
    .createTable('assets')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('task_id', 'uuid', (col) =>
      col.unique().notNull().references('tasks.id')
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col.notNull().references('task_batches.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('type', 'varchar(10)', (col) => col.notNull())
    .addColumn('storage_url', 'text')
    .addColumn('original_url', 'text')
    .addColumn('transfer_status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('file_size', 'bigint')
    .addColumn('duration', 'integer')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('is_deleted', 'boolean', (col) =>
      col.notNull().defaultTo(false)
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE assets ADD CONSTRAINT chk_assets_type CHECK (type IN ('image','video','audio'))`.execute(db)
  await sql`ALTER TABLE assets ADD CONSTRAINT chk_assets_transfer CHECK (transfer_status IN ('pending','completed','failed'))`.execute(db)

  await db.schema
    .createIndex('idx_assets_user')
    .on('assets')
    .columns(['user_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_assets_batch')
    .on('assets')
    .columns(['batch_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('assets').execute()
  await db.schema.dropTable('tasks').execute()
  await db.schema.dropTable('task_batches').execute()
}
