import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('067_ctyun_edge_provider migration', () => {
  test('adds ctyun-edge provider and independent Seedream/Seedance models', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/067_ctyun_edge_provider.ts'),
      'utf-8',
    )

    assert.match(source, /ctyun-edge/)
    assert.match(source, /天翼云边缘AI网关/)
    assert.match(source, /ctyun-seedream-5\.0-lite/)
    assert.match(source, /Doubao-Seedream-5\.0-lite/)
    assert.match(source, /image_to_image/)
    assert.match(source, /resolution:\s*\['2k', '3k', '4k'\]/)
    assert.match(source, /is_active:\s*false/)
    assert.match(source, /ctyun-seedance-2\.0/)
    assert.match(source, /cdance2\.0-0611/)
    assert.match(source, /ctyun-seedance-2\.0-fast/)
    assert.match(source, /cdance2\.0-fast-0611/)
    assert.match(source, /module:\s*'image'/)
    assert.match(source, /module:\s*'video'/)
  })
})
