import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // allow_member_topup on teams
  await db.schema
    .alterTable('teams')
    .addColumn('allow_member_topup', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()

  // payment_orders
  await db.schema
    .createTable('payment_orders')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('life_order_id', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id'))
    // null team_id = personal topup; non-null = team topup
    .addColumn('credit_account_id', 'uuid', (col) => col.references('credit_accounts.id'))
    .addColumn('amount_fen', 'integer', (col) => col.notNull()) // 分
    .addColumn('credits_to_grant', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('order_type', 'varchar(20)', (col) => col.notNull().defaultTo('topup')) // topup | subscription
    .addColumn('platform_code', 'varchar(64)', (col) => col.notNull())
    .addColumn('callback_payload', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addColumn('paid_at', 'timestamptz')
    .execute()

  await sql`ALTER TABLE payment_orders ADD CONSTRAINT chk_po_status CHECK (status IN ('pending','paid','failed','refunded'))`.execute(db)
  await sql`ALTER TABLE payment_orders ADD CONSTRAINT chk_po_order_type CHECK (order_type IN ('topup','subscription'))`.execute(db)

  await db.schema
    .createIndex('idx_payment_orders_user')
    .on('payment_orders')
    .columns(['user_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('payment_orders').execute()
  await db.schema.alterTable('teams').dropColumn('allow_member_topup').execute()
}
