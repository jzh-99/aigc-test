import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 053_task_batches_source_metadata.ts
 *
 * 为 task_batches 表添加 source metadata 字段，用于跨模块的资产追踪和历史记录隔离：
 * - source_module: 来源模块（如 toby_studio、toby_canvas）
 * - source_feature: 来源功能（如 short_drama、picture_book、music）
 * - source_project_id: 来源项目 ID
 * - source_episode_id: 来源集数 ID（可选）
 * - source_segment_id: 来源片段 ID（可选）
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 添加 source metadata 字段
  await db.schema
    .alterTable('task_batches')
    .addColumn('source_module', 'varchar(50)')
    .addColumn('source_feature', 'varchar(50)')
    .addColumn('source_project_id', 'varchar(100)')
    .addColumn('source_episode_id', 'varchar(100)')
    .addColumn('source_segment_id', 'varchar(100)')
    .execute()

  // 创建索引以支持按 source_module + source_feature 查询
  await db.schema
    .createIndex('idx_task_batches_source_module_feature')
    .on('task_batches')
    .columns(['source_module', 'source_feature', 'created_at desc'])
    .execute()

  // 创建索引以支持按 source_project_id 查询
  await db.schema
    .createIndex('idx_task_batches_source_project')
    .on('task_batches')
    .columns(['source_project_id', 'created_at desc'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 删除索引
  await db.schema.dropIndex('idx_task_batches_source_project').execute()
  await db.schema.dropIndex('idx_task_batches_source_module_feature').execute()

  // 删除字段
  await db.schema
    .alterTable('task_batches')
    .dropColumn('source_segment_id')
    .dropColumn('source_episode_id')
    .dropColumn('source_project_id')
    .dropColumn('source_feature')
    .dropColumn('source_module')
    .execute()
}
