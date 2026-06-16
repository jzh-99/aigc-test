import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 放宽 picture_book_projects.status 约束，新增 generating 状态。
 *
 * 背景：绘本"立即生成"改为先创建项目记录再流式生成剧本，生成期间项目状态为 generating，
 * 让前端能立即在列表新增带 loading 的卡片，且退出页面重进后状态不丢失（已落库）。
 * 生成完成更新为 script_ready，失败更新为 failed。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE picture_book_projects DROP CONSTRAINT IF EXISTS chk_picture_book_projects_status`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_projects_status CHECK (status IN ('draft','generating','script_ready','assets_ready','storyboard_ready','completed','failed'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE picture_book_projects DROP CONSTRAINT IF EXISTS chk_picture_book_projects_status`.execute(db)
  // 回滚前需把 generating 记录归一为 draft，避免约束冲突
  await sql`UPDATE picture_book_projects SET status = 'draft' WHERE status = 'generating'`.execute(db)
  await sql`ALTER TABLE picture_book_projects ADD CONSTRAINT chk_picture_book_projects_status CHECK (status IN ('draft','script_ready','assets_ready','storyboard_ready','completed','failed'))`.execute(db)
}
