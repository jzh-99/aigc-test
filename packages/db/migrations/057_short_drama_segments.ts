import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('short_drama_segments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) => col.notNull().references('short_drama_projects.id').onDelete('cascade'))
    .addColumn('episode_number', 'integer', (col) => col.notNull())
    .addColumn('segment_id', 'text', (col) => col.notNull())
    .addColumn('order_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('title', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('prompt', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('mention_refs', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('duration_seconds', 'integer', (col) => col.notNull().defaultTo(4))
    .addColumn('status', 'varchar(30)', (col) => col.notNull().defaultTo('idle'))
    .addColumn('video_url', 'text')
    .addColumn('video_batch_id', 'uuid', (col) => col.references('task_batches.id').onDelete('set null'))
    .addColumn('video_task_id', 'uuid', (col) => col.references('tasks.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`
    ALTER TABLE short_drama_segments
    ADD CONSTRAINT uq_short_drama_segments_project_episode_segment
    UNIQUE (project_id, episode_number, segment_id)
  `.execute(db)

  await sql`
    ALTER TABLE short_drama_segments
    ADD CONSTRAINT chk_short_drama_segments_status
    CHECK (status IN ('idle','pending','generating','completed','failed'))
  `.execute(db)

  await db.schema
    .createIndex('idx_short_drama_segments_project_episode_order')
    .on('short_drama_segments')
    .columns(['project_id', 'episode_number', 'order_index'])
    .execute()

  await db.schema
    .createIndex('idx_short_drama_segments_project_status')
    .on('short_drama_segments')
    .columns(['project_id', 'status'])
    .execute()

  await sql`
    INSERT INTO short_drama_segments (
      project_id,
      episode_number,
      segment_id,
      order_index,
      title,
      prompt,
      mention_refs,
      duration_seconds,
      status,
      video_url,
      video_batch_id,
      video_task_id,
      created_at,
      updated_at
    )
    SELECT
      p.id,
      (episode.value ->> 'episodeNumber')::integer,
      segment.value ->> 'id',
      COALESCE((segment.value ->> 'order')::integer, 0),
      COALESCE(segment.value ->> 'title', ''),
      COALESCE(segment.value ->> 'prompt', ''),
      COALESCE(segment.value -> 'mentionRefs', '[]'::jsonb),
      COALESCE((segment.value ->> 'durationSeconds')::integer, 4),
      COALESCE(segment.value ->> 'status', 'idle'),
      NULLIF(segment.value ->> 'videoUrl', ''),
      NULLIF(segment.value ->> 'videoBatchId', '')::uuid,
      NULLIF(segment.value ->> 'videoTaskId', '')::uuid,
      p.created_at,
      COALESCE(p.updated_at, now())
    FROM short_drama_projects p
    CROSS JOIN LATERAL jsonb_array_elements(p.state -> 'episodes' -> 'items') AS episode(value)
    CROSS JOIN LATERAL jsonb_array_elements(episode.value -> 'segments') AS segment(value)
    WHERE segment.value ? 'id'
    ON CONFLICT (project_id, episode_number, segment_id) DO UPDATE SET
      order_index = EXCLUDED.order_index,
      title = EXCLUDED.title,
      prompt = EXCLUDED.prompt,
      mention_refs = EXCLUDED.mention_refs,
      duration_seconds = EXCLUDED.duration_seconds,
      status = EXCLUDED.status,
      video_url = EXCLUDED.video_url,
      video_batch_id = EXCLUDED.video_batch_id,
      video_task_id = EXCLUDED.video_task_id,
      updated_at = EXCLUDED.updated_at
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_short_drama_segments_project_status').ifExists().execute()
  await db.schema.dropIndex('idx_short_drama_segments_project_episode_order').ifExists().execute()
  await db.schema.dropTable('short_drama_segments').ifExists().execute()
}
