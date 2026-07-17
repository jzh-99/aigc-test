import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 将 task_batches.idempotency_key 从 varchar(64) 扩展为 varchar(128)，
 * 与 post-image 接口的 schema 校验（maxLength: 128）保持一致
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches ALTER COLUMN idempotency_key TYPE varchar(128)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches ALTER COLUMN idempotency_key TYPE varchar(64)`.execute(db)
}
