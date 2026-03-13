import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // credit_accounts — MUST run after 004_teams (references teams)
  await db.schema
    .createTable('credit_accounts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('owner_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id'))
    .addColumn('balance', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('frozen_credits', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('total_earned', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('total_spent', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
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

  // credits_ledger
  await db.schema
    .createTable('credits_ledger')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('credit_account_id', 'uuid', (col) =>
      col.notNull().references('credit_accounts.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('amount', 'integer', (col) => col.notNull())
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('task_id', 'uuid') // intentionally no FK
    .addColumn('batch_id', 'uuid') // intentionally no FK
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE credits_ledger ADD CONSTRAINT chk_cl_type CHECK (type IN ('topup','subscription','freeze','confirm','refund','bonus','expire'))`.execute(db)

  await db.schema
    .createIndex('idx_credits_ledger_account')
    .on('credits_ledger')
    .columns(['credit_account_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_credits_ledger_user')
    .on('credits_ledger')
    .columns(['user_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('credits_ledger').execute()
  await db.schema.dropTable('credit_accounts').execute()
}
