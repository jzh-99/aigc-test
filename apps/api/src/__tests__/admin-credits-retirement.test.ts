import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 20（Phase D）管理员充值/配额退役 + 团队/用户列表移除本地余额列。
 *
 * 硬切换后本地积分系统已退役：余额权威在业管，本地不再维护 credit_accounts /
 * credits_ledger，也不再用 team_members 的配额列做计费。本测试锁定这些路由不再
 * 读写本地积分表，避免回退到已被废弃的本地计费路径。
 */
describe('admin team credits topup is retired', () => {
  test('no longer writes local credit accounts or ledger', async () => {
    const source = await readFile(
      join(__dirname, '../routes/admin/post-teams-id-credits.ts'),
      'utf8',
    )
    // 管理员调整 A 豆接口已退役：不再读写本地 credit_accounts / credits_ledger
    assert.doesNotMatch(source, /updateTable\('credit_accounts'\)/)
    assert.doesNotMatch(source, /insertInto\('credits_ledger'\)/)
    assert.doesNotMatch(source, /selectFrom\('credit_accounts'\)/)
    // 必须返回退役提示，而不是静默成功
    assert.match(source, /余额由业管平台统一管理|已迁移至业管|退役|retired/)
  })
})

describe('admin member credits reset is retired', () => {
  test('no longer resets local member quota usage', async () => {
    const source = await readFile(
      join(__dirname, '../routes/admin/post-teams-id-members-uid-reset-credits.ts'),
      'utf8',
    )
    // 成员配额已移除：不再 update team_members 配额字段，不再回传 credit_used
    assert.doesNotMatch(source, /updateTable\('team_members'\)/)
    assert.doesNotMatch(source, /credit_used:\s*0/)
    // 必须返回退役提示，而不是静默成功
    assert.match(source, /配额|余额由业管|退役|retired/)
  })
})

describe('admin teams list drops local balance columns', () => {
  test('does not join or aggregate credit_accounts / credits_ledger', async () => {
    const source = await readFile(
      join(__dirname, '../routes/admin/get-teams.ts'),
      'utf8',
    )
    // 不再以任何方式查询本地积分表（join/select/update 均不允许）
    assert.doesNotMatch(source, /(leftJoin|innerJoin|selectFrom|updateTable|insertInto)\('credit_accounts'\)/)
    assert.doesNotMatch(source, /(leftJoin|innerJoin|selectFrom|updateTable|insertInto)\('credits_ledger'\)/)
    // 旧本地余额字段不再回传
    assert.doesNotMatch(source, /frozen_credits|total_earned|total_spent|lifetime_used/)
  })
})

describe('admin users list drops local balance columns', () => {
  test('does not select member quota fields or aggregate credits_ledger', async () => {
    const source = await readFile(
      join(__dirname, '../routes/admin/get-users.ts'),
      'utf8',
    )
    // 不再查询本地积分/配额表，不再回传 credit_quota / credit_used / lifetime_used
    assert.doesNotMatch(source, /(leftJoin|innerJoin|selectFrom|updateTable|insertInto)\('credits_ledger'\)/)
    assert.doesNotMatch(source, /select\(\['team_members\.user_id', 'team_members\.credit_quota'/)
    assert.doesNotMatch(source, /credit_used|credit_quota|lifetime_used/)
  })
})

describe('team detail drops local credits', () => {
  test('does not query credit_accounts and omits credits field', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/get-by-id.ts'),
      'utf8',
    )
    assert.doesNotMatch(source, /selectFrom\('credit_accounts'\)/)
    assert.doesNotMatch(source, /credits:/)
  })
})

describe('team member batch-quota management is retired', () => {
  test('no longer writes member credit_quota / quota_period', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/patch-batch-quota.ts'),
      'utf8',
    )
    // 成员配额已移除：不再 update team_members 的配额字段
    assert.doesNotMatch(source, /updateTable\('team_members'\)/)
    assert.match(source, /配额|余额由业管|退役|retired/)
  })
})
