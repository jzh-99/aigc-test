import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE ai_assistant_errors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      http_status INTEGER,
      error_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db)

  await sql`CREATE INDEX idx_ai_assistant_errors_user_id_created_at ON ai_assistant_errors (user_id, created_at DESC)`.execute(db)

  // Auto-purge rows older than 7 days via a scheduled approach is app-side;
  // here we just add the table.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS ai_assistant_errors`.execute(db)
}
