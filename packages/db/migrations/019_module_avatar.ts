import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)
}
