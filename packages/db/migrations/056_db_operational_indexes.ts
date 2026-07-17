import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_task_batches_video_studio_project_created
    ON task_batches (video_studio_project_id, created_at DESC)
    WHERE video_studio_project_id IS NOT NULL
  `.execute(db)

  await sql`
    CREATE INDEX IF NOT EXISTS idx_task_batches_picture_book_project_created
    ON task_batches (picture_book_project_id, created_at DESC)
    WHERE picture_book_project_id IS NOT NULL
  `.execute(db)

  await sql`
    CREATE INDEX IF NOT EXISTS idx_task_batches_short_drama_project_created
    ON task_batches (short_drama_project_id, created_at DESC)
    WHERE short_drama_project_id IS NOT NULL
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION purge_provider_api_logs(retention_days integer DEFAULT 30)
    RETURNS integer
    LANGUAGE plpgsql
    AS $$
    DECLARE
      deleted_count integer;
    BEGIN
      IF retention_days IS NULL OR retention_days <= 0 THEN
        RAISE EXCEPTION 'retention_days must be positive';
      END IF;

      WITH deleted AS (
        DELETE FROM provider_api_logs
        WHERE created_at < now() - make_interval(days => retention_days)
        RETURNING 1
      )
      SELECT count(*) INTO deleted_count FROM deleted;

      RETURN deleted_count;
    END;
    $$;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS purge_provider_api_logs(integer)`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_task_batches_short_drama_project_created`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_task_batches_picture_book_project_created`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_task_batches_video_studio_project_created`.execute(db)
}
