import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 078 迁移：彻底删除本地积分系统遗留表与配额列（A2 彻底删表 + C2 删配额列）。
 *
 * 关键约束（破坏性 DDL 必须严格按依赖顺序）：
 * - 先删引用方的 FK 约束，再删列，最后删表；
 * - credits_ledger 引用 credit_accounts，必须先于 credit_accounts 删除；
 * - FK 约束名通过 pg_constraint 动态查询，避免自动命名不确定性；
 * - down 只做 DDL 反向重建，不夹带数据回填。
 */
describe('078_drop_local_credit_tables migration', () => {
  test('drops credit_accounts and credits_ledger tables', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/078_drop_local_credit_tables.ts'),
      'utf8',
    )
    // 必须删两张表
    assert.match(source, /DROP TABLE IF EXISTS credits_ledger/)
    assert.match(source, /DROP TABLE IF EXISTS credit_accounts/)
  })

  test('drops foreign keys before dropping columns and tables', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/078_drop_local_credit_tables.ts'),
      'utf8',
    )
    // FK 约束名动态查询（pg_constraint），不写死约束名
    assert.match(source, /pg_constraint/)
    // 删除 task_batches / payment_orders 的 credit_account_id 列（允许 IF EXISTS 守卫）
    assert.match(source, /DROP COLUMN (IF EXISTS )?credit_account_id/)
  })

  test('drops team_members quota columns', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/078_drop_local_credit_tables.ts'),
      'utf8',
    )
    assert.match(source, /DROP COLUMN (IF EXISTS )?credit_quota/)
    assert.match(source, /DROP COLUMN (IF EXISTS )?credit_used/)
    assert.match(source, /DROP COLUMN (IF EXISTS )?quota_period/)
    assert.match(source, /DROP COLUMN (IF EXISTS )?quota_reset_at/)
  })

  test('drops credit_accounts updated_at trigger', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/078_drop_local_credit_tables.ts'),
      'utf8',
    )
    assert.match(source, /DROP TRIGGER IF EXISTS trg_credit_accounts_updated_at/)
  })

  test('down rebuilds structure without data backfill', async () => {
    const source = await readFile(
      join(__dirname, '../migrations/078_drop_local_credit_tables.ts'),
      'utf8',
    )
    // down 必须存在且为反向 DDL
    assert.match(source, /export async function down/)
    // down 不得夹带数据回填（D1：清理 076 风格的粗糙 UPDATE）
    const downSection = source.split('export async function down')[1] ?? ''
    assert.doesNotMatch(downSection, /UPDATE task_batches SET credit_account_id/)
  })
})
