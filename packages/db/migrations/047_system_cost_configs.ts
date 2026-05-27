import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const DEFAULT_VOICE_CLONE_CREDITS = 5

function getInitialVoiceCloneCredits(): number {
  const rawCredits = Number.parseInt(process.env.MUSIC_VOICE_CLONE_CREDITS ?? '', 10)
  return Number.isFinite(rawCredits) && rawCredits >= 0 ? rawCredits : DEFAULT_VOICE_CLONE_CREDITS
}

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('system_cost_configs')
    .addColumn('key', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('label', 'varchar(100)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('credit_cost', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`ALTER TABLE system_cost_configs ADD CONSTRAINT chk_system_cost_configs_credit_cost CHECK (credit_cost >= 0)`.execute(db)

  await db
    .insertInto('system_cost_configs')
    .values({
      key: 'music_voice_clone',
      label: '音色克隆',
      description: '每次创建音乐音色克隆消耗的积分',
      credit_cost: getInitialVoiceCloneCredits(),
    })
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('system_cost_configs').ifExists().execute()
}
