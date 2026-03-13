import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('subscription_plans')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('tier', 'varchar(20)', (col) => col.notNull())
    .addColumn('price_monthly', sql`decimal(10,2)`)
    .addColumn('price_yearly', sql`decimal(10,2)`)
    .addColumn('credits_monthly', 'integer', (col) => col.notNull())
    .addColumn('max_concurrency', 'integer', (col) => col.notNull())
    .addColumn('max_batch_size', 'integer', (col) => col.notNull())
    .addColumn('features', 'jsonb', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.defaultTo(true))
    .execute()

  await sql`ALTER TABLE subscription_plans ADD CONSTRAINT chk_plans_tier CHECK (tier IN ('free','basic','pro','enterprise'))`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('subscription_plans').execute()
}
