import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('provider_api_logs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('batch_id', 'uuid', (col) => col.references('task_batches.id').onDelete('set null'))
    .addColumn('task_id', 'uuid', (col) => col.references('tasks.id').onDelete('set null'))
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id').onDelete('set null'))
    .addColumn('workspace_id', 'uuid', (col) => col.references('workspaces.id').onDelete('set null'))
    .addColumn('module', 'varchar(50)', (col) => col.notNull())
    .addColumn('provider', 'varchar(100)', (col) => col.notNull())
    .addColumn('model', 'varchar(100)')
    .addColumn('operation', 'varchar(100)', (col) => col.notNull())
    .addColumn('method', 'varchar(20)', (col) => col.notNull())
    .addColumn('endpoint', 'text', (col) => col.notNull())
    .addColumn('request_payload', 'jsonb')
    .addColumn('request_truncated', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('response_status', 'integer')
    .addColumn('response_payload', 'jsonb')
    .addColumn('response_truncated', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('duration_ms', 'integer')
    .addColumn('status', 'varchar(20)', (col) => col.notNull())
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE provider_api_logs ADD CONSTRAINT chk_provider_api_logs_status CHECK (status IN ('success','failed'))`.execute(db)
  await db.schema.createIndex('idx_provider_api_logs_batch_created').on('provider_api_logs').columns(['batch_id', 'created_at']).execute()
  await db.schema.createIndex('idx_provider_api_logs_task_created').on('provider_api_logs').columns(['task_id', 'created_at']).execute()
  await db.schema.createIndex('idx_provider_api_logs_provider_operation').on('provider_api_logs').columns(['provider', 'operation', 'created_at']).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_provider_api_logs_provider_operation').ifExists().execute()
  await db.schema.dropIndex('idx_provider_api_logs_task_created').ifExists().execute()
  await db.schema.dropIndex('idx_provider_api_logs_batch_created').ifExists().execute()
  await db.schema.dropTable('provider_api_logs').ifExists().execute()
}
