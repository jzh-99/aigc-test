import { Kysely, sql } from 'kysely';

/**
 * 051_batch_source.ts
 *
 * 为 task_batches 表新增 source 字段，用于区分产品来源：
 * - generation: 创作生成模块
 * - studio: 工作室模块（音乐、配音、绘本、短剧）
 * - canvas: 画布模块
 *
 * 同时扩展 module 约束，支持所有业务模块类型。
 */

export async function up(db: Kysely<any>): Promise<void> {
  // 1. 添加 source 列，默认值为 'generation'
  await db.schema
    .alterTable('task_batches')
    .addColumn('source', 'varchar(30)', (col) => col.notNull().defaultTo('generation'))
    .execute();

  // 2. 回填 source 字段（按优先级顺序，避免重叠）
  // 2.1 优先级最高：根据关联项目字段设置 studio
  await sql`
    UPDATE task_batches
    SET source = 'studio'
    WHERE picture_book_project_id IS NOT NULL
       OR video_studio_project_id IS NOT NULL
  `.execute(db);

  // 2.2 优先级次高：根据关联字段设置 canvas
  await sql`
    UPDATE task_batches
    SET source = 'canvas'
    WHERE canvas_id IS NOT NULL
       OR canvas_node_id IS NOT NULL
  `.execute(db);

  // 2.3 根据 module 回填 studio（仅更新尚未归类的记录）
  await sql`
    UPDATE task_batches
    SET source = 'studio'
    WHERE source = 'generation'
      AND module IN ('music','music_voice_clone','picture_book','short_drama')
  `.execute(db);

  // 2.4 根据 module 回填 canvas（仅更新尚未归类的记录）
  await sql`
    UPDATE task_batches
    SET source = 'canvas'
    WHERE source = 'generation'
      AND module IN ('agent','storyboard','upload')
  `.execute(db);

  // 2.5 generation 模块保持默认值（此步骤可选，用于明确性）
  // 由于默认值已是 'generation'，此 UPDATE 主要用于测试验证
  await sql`
    UPDATE task_batches
    SET source = 'generation'
    WHERE source = 'generation'
      AND module IN ('image','video','tts','lipsync','avatar','action_imitation')
  `.execute(db);

  // 3. 添加 source 约束
  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_source CHECK (source IN ('generation','studio','canvas'))
  `.execute(db);

  // 4. 删除旧的 module 约束
  await sql`
    ALTER TABLE task_batches
    DROP CONSTRAINT chk_tb_module
  `.execute(db);

  // 5. 重建 module 约束，包含所有模块类型
  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_module CHECK (module IN (
      'image','video','tts','lipsync','agent','avatar',
      'action_imitation','storyboard','upload','music',
      'music_voice_clone','picture_book','short_drama'
    ))
  `.execute(db);

  // 6. 创建复合索引：source + workspace_id + created_at DESC + id DESC
  // 注意：created_at 和 id 降序排列，适配分页查询
  await sql`
    CREATE INDEX idx_task_batches_source_workspace_created
    ON task_batches (source, workspace_id, created_at DESC, id DESC)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. 删除索引
  await sql`
    DROP INDEX idx_task_batches_source_workspace_created
  `.execute(db);

  // 2. 删除 source 约束
  await sql`
    ALTER TABLE task_batches
    DROP CONSTRAINT chk_tb_source
  `.execute(db);

  // 3. 删除 source 列
  await db.schema
    .alterTable('task_batches')
    .dropColumn('source')
    .execute();

  // 4. 恢复原 module 约束（仅包含原有模块）
  await sql`
    ALTER TABLE task_batches
    DROP CONSTRAINT chk_tb_module
  `.execute(db);

  await sql`
    ALTER TABLE task_batches
    ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation'))
  `.execute(db);
}
