import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // prompt_filter_logs
  await db.schema
    .createTable('prompt_filter_logs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('prompt', 'text', (col) => col.notNull())
    .addColumn('matched_rules', 'jsonb', (col) =>
      col.notNull().defaultTo('[]')
    )
    .addColumn('action', 'varchar(10)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE prompt_filter_logs ADD CONSTRAINT chk_pfl_action CHECK (action IN ('pass','rejected'))`.execute(db)

  // webhook_logs
  await db.schema
    .createTable('webhook_logs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('provider', 'varchar(50)', (col) => col.notNull())
    .addColumn('external_task_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('signature_valid', 'boolean', (col) => col.notNull())
    .addColumn('processed_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await db.schema
    .createIndex('idx_webhook_ext_id')
    .on('webhook_logs')
    .columns(['external_task_id'])
    .execute()

  // payment_orders
  await db.schema
    .createTable('payment_orders')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('order_no', 'varchar(64)', (col) => col.unique().notNull())
    .addColumn('provider', 'varchar(50)', (col) => col.notNull())
    .addColumn('provider_order_id', 'varchar(255)')
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('amount_fen', 'integer', (col) => col.notNull())
    .addColumn('credits', 'integer')
    .addColumn('plan_id', 'uuid', (col) =>
      col.references('subscription_plans.id')
    )
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('paid_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE payment_orders ADD CONSTRAINT chk_po_type CHECK (type IN ('topup','subscription'))`.execute(db)
  await sql`ALTER TABLE payment_orders ADD CONSTRAINT chk_po_status CHECK (status IN ('pending','paid','failed','refunded'))`.execute(db)

  await db.schema
    .createIndex('idx_payment_orders_user')
    .on('payment_orders')
    .columns(['user_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_payment_orders_no')
    .on('payment_orders')
    .columns(['order_no'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('payment_orders').execute()
  await db.schema.dropTable('webhook_logs').execute()
  await db.schema.dropTable('prompt_filter_logs').execute()
}
