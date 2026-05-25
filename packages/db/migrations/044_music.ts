import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','music','music_voice_clone'))`.execute(db)

  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS chk_pm_module`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','music','music_voice_clone'))`.execute(db)

  await db.schema
    .createTable('music_voice_clones')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id')
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col.references('task_batches.id').onDelete('set null')
    )
    .addColumn('task_id', 'uuid', (col) =>
      col.references('tasks.id').onDelete('set null')
    )
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('gender', 'varchar(20)', (col) =>
      col.notNull().defaultTo('auto')
    )
    .addColumn('source_audio_url', 'text', (col) => col.notNull())
    .addColumn('source_audio_storage_url', 'text')
    .addColumn('voice_id', 'varchar(255)')
    .addColumn('external_voice_id', 'varchar(255)')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE music_voice_clones ADD CONSTRAINT chk_music_voice_clones_status CHECK (status IN ('pending','processing','ready','failed'))`.execute(db)
  await sql`ALTER TABLE music_voice_clones ADD CONSTRAINT chk_music_voice_clones_gender CHECK (gender IN ('auto','male','female'))`.execute(db)

  await db.schema
    .createIndex('idx_music_voice_clones_workspace_created')
    .on('music_voice_clones')
    .columns(['workspace_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_music_voice_clones_batch')
    .on('music_voice_clones')
    .columns(['batch_id'])
    .execute()

  await db.schema
    .createIndex('idx_music_voice_clones_task')
    .on('music_voice_clones')
    .columns(['task_id'])
    .execute()

  await sql`CREATE INDEX idx_music_voice_clones_external_task_id ON music_voice_clones (external_task_id) WHERE external_task_id IS NOT NULL`.execute(db)
  await sql`CREATE INDEX idx_music_voice_clones_voice_id ON music_voice_clones (voice_id) WHERE voice_id IS NOT NULL`.execute(db)

  await db.schema
    .createTable('music_tracks')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id')
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('teams.id')
    )
    .addColumn('batch_id', 'uuid', (col) =>
      col.references('task_batches.id').onDelete('set null')
    )
    .addColumn('task_id', 'uuid', (col) =>
      col.references('tasks.id').onDelete('set null')
    )
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('mode', 'varchar(20)', (col) => col.notNull())
    .addColumn('title', 'varchar(255)')
    .addColumn('prompt', 'text')
    .addColumn('lyrics', 'text')
    .addColumn('styles', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`)
    )
    .addColumn('voice_clone_id', 'uuid', (col) =>
      col.references('music_voice_clones.id').onDelete('set null')
    )
    .addColumn('voice_gender', 'varchar(20)', (col) =>
      col.notNull().defaultTo('auto')
    )
    .addColumn('model', 'varchar(100)', (col) => col.notNull())
    .addColumn('cover_url', 'text')
    .addColumn('cover_storage_url', 'text')
    .addColumn('stream_url', 'text')
    .addColumn('audio_url', 'text')
    .addColumn('audio_storage_url', 'text')
    .addColumn('flac_url', 'text')
    .addColumn('flac_storage_url', 'text')
    .addColumn('wav_url', 'text')
    .addColumn('wav_storage_url', 'text')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(30)', (col) =>
      col.notNull().defaultTo('pending')
    )
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .execute()

  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_type CHECK (type IN ('song','instrumental'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_mode CHECK (mode IN ('inspiration','custom'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_voice_gender CHECK (voice_gender IN ('auto','male','female'))`.execute(db)
  await sql`ALTER TABLE music_tracks ADD CONSTRAINT chk_music_tracks_status CHECK (status IN ('pending','lyrics_generating','song_generating','cover_generating','transferring','completed','failed'))`.execute(db)

  await db.schema
    .createIndex('idx_music_tracks_workspace_created')
    .on('music_tracks')
    .columns(['workspace_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_music_tracks_batch')
    .on('music_tracks')
    .columns(['batch_id'])
    .execute()

  await db.schema
    .createIndex('idx_music_tracks_task')
    .on('music_tracks')
    .columns(['task_id'])
    .execute()

  await db.schema
    .createIndex('idx_music_tracks_voice_clone')
    .on('music_tracks')
    .columns(['voice_clone_id'])
    .execute()

  await sql`CREATE INDEX idx_music_tracks_external_task_id ON music_tracks (external_task_id) WHERE external_task_id IS NOT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('music_tracks').ifExists().execute()
  await db.schema.dropTable('music_voice_clones').ifExists().execute()

  await sql`
    DELETE FROM team_model_configs
    WHERE model_id IN (
      SELECT id FROM provider_models WHERE module IN ('music','music_voice_clone')
    )
  `.execute(db)
  await sql`DELETE FROM provider_models WHERE module IN ('music','music_voice_clone')`.execute(db)

  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS chk_pm_module`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT chk_pm_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation'))`.execute(db)

  await sql`
    UPDATE canvas_node_outputs
    SET batch_id = NULL
    WHERE batch_id IN (
      SELECT id FROM task_batches WHERE module IN ('music','music_voice_clone')
    )
  `.execute(db)
  await sql`
    DELETE FROM assets
    WHERE task_id IN (
      SELECT tasks.id
      FROM tasks
      INNER JOIN task_batches ON task_batches.id = tasks.batch_id
      WHERE task_batches.module IN ('music','music_voice_clone')
    )
    OR batch_id IN (
      SELECT id
      FROM task_batches
      WHERE module IN ('music','music_voice_clone')
    )
  `.execute(db)
  await sql`
    DELETE FROM tasks
    WHERE batch_id IN (
      SELECT id FROM task_batches WHERE module IN ('music','music_voice_clone')
    )
  `.execute(db)
  await sql`DELETE FROM task_batches WHERE module IN ('music','music_voice_clone')`.execute(db)

  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard'))`.execute(db)
}
