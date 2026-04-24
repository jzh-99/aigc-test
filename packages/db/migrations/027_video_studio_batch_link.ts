import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('task_batches')
    .addColumn('video_studio_project_id', 'uuid', (col) =>
      col.references('video_studio_projects.id').onDelete('set null')
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('task_batches')
    .dropColumn('video_studio_project_id')
    .execute()
}
