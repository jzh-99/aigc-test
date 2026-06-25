import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 8 业管通知 outbox 表迁移结构测试。
 *
 * 关键约束：所有通知业管的事件必须经 outbox + biz-mgmt-notify-queue；
 * 成功和失败记录都保留；payload 是复杂 JSONB，注释必须逐层说明。
 */
describe('075_biz_mgmt_outbox_events migration', () => {
  test('creates retryable business management outbox event table', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/075_biz_mgmt_outbox_events.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_outbox_events'\)/)
    assert.match(source, /addColumn\('event_type', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('status', 'varchar\(32\)'/)
    assert.match(source, /addColumn\('payload', 'jsonb'/)
    assert.match(source, /addColumn\('attempt_count', 'integer'/)
    assert.match(source, /addColumn\('max_attempts', 'integer'/)
    assert.match(source, /addColumn\('next_attempt_at', 'timestamptz'/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_outbox_events\.payload/)
    // payload 注释必须逐层说明两类事件字段
    assert.match(source, /creation_result_notify/)
    assert.match(source, /member_sub_card_sync/)
  })
})
