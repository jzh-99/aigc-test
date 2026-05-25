import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('043_provider_models_params_pricing_default_array migration', () => {
  test('把 params_pricing 默认值迁移为空数组并修复对象形态数据', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/043_provider_models_params_pricing_default_array.ts'),
      'utf-8',
    )

    assert.match(source, /ALTER COLUMN params_pricing SET DEFAULT '\[\]'::jsonb/)
    assert.match(source, /jsonb_build_array\(params_pricing\)/)
    assert.match(source, /jsonb_agg\(value order by key::int\)/)
  })
})
