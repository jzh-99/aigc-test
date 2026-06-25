import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 7 业管 A 豆扣减审计表迁移结构测试。
 *
 * 关键约束：本表只记录扣减审计，不保存余额/累计消费快照；
 * 创作结果同步状态以 biz_mgmt_outbox_events 为准，不在本表落字段。
 */
describe('074_biz_mgmt_a_bean_transactions migration', () => {
  test('creates idempotent audit table without storing balance snapshots', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/074_biz_mgmt_a_bean_transactions.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_a_bean_transactions'\)/)
    assert.match(source, /addColumn\('biz_mgmt_user_id', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('request_no', 'varchar\(128\)'/)
    assert.match(source, /addColumn\('work_no', 'varchar\(128\)'/)
    assert.match(source, /addColumn\('points_num', 'numeric\(12, 2\)'/)
    // 不得保存余额/累计消费快照
    assert.doesNotMatch(source, /balance_snapshot|sum_points|consume_points/)
    assert.match(source, /COMMENT ON TABLE biz_mgmt_a_bean_transactions/)
    // 创作结果同步状态不在本表，统一走 outbox
    assert.doesNotMatch(source, /result_sync_status|result_payload|result_response|result_sync_attempts/)
  })
})
