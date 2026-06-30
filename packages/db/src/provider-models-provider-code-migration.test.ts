import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('080_provider_models_provider_code migration', () => {
  test('把 provider_models 从 provider_id 外键迁移为 provider_code 文本关联', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/080_provider_models_provider_code.ts'),
      'utf-8',
    )

    assert.match(source, /ADD COLUMN IF NOT EXISTS provider_code text/)
    assert.match(source, /UPDATE provider_models pm[\s\S]+FROM providers p[\s\S]+p\.id = pm\.provider_id/)
    assert.match(source, /DROP CONSTRAINT IF EXISTS uq_provider_models_code/)
    assert.match(source, /UNIQUE \(provider_code, code\)/)
    assert.match(source, /DROP COLUMN IF EXISTS provider_id/)
    assert.match(source, /idx_provider_models_provider_code/)
  })
})
