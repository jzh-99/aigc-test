import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 业管身份任务无本地 credit_account，credit_account_id 必须允许为空。
  // FK 保留（为空的行不触发外键校验）；本地积分退役后历史行仍可关联。
  await sql`ALTER TABLE task_batches ALTER COLUMN credit_account_id DROP NOT NULL`.execute(db)
  await sql`COMMENT ON COLUMN task_batches.credit_account_id IS '本地积分账户 ID，关联 credit_accounts.id。业管身份任务（biz_mgmt 计费）为 NULL；本地积分退役后仅历史行有值。新生成任务一律为 NULL，计费权威在 biz_mgmt_a_bean_transactions。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE task_batches SET credit_account_id = (SELECT id FROM credit_accounts LIMIT 1) WHERE credit_account_id IS NULL`.execute(db)
  await sql`ALTER TABLE task_batches ALTER COLUMN credit_account_id SET NOT NULL`.execute(db)
}
