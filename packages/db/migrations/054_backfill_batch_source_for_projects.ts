import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 修正 051 之后新增项目关联字段造成的来源误归类。
 * 只回填 task_batches.source，不修改任务、资产或项目数据。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE task_batches
    SET source = 'studio'
    WHERE short_drama_project_id IS NOT NULL
       OR picture_book_project_id IS NOT NULL
       OR video_studio_project_id IS NOT NULL
  `.execute(db)

  await sql`
    UPDATE task_batches
    SET source = 'canvas'
    WHERE canvas_id IS NOT NULL
       OR canvas_node_id IS NOT NULL
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE task_batches
    SET source = 'generation'
    WHERE short_drama_project_id IS NOT NULL
       OR picture_book_project_id IS NOT NULL
       OR video_studio_project_id IS NOT NULL
       OR canvas_id IS NOT NULL
       OR canvas_node_id IS NOT NULL
  `.execute(db)
}
