import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SHORT_DRAMA_UPLOAD_MAX_EPISODE_COUNT } from '@aigc/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('短剧项目集数数据库约束覆盖上传剧本模式上限', async () => {
  const createMigration = await readFile(
    join(__dirname, '../migrations/052_short_drama.ts'),
    'utf-8',
  )
  const commentsMigration = await readFile(
    join(__dirname, '../migrations/060_db_comments.ts'),
    'utf-8',
  )

  assert.equal(SHORT_DRAMA_UPLOAD_MAX_EPISODE_COUNT, 100)
  assert.match(createMigration, /chk_short_drama_episode_count CHECK \(episode_count >= 1 AND episode_count <= 100\)/)
  assert.match(commentsMigration, /short_drama_projects\.episode_count IS '总集数（范围 1~100）/)
  assert.match(commentsMigration, /上传剧本模式.*上限 100/)
})
