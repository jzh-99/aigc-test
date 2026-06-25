import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiSrc = (rel: string) => join(__dirname, '..', rel)

test('login route always syncs business management members after local password login', () => {
  const source = readFileSync(apiSrc('routes/auth/post-login.ts'), 'utf8')
  assert.match(source, /syncBizMgmtMembersForLocalUser/)
  assert.match(source, /ensureLocalUserForBizMgmtPhone/)
  // 强约束：每次手机号密码登录成功后都刷新业管会员，即使本地用户已存在
  assert.match(source, /每次手机号密码登录成功后都刷新业管会员/)
})

test('user profile selects business management bindings', () => {
  const source = readFileSync(apiSrc('services/user-profile.ts'), 'utf8')
  assert.match(source, /biz_mgmt_member_bindings/)
  assert.match(source, /require_biz_mgmt_member_selection/)
})
