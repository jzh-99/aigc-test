import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAccountScope } from './account-scope.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('resolveAccountScope 将 personal 团队识别为个人账号空间，其余视为团队账号空间', () => {
  assert.equal(resolveAccountScope('personal'), 'personal')
  assert.equal(resolveAccountScope('standard'), 'team')
  assert.equal(resolveAccountScope('company_a'), 'team')
  assert.equal(resolveAccountScope(undefined), 'team')
})

test('auth 返回 profile 前会补齐个人账号空间', async () => {
  const routeDir = join(__dirname, '../routes/auth')

  for (const filename of ['post-login.ts', 'post-sso.ts', 'post-refresh.ts', 'post-accept-invite.ts']) {
    const source = await readFile(join(routeDir, filename), 'utf-8')
    const ensureIndex = source.indexOf('await ensurePersonalAccountScope')
    const profileIndex = source.indexOf('const profile = await buildUserProfile')

    assert.ok(ensureIndex >= 0, `${filename} should call ensurePersonalAccountScope`)
    assert.ok(profileIndex > ensureIndex, `${filename} should build profile after ensuring personal scope`)
    assert.match(source, /buildAuthResponse/, `${filename} should include account scope fields in auth response`)
  }
})

test('admin 创建团队的 owner 冲突检查排除 personal 团队', async () => {
  const source = await readFile(join(__dirname, '../routes/admin/post-teams.ts'), 'utf-8')

  assert.match(source, /PERSONAL_TEAM_TYPE/)
  assert.match(source, /\.where\('team_type', '!=', PERSONAL_TEAM_TYPE\)/)
})
