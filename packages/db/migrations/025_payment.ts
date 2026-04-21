import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS allow_member_topup boolean NOT NULL DEFAULT false
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      life_order_id varchar(64) NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES users(id),
      team_id uuid REFERENCES teams(id),
      credit_account_id uuid REFERENCES credit_accounts(id),
      amount_fen integer NOT NULL,
      credits_to_grant integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      order_type varchar(20) NOT NULL DEFAULT 'topup',
      platform_code varchar(64) NOT NULL,
      callback_payload jsonb,
      created_at timestamptz DEFAULT NOW(),
      paid_at timestamptz
    )
  `.execute(db)

  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid()`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS life_order_id varchar(64)`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id)`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS credit_account_id uuid REFERENCES credit_accounts(id)`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS amount_fen integer NOT NULL DEFAULT 0`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS credits_to_grant integer NOT NULL DEFAULT 0`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'pending'`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS order_type varchar(20) NOT NULL DEFAULT 'topup'`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS platform_code varchar(64) NOT NULL DEFAULT ''`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS callback_payload jsonb`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW()`.execute(db)
  await sql`ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz`.execute(db)

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_life_order_id
    ON payment_orders (life_order_id)
  `.execute(db)

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_status'
      ) THEN
        ALTER TABLE payment_orders
        ADD CONSTRAINT chk_po_status
        CHECK (status IN ('pending','paid','failed','refunded'));
      END IF;
    END $$;
  `.execute(db)

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_order_type'
      ) THEN
        ALTER TABLE payment_orders
        ADD CONSTRAINT chk_po_order_type
        CHECK (order_type IN ('topup','subscription'));
      END IF;
    END $$;
  `.execute(db)

  await sql`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user
    ON payment_orders (user_id, created_at)
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS payment_orders`.execute(db)
  await sql`ALTER TABLE teams DROP COLUMN IF EXISTS allow_member_topup`.execute(db)
}
