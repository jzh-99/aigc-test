import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('ctyun edge model display names use Cdream and Cdance', async () => {
  const migration = await readFile(
    join(__dirname, '../migrations/069_rename_ctyun_edge_model_display_names.ts'),
    'utf-8',
  )
  const seed = await readFile(join(__dirname, '../scripts/seed.ts'), 'utf-8')

  assert.match(migration, /Cdream 5\.0 Lite/)
  assert.match(migration, /Cdance 2\.0/)
  assert.match(migration, /Cdance 2\.0 Fast/)
  assert.match(seed, /name: 'Cdream 5\.0 Lite'/)
  assert.match(seed, /name: 'Cdance 2\.0'/)
  assert.match(seed, /name: 'Cdance 2\.0 Fast'/)
  assert.doesNotMatch(seed, /name: '天翼云 Seed/)
})
