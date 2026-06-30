import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('081 migration fixes deployed ctyun Seedream image model id', async () => {
  const source = await readFile(
    join(__dirname, '../migrations/081_fix_ctyun_seedream_model_id.ts'),
    'utf-8',
  )

  assert.match(source, /provider_code = 'ctyun-edge'/)
  assert.match(source, /code = 'ctyun-seedream-5\.0-lite'/)
  assert.match(source, /model: 'ctyun-seedream-5\.0-lite'/)
  assert.match(source, /Doubao-Seedream-5\.0-lite/)
})
