import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 078_drop_local_credit_tables.ts
 *
 * 彻底删除本地积分系统遗留：credit_accounts / credits_ledger 两张表，以及所有引用方
 * 的 credit_account_id 列、team_members 配额列。
 *
 * 背景：业管 A 豆硬切换后，本地积分表已无任何生产代码读写（生成走业管扣减、支付走
 * subscribe_sync outbox、余额查询走业管）。本迁移做最终清理，删除死表与死列。
 *
 * DDL 严格按依赖顺序执行（否则 FK 报错）：
 *   ① 删 credit_accounts 触发器
 *   ② 动态查出并删除 task_batches / payment_orders 上指向 credit_accounts 的 FK 约束
 *   ③ 删除 task_batches / payment_orders 的 credit_account_id 列
 *   ④ 删除 team_members 配额列（credit_quota/credit_used/quota_period/quota_reset_at）
 *   ⑤ 先删 credits_ledger（它引用 credit_accounts），再删 credit_accounts
 *
 * FK 约束名通过 pg_constraint 动态查询，避免 Postgres 自动命名（<table>_<col>_fkey）
 * 的不确定性。down 只做反向 DDL 重建，不夹带任何数据回填。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ① 删除 credit_accounts 的 updated_at 触发器（triggers.sql 中定义）
  await sql`DROP TRIGGER IF EXISTS trg_credit_accounts_updated_at ON credit_accounts`.execute(db)

  // ② 动态删除 task_batches / payment_orders 上指向 credit_accounts(id) 的外键约束。
  //    约束名可能是自动命名的 <table>_credit_account_id_fkey，也可能是历史显式命名，
  //    故用 pg_constraint 按 referenced 表 + 本表查出实际约束名再删。
  await sql`
    DO $$
    DECLARE
      cname text;
    BEGIN
      SELECT conname INTO cname
      FROM pg_constraint
      WHERE conrelid = 'task_batches'::regclass
        AND contype = 'f'
        AND confrelid = 'credit_accounts'::regclass;
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE task_batches DROP CONSTRAINT %I', cname);
      END IF;

      SELECT conname INTO cname
      FROM pg_constraint
      WHERE conrelid = 'payment_orders'::regclass
        AND contype = 'f'
        AND confrelid = 'credit_accounts'::regclass;
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE payment_orders DROP CONSTRAINT %I', cname);
      END IF;
    END $$
  `.execute(db)

  // ③ 删除引用方的 credit_account_id 列（FK 已删，可安全删列）
  await sql`ALTER TABLE task_batches DROP COLUMN IF EXISTS credit_account_id`.execute(db)
  await sql`ALTER TABLE payment_orders DROP COLUMN IF EXISTS credit_account_id`.execute(db)

  // ④ 删除 team_members 配额列（成员配额已移除，A 豆由业管统一管理）
  await sql`ALTER TABLE team_members DROP COLUMN IF EXISTS credit_quota`.execute(db)
  await sql`ALTER TABLE team_members DROP COLUMN IF EXISTS credit_used`.execute(db)
  await sql`ALTER TABLE team_members DROP COLUMN IF EXISTS quota_period`.execute(db)
  await sql`ALTER TABLE team_members DROP COLUMN IF EXISTS quota_reset_at`.execute(db)

  // ⑤ 先删 credits_ledger（引用 credit_accounts），再删 credit_accounts
  await sql`DROP TABLE IF EXISTS credits_ledger`.execute(db)
  await sql`DROP TABLE IF EXISTS credit_accounts`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 反向重建表结构（纯 DDL，不回填任何数据——历史积分数据已永久丢失，无法恢复）。
  // 重建顺序与 up 相反：先建 credit_accounts，再建 credits_ledger，再恢复列与配额列。

  // 重建 credit_accounts
  await db.schema
    .createTable('credit_accounts')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id'))
    .addColumn('balance', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('frozen_credits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_earned', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_spent', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addUniqueConstraint('uq_credit_accounts_user', ['user_id'])
    .addUniqueConstraint('uq_credit_accounts_team', ['team_id'])
    .execute()

  await sql`ALTER TABLE credit_accounts ADD CONSTRAINT chk_ca_owner_type CHECK (owner_type IN ('user','team'))`.execute(db)
  await sql`ALTER TABLE credit_accounts ADD CONSTRAINT chk_ca_balance_gte_zero CHECK (balance >= 0)`.execute(db)
  await sql`ALTER TABLE credit_accounts ADD CONSTRAINT chk_ca_frozen_gte_zero CHECK (frozen_credits >= 0)`.execute(db)
  await sql`ALTER TABLE credit_accounts ADD CONSTRAINT chk_ca_balance_gte_frozen CHECK (balance >= frozen_credits)`.execute(db)
  await sql`ALTER TABLE credit_accounts ADD CONSTRAINT chk_ca_owner_exclusive CHECK (
    (owner_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR
    (owner_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
  )`.execute(db)

  // 重建 credits_ledger
  await db.schema
    .createTable('credits_ledger')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('credit_account_id', 'uuid', (col) => col.notNull().references('credit_accounts.id'))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('task_id', 'uuid')
    .addColumn('batch_id', 'uuid')
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute()
  await sql`ALTER TABLE credits_ledger ADD CONSTRAINT chk_cl_type CHECK (type IN ('topup','subscription','freeze','confirm','refund','bonus','expire'))`.execute(db)

  // 恢复 team_members 配额列
  await db.schema.alterTable('team_members').addColumn('credit_quota', 'integer').execute()
  await db.schema.alterTable('team_members').addColumn('credit_used', 'integer', (col) => col.notNull().defaultTo(0)).execute()
  await db.schema.alterTable('team_members').addColumn('quota_period', 'varchar(10)').execute()
  await db.schema.alterTable('team_members').addColumn('quota_reset_at', 'timestamptz').execute()

  // 恢复 task_batches / payment_orders 的 credit_account_id 列（nullable，不关联 FK，数据已空）
  await db.schema.alterTable('task_batches').addColumn('credit_account_id', 'uuid').execute()
  await db.schema.alterTable('payment_orders').addColumn('credit_account_id', 'uuid').execute()

  // 恢复触发器
  await sql`CREATE TRIGGER trg_credit_accounts_updated_at BEFORE UPDATE ON credit_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()`.execute(db)
}
