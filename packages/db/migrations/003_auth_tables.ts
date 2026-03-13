import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // user_subscriptions
  await db.schema
    .createTable('user_subscriptions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('plan_id', 'uuid', (col) =>
      col.notNull().references('subscription_plans.id')
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull())
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE user_subscriptions ADD CONSTRAINT chk_usub_status CHECK (status IN ('active','expired','cancelled'))`.execute(db)

  await db.schema
    .createIndex('idx_user_subscriptions_active')
    .on('user_subscriptions')
    .columns(['user_id', 'status'])
    .execute()

  // refresh_tokens
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('token_hash', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await db.schema
    .createIndex('idx_refresh_tokens_user')
    .on('refresh_tokens')
    .columns(['user_id'])
    .execute()

  // email_verifications
  await db.schema
    .createTable('email_verifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('token_hash', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE email_verifications ADD CONSTRAINT chk_ev_type CHECK (type IN ('verify_email','reset_password'))`.execute(db)

  await db.schema
    .createIndex('idx_email_verifications_user')
    .on('email_verifications')
    .columns(['user_id', 'type'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('email_verifications').execute()
  await db.schema.dropTable('refresh_tokens').execute()
  await db.schema.dropTable('user_subscriptions').execute()
}
