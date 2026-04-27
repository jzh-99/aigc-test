import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('concat_jobs')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('processing'))
    .addColumn('result_url', 'text')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('concat_jobs').execute()
}
