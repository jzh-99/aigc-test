import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('video_studio_projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('name', 'text', (col) => col.notNull().defaultTo('未命名项目'))
    .addColumn('wizard_state', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('idx_video_studio_projects_workspace')
    .on('video_studio_projects')
    .columns(['workspace_id', 'updated_at desc'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_video_studio_projects_workspace').execute()
  await db.schema.dropTable('video_studio_projects').execute()
}
