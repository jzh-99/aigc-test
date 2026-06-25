import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 1 业管会员绑定表迁移结构测试
 *
 * 与现有迁移测试惯例一致（参考 open-api-migration.test.ts）：
 * 不连真实 PG，仅断言迁移文件源码片段，保证结构/约束/索引/注释正确。
 */
describe('073_biz_mgmt_member_bindings migration', () => {
  test('creates biz_mgmt_member_bindings with local user and team mapping', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/073_biz_mgmt_member_bindings.ts'),
      'utf8',
    )

    assert.match(source, /createTable\('biz_mgmt_member_bindings'\)/)
    assert.match(source, /addColumn\('local_user_id', 'uuid'/)
    assert.match(source, /addColumn\('biz_mgmt_user_id', 'varchar\(64\)'/)
    assert.match(source, /addColumn\('team_id', 'uuid'/)
    assert.match(source, /addColumn\('workspace_id', 'uuid'/)
    assert.match(source, /addUniqueConstraint\('uq_biz_mgmt_member_bindings_biz_mgmt_user_id'/)
    assert.match(source, /COMMENT ON TABLE biz_mgmt_member_bindings/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_member_bindings\.biz_mgmt_user_id/)
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_member_bindings\.is_selected/)
  })
})
