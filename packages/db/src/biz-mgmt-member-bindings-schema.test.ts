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

describe('079_biz_mgmt_member_bindings_master migration', () => {
  test('adds is_master boolean column with default false and comment', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/079_biz_mgmt_member_bindings_master.ts'),
      'utf8',
    )

    // 必须给 biz_mgmt_member_bindings 加 is_master 列
    assert.match(source, /alterTable\('biz_mgmt_member_bindings'\)/)
    assert.match(source, /addColumn\('is_master', 'boolean'/)
    // 非空 + 默认 false（历史 binding 保守按副卡处理）
    assert.match(source, /notNull\(\)\.defaultTo\(false\)/)
    // 必须有列注释，写清主卡/副卡语义和权威来源
    assert.match(source, /COMMENT ON COLUMN biz_mgmt_member_bindings\.is_master/)
  })
})
