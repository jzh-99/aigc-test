import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('056_db_operational_indexes migration', () => {
  const migrationPath = join(__dirname, '../migrations/056_db_operational_indexes.ts')

  test('creates indexes for project-linked task batch lookups', async () => {
    const content = await readFile(migrationPath, 'utf-8')

    assert.ok(content.includes('idx_task_batches_video_studio_project_created'))
    assert.ok(content.includes('idx_task_batches_picture_book_project_created'))
    assert.ok(content.includes('idx_task_batches_short_drama_project_created'))
    assert.ok(content.includes('video_studio_project_id'))
    assert.ok(content.includes('picture_book_project_id'))
    assert.ok(content.includes('short_drama_project_id'))
    assert.ok(content.includes('created_at'))
  })

  test('creates provider api log retention helper', async () => {
    const content = await readFile(migrationPath, 'utf-8')

    assert.ok(content.includes('purge_provider_api_logs'))
    assert.ok(content.includes('retention_days integer DEFAULT 30'))
    assert.ok(content.includes('DELETE FROM provider_api_logs'))
    assert.ok(content.includes("created_at < now() - make_interval(days => retention_days)"))
  })

  test('drops operational indexes and retention helper on down migration', async () => {
    const content = await readFile(migrationPath, 'utf-8')

    assert.ok(content.includes('DROP FUNCTION IF EXISTS purge_provider_api_logs(integer)'))
    assert.ok(content.includes('DROP INDEX IF EXISTS idx_task_batches_video_studio_project_created'))
    assert.ok(content.includes('DROP INDEX IF EXISTS idx_task_batches_picture_book_project_created'))
    assert.ok(content.includes('DROP INDEX IF EXISTS idx_task_batches_short_drama_project_created'))
  })
})
