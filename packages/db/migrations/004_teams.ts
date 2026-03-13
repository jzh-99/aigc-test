import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // teams
  await db.schema
    .createTable('teams')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('owner_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('plan_tier', 'varchar(20)', (col) => col.defaultTo('free'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE teams ADD CONSTRAINT chk_teams_plan_tier CHECK (plan_tier IN ('free','basic','pro','enterprise'))`.execute(db)

  // team_members
  await db.schema
    .createTable('team_members')
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull())
    .addColumn('joined_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE team_members ADD PRIMARY KEY (team_id, user_id)`.execute(db)
  await sql`ALTER TABLE team_members ADD CONSTRAINT chk_tm_role CHECK (role IN ('owner','admin','editor','viewer'))`.execute(db)

  // team_subscriptions
  await db.schema
    .createTable('team_subscriptions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id')
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

  await sql`ALTER TABLE team_subscriptions ADD CONSTRAINT chk_tsub_status CHECK (status IN ('active','expired','cancelled'))`.execute(db)

  await db.schema
    .createIndex('idx_team_subscriptions_active')
    .on('team_subscriptions')
    .columns(['team_id', 'status'])
    .execute()

  // workspaces
  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`NOW()`)
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workspaces').execute()
  await db.schema.dropTable('team_subscriptions').execute()
  await db.schema.dropTable('team_members').execute()
  await db.schema.dropTable('teams').execute()
}
