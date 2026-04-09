import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // 1. 画布主表
  await db.schema
    .createTable('canvases')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('name', 'text', (col) => col.notNull().defaultTo('未命名画布'))
    .addColumn('thumbnail_url', 'text')
    .addColumn('structure_data', 'jsonb', (col) => col.notNull().defaultTo(sql`'{"nodes":[],"edges":[]}'::jsonb`))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('idx_canvases_workspace')
    .on('canvases')
    .columns(['workspace_id', 'updated_at desc'])
    .execute()

  // 2. 节点输出记录表
  await db.schema
    .createTable('canvas_node_outputs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('canvas_id', 'uuid', (col) => col.notNull().references('canvases.id').onDelete('cascade'))
    .addColumn('node_id', 'text', (col) => col.notNull())
    .addColumn('batch_id', 'uuid', (col) => col.references('task_batches.id'))
    .addColumn('output_urls', sql`text[]`, (col) => col.notNull())
    .addColumn('params_snapshot', 'jsonb')
    .addColumn('is_selected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('idx_canvas_node_outputs_lookup')
    .on('canvas_node_outputs')
    .columns(['canvas_id', 'node_id', 'created_at desc'])
    .execute()

  // 3. 修改原有的 task_batches，追加隔离与绑定字段
  await db.schema
    .alterTable('task_batches')
    .addColumn('canvas_id', 'uuid', (col) => col.references('canvases.id').onDelete('set null'))
    .addColumn('canvas_node_id', 'text')
    .execute()

  // 部分索引优化轮询
  await db.schema
    .createIndex('idx_task_batches_canvas_active')
    .on('task_batches')
    .column('canvas_id')
    .where(sql`status in ('pending', 'processing')`)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_task_batches_canvas_active').execute()
  await db.schema.alterTable('task_batches').dropColumn('canvas_node_id').dropColumn('canvas_id').execute()
  await db.schema.dropTable('canvas_node_outputs').execute()
  await db.schema.dropTable('canvases').execute()
}
