import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 短剧项目表及关联字段
 * - short_drama_projects: 短剧项目主表
 * - task_batches 扩展: 关联短剧项目、集数、片段
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 创建短剧项目表
  await db.schema
    .createTable('short_drama_projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'text', (col) => col.notNull().defaultTo('未命名短剧'))
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('style', 'varchar(100)', (col) => col.notNull())
    .addColumn('aspect_ratio', 'varchar(10)', (col) => col.notNull())
    .addColumn('episode_count', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('draft'))
    .addColumn('active_step', 'varchar(30)', (col) => col.notNull().defaultTo('script'))
    .addColumn('cover_url', 'text')
    .addColumn('state', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('estimated_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('actual_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('draft_saved_at', 'timestamptz')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // 添加约束
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_aspect_ratio CHECK (aspect_ratio IN ('9:16','16:9'))`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_episode_count CHECK (episode_count >= 1 AND episode_count <= 50)`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_status CHECK (status IN ('draft','summary_ready','outline_ready','assets_ready','episodes_ready','completed','failed'))`.execute(db)
  await sql`ALTER TABLE short_drama_projects ADD CONSTRAINT chk_short_drama_active_step CHECK (active_step IN ('script','assets','episodes'))`.execute(db)

  // 创建复合索引，支持常见查询模式
  await db.schema
    .createIndex('idx_short_drama_projects_workspace_updated')
    .on('short_drama_projects')
    .columns(['workspace_id', 'updated_at desc'])
    .execute()

  await db.schema
    .createIndex('idx_short_drama_projects_workspace_deleted_updated')
    .on('short_drama_projects')
    .columns(['workspace_id', 'is_deleted', 'updated_at desc'])
    .execute()

  await db.schema
    .createIndex('idx_short_drama_projects_user_updated')
    .on('short_drama_projects')
    .columns(['user_id', 'updated_at desc'])
    .execute()

  // 扩展 task_batches 表，添加短剧关联字段
  await db.schema
    .alterTable('task_batches')
    .addColumn('short_drama_project_id', 'uuid', (col) => col.references('short_drama_projects.id').onDelete('set null'))
    .addColumn('short_drama_episode_id', 'text')
    .addColumn('short_drama_segment_id', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 移除 task_batches 扩展字段
  await db.schema
    .alterTable('task_batches')
    .dropColumn('short_drama_segment_id')
    .dropColumn('short_drama_episode_id')
    .dropColumn('short_drama_project_id')
    .execute()

  // 删除索引
  await db.schema.dropIndex('idx_short_drama_projects_user_updated').execute()
  await db.schema.dropIndex('idx_short_drama_projects_workspace_deleted_updated').execute()
  await db.schema.dropIndex('idx_short_drama_projects_workspace_updated').execute()

  // 删除短剧项目表
  await db.schema.dropTable('short_drama_projects').ifExists().execute()
}
