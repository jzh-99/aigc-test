import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('biz mgmt A bean display balance cache', () => {
  test('team detail reads Redis display cache instead of local balance tables', async () => {
    const source = await readFile(join(__dirname, '../routes/teams/get-by-id.ts'), 'utf8')
    assert.match(source, /readBizMgmtBalanceCache/)
    assert.match(source, /a_bean_balance/)
    assert.doesNotMatch(source, /selectFrom\('credit_accounts'\)/)
    assert.doesNotMatch(source, /selectFrom\('credits_ledger'\)/)
    assert.doesNotMatch(source, /updateTable\('team_members'\)[\s\S]*a_bean_balance/)
  })

  test('current balance query refreshes Redis cache after querying biz mgmt', async () => {
    const source = await readFile(join(__dirname, '../routes/credits/get-biz-mgmt-balance.ts'), 'utf8')
    assert.match(source, /refreshBizMgmtBalanceCache/)
    assert.match(source, /updated_at/)
  })

  test('login refreshes display cache but does not block login on cache refresh failure', async () => {
    const source = await readFile(join(__dirname, '../routes/auth/post-login.ts'), 'utf8')
    assert.match(source, /refreshBizMgmtBalanceCache/)
    assert.match(source, /Promise\.allSettled/)
    assert.match(source, /失败不影响登录/)
  })

  test('member balance refresh is scoped to team owner and writes only Redis cache', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-member-biz-mgmt-balance-refresh.ts'),
      'utf8',
    )
    assert.match(source, /teamRoleGuard\('owner'\)/)
    assert.match(source, /refreshBizMgmtBalanceCache/)
    assert.doesNotMatch(source, /updateTable\('team_members'\)/)
    assert.doesNotMatch(source, /insertInto\('credits_ledger'\)/)
  })

  test('member biz mgmt sync binds current team only and refreshes display cache', async () => {
    const source = await readFile(
      join(__dirname, '../routes/teams/post-member-biz-mgmt-sync.ts'),
      'utf8',
    )
    assert.match(source, /teamRoleGuard\('owner'\)/)
    assert.match(source, /member_sync_debounce/)
    assert.match(source, /BIZ_MGMT_SYNC_DEBOUNCED/)
    assert.match(source, /fetchBizMgmtMembersByPhone/)
    assert.match(source, /insertInto\('biz_mgmt_member_bindings'\)/)
    assert.match(source, /doUpdateSet/)
    assert.match(source, /refreshBizMgmtBalanceCache/)
    assert.doesNotMatch(source, /BIZ_MGMT_MEMBER_ALREADY_BOUND/)
    assert.doesNotMatch(source, /insertInto\('teams'\)/)
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
    assert.doesNotMatch(source, /updateTable\('team_members'\)/)
  })

  test('balance cache debounces short interval refreshes before calling biz mgmt', async () => {
    const source = await readFile(join(__dirname, '../services/biz-mgmt-balance-cache.ts'), 'utf8')
    assert.match(source, /BALANCE_REFRESH_DEBOUNCE_SECONDS = 5/)
    assert.match(source, /isCacheFresh/)
    assert.match(source, /return cached/)
    assert.match(source, /queryTobyMemberPoints/)
  })
})
