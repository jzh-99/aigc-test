import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('canvases')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  await db.schema
    .alterTable('video_studio_projects')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('idx_canvases_deleted_workspace')
    .on('canvases')
    .columns(['workspace_id', 'deleted_at'])
    .where('is_deleted', '=', true)
    .execute()

  await db.schema
    .createIndex('idx_video_studio_projects_deleted_workspace')
    .on('video_studio_projects')
    .columns(['workspace_id', 'deleted_at'])
    .where('is_deleted', '=', true)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_video_studio_projects_deleted_workspace').execute()
  await db.schema.dropIndex('idx_canvases_deleted_workspace').execute()

  await db.schema
    .alterTable('video_studio_projects')
    .dropColumn('deleted_at')
    .dropColumn('is_deleted')
    .execute()

  await db.schema
    .alterTable('canvases')
    .dropColumn('deleted_at')
    .dropColumn('is_deleted')
    .execute()
}
