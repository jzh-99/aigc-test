import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('068 migration disables only ctyun Seedream image model by default', async () => {
  const source = await readFile(
    join(__dirname, '../migrations/068_disable_ctyun_seedream_by_default.ts'),
    'utf-8',
  )

  assert.match(source, /SET is_active = false/)
  assert.match(source, /p\.code = 'ctyun-edge'/)
  assert.match(source, /pm\.code = 'ctyun-seedream-5\.0-lite'/)
  assert.doesNotMatch(source, /ctyun-seedance-2\.0/)
  assert.doesNotMatch(source, /ctyun-seedance-2\.0-fast/)
})
