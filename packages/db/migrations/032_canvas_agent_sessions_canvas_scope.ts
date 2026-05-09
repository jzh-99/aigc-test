import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_canvas_agent_sessions_lookup').ifExists().execute()

  await sql`
    delete from canvas_agent_sessions a
    using canvas_agent_sessions b
    where a.canvas_id = b.canvas_id
      and (
        a.updated_at < b.updated_at
        or (a.updated_at = b.updated_at and a.id::text < b.id::text)
      )
  `.execute(db)

  await db.schema
    .alterTable('canvas_agent_sessions')
    .dropColumn('user_id')
    .execute()

  await db.schema
    .createIndex('idx_canvas_agent_sessions_lookup')
    .on('canvas_agent_sessions')
    .column('canvas_id')
    .unique()
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_canvas_agent_sessions_lookup').ifExists().execute()

  await db.schema
    .alterTable('canvas_agent_sessions')
    .addColumn('user_id', 'uuid', (col) => col.references('users.id').onDelete('cascade'))
    .execute()

  await sql`
    update canvas_agent_sessions s
    set user_id = c.user_id
    from canvases c
    where c.id = s.canvas_id
  `.execute(db)

  await db.schema
    .alterTable('canvas_agent_sessions')
    .alterColumn('user_id', (col) => col.setNotNull())
    .execute()

  await db.schema
    .createIndex('idx_canvas_agent_sessions_lookup')
    .on('canvas_agent_sessions')
    .columns(['canvas_id', 'user_id'])
    .unique()
    .execute()
}
