import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('071_c_client_config_tables migration', () => {
  test('adds C端 config tables and shared client scope columns', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/071_c_client_config_tables.ts'),
      'utf-8',
    )

    for (const tableName of [
      'creation_templates',
      'daily_news',
      'prompt_inspirations',
      'music_styles',
      'mini_user_auth_records',
      'mini_user_push_rules',
    ]) {
      assert.match(source, new RegExp(`createTable\\('${tableName}'\\)`))
    }

    for (const skippedTable of [
      'product',
      'points',
      'user_info',
      'user_white',
      'user_works',
      'xxl_job',
      'voice_group',
    ]) {
      assert.doesNotMatch(source, new RegExp(`createTable\\('${skippedTable}'\\)`))
    }

    assert.match(source, /client_scopes/)
    assert.match(source, /ARRAY\['mini_program', 'enterprise', 'screen'\]/)
    assert.match(source, /provider_system_voices/)
    assert.match(source, /sort_order/)
    assert.match(source, /team_type IN \('standard', 'company_a', 'avatar_enabled', 'personal'\)/)
    assert.match(source, /Cannot rollback 071_c_client_config_tables while personal teams exist/)
    assert.match(source, /WHERE team_type = 'personal'/)
  })
})
