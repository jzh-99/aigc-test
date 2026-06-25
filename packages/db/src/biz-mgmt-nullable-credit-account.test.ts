import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('076_drop_local_credit_constraints migration', () => {
  test('makes task_batches.credit_account_id nullable', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/076_drop_local_credit_constraints.ts'),
      'utf8',
    )
    assert.match(source, /ALTER TABLE task_batches ALTER COLUMN credit_account_id DROP NOT NULL/)
    assert.match(source, /COMMENT ON COLUMN task_batches.credit_account_id/)
  })
})
