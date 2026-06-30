import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('070 migration aligns Cdream params with official Seedream while keeping ctyun model id', async () => {
  const source = await readFile(
    join(__dirname, '../migrations/070_align_ctyun_edge_model_params.ts'),
    'utf-8',
  )

  assert.match(source, /image_to_image/)
  assert.match(source, /'2k', '3k', '4k'/)
  assert.match(source, /model: 'ctyun-seedream-5\.0-lite'/)
  assert.match(source, /pm\.code = 'ctyun-seedream-5\.0-lite'/)
  assert.doesNotMatch(source, /model: 'seedream-5\.0-lite'/)
  assert.doesNotMatch(source, /Doubao-Seedream-5\.0-lite/)
})
