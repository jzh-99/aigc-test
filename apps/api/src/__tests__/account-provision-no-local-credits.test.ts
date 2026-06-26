import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Task 21（Phase D）账户初始化/开通不再创建本地积分账户。
 *
 * 硬切换后本地积分系统已退役：个人空间初始化、开放接口调用方开通、管理员建团队、
 * 业管会员身份落地均不再 insertInto credit_accounts。余额权威在业管，本地不需要积分账户。
 */
describe('account-scope no longer creates local credit account', () => {
  test('ensurePersonalAccountScope does not insert credit_accounts', async () => {
    const source = await readFile(join(__dirname, '../services/account-scope.ts'), 'utf8')
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
    assert.doesNotMatch(source, /ensureTeamCreditAccount/)
  })
})

describe('provision-caller no longer creates local credit account', () => {
  test('provisionCaller does not insert credit_accounts', async () => {
    const source = await readFile(join(__dirname, '../lib/provision-caller.ts'), 'utf8')
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
  })
})

describe('admin create-team no longer creates local credit account', () => {
  test('post-teams does not insert credit_accounts', async () => {
    const source = await readFile(join(__dirname, '../routes/admin/post-teams.ts'), 'utf8')
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
    assert.doesNotMatch(source, /selectFrom\('credit_accounts'\)/)
  })
})

describe('biz-mgmt member sync no longer creates local credit account', () => {
  test('syncBizMgmtMembersForLocalUser does not insert credit_accounts', async () => {
    const source = await readFile(join(__dirname, '../services/biz-mgmt-member-sync.ts'), 'utf8')
    assert.doesNotMatch(source, /insertInto\('credit_accounts'\)/)
  })
})
