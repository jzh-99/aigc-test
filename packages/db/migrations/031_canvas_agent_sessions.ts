import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('canvas_agent_sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('canvas_id', 'uuid', (col) => col.notNull().references('canvases.id').onDelete('cascade'))
    .addColumn('session', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('idx_canvas_agent_sessions_lookup')
    .on('canvas_agent_sessions')
    .column('canvas_id')
    .unique()
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_canvas_agent_sessions_lookup').execute()
  await db.schema.dropTable('canvas_agent_sessions').execute()
}
