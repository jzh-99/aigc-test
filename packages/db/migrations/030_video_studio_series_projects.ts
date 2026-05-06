import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('video_studio_projects')
    .addColumn('project_type', 'text', (col) => col.notNull().defaultTo('single'))
    .addColumn('series_parent_id', 'uuid', (col) => col.references('video_studio_projects.id').onDelete('cascade'))
    .addColumn('episode_index', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_video_studio_projects_series_parent')
    .on('video_studio_projects')
    .column('series_parent_id')
    .execute()

  await db.schema
    .createIndex('idx_video_studio_projects_type_workspace')
    .on('video_studio_projects')
    .columns(['workspace_id', 'project_type', 'updated_at desc'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_video_studio_projects_type_workspace').execute()
  await db.schema.dropIndex('idx_video_studio_projects_series_parent').execute()

  await db.schema
    .alterTable('video_studio_projects')
    .dropColumn('episode_index')
    .dropColumn('series_parent_id')
    .dropColumn('project_type')
    .execute()
}
