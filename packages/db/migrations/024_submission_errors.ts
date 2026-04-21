import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE submission_errors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('generate_api', 'client')),
      error_code TEXT NOT NULL,
      http_status INTEGER,
      detail TEXT,
      model TEXT,
      canvas_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db)

  await sql`CREATE INDEX idx_submission_errors_user_id_created_at ON submission_errors (user_id, created_at DESC)`.execute(db)
  await sql`CREATE INDEX idx_submission_errors_created_at ON submission_errors (created_at DESC)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS submission_errors`.execute(db)
}
