import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 扩展 task_batches.module 约束，新增 text 模块。
 * 用于短剧 SSE 文本生成（剧本摘要/分集剧本/分集概述/素材描述/片段脚本）的任务记录，
 * 作为僵死状态自愈的进程外状态来源。
 *
 * 约束列表须覆盖现有全部 module 值（含 upload/picture_book/short_drama）+ text，
 * 否则 ADD CONSTRAINT 会因存量数据触发 check_violation(23514)。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','upload','music','music_voice_clone','picture_book','short_drama','text'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','upload','music','music_voice_clone','picture_book','short_drama'))`.execute(db)
}
