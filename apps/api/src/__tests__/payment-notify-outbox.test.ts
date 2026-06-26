import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 19 支付回调转业管订购同步测试。
 *
 * 关键不变量（硬切换）：
 * - 支付成功不再给本地 credit_accounts 加余额、不再写 credits_ledger；
 * - 改为写 subscribe_sync outbox 事件，由业管负责加 A 豆；
 * - outbox 写入与订单状态更新在同一事务，保证一致性。
 */
describe('payment post-notify redirects to biz-mgmt subscribe outbox', () => {
  test('does not touch local credit accounts or ledger on payment success', async () => {
    const source = await readFile(
      join(__dirname, '../routes/payment/post-notify.ts'),
      'utf8',
    )
    // 禁止出现本地积分入账相关操作
    assert.doesNotMatch(source, /updateTable\('credit_accounts'\)/)
    assert.doesNotMatch(source, /balance: sql`balance \+/)
    assert.doesNotMatch(source, /insertInto\('credits_ledger'\)/)
  })

  test('writes subscribe_sync outbox event in same transaction as order paid', async () => {
    const source = await readFile(
      join(__dirname, '../routes/payment/post-notify.ts'),
      'utf8',
    )
    assert.match(source, /event_type: 'subscribe_sync'/)
    assert.match(source, /dedupe_key: requestNo/)
    // outbox 写入必须在 transaction 内，与订单 paid 同事务
    assert.match(source, /db\.transaction\(\)\.execute/)
    assert.match(source, /status: 'paid'/)
    // 幂等：重复回调不重复创建事件
    assert.match(source, /onConflict\(\(oc\) => oc\.column\('dedupe_key'\)\.doNothing\(\)\)/)
  })
})

describe('payment post-create-order drops local credit account creation', () => {
  test('no longer creates or associates credit_accounts', async () => {
    const source = await readFile(
      join(__dirname, '../routes/payment/post-create-order.ts'),
      'utf8',
    )
    // 禁止出现 ensureCreditAccount 及 credit_accounts 插入
    assert.doesNotMatch(source, /ensureCreditAccount/)
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
    // 订单 credit_account_id 置空，本地不再关联积分账户
    assert.match(source, /credit_account_id: null/)
  })
})

describe('payment balance/ledger delegates to biz-mgmt', () => {
  test('queries biz-mgmt balance and ledger instead of local tables', async () => {
    const source = await readFile(
      join(__dirname, '../routes/payment/get-ledger-balance.ts'),
      'utf8',
    )
    assert.match(source, /queryCurrentBizMgmtBalance/)
    assert.match(source, /queryCurrentBizMgmtLedger/)
    // 禁止查询本地积分表
    assert.doesNotMatch(source, /selectFrom\('credit_accounts'\)/)
    assert.doesNotMatch(source, /selectFrom\('credits_ledger'\)/)
  })
})
