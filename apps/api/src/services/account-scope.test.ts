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

test('ensurePersonalAccountScope 有业管绑定时不再兜底建个人空间（团队由业管同步生成）', async () => {
  // 业管硬切换后，团队完全由业管身份同步生成。ensurePersonalAccountScope 必须先查
  // biz_mgmt_member_bindings，有 status=1 绑定时直接返回不建团队，避免多出无 binding 的脏团队。
  const source = await readFile(join(__dirname, 'account-scope.ts'), 'utf8')
  assert.match(
    source,
    /selectFrom\('biz_mgmt_member_bindings'\)[\s\S]*?where\('local_user_id'[\s\S]*?where\('status', '=', 1\)/,
    'ensurePersonalAccountScope 必须先查 biz_mgmt_member_bindings(status=1)',
  )
  // 有业管绑定必须早返回，不进入建团队分支
  assert.match(source, /if \(bizMgmtBinding\) \{[\s\S]*?return \{ team: null, workspace: null \}/, '有业管绑定必须早返回不建团队')
  // 建团队的 insertInto('teams') 必须在业管绑定检查之后（被跳过）
  const bindingCheckIdx = source.indexOf("selectFrom('biz_mgmt_member_bindings')")
  const insertTeamIdx = source.indexOf("insertInto('teams')")
  assert.ok(bindingCheckIdx >= 0 && insertTeamIdx > bindingCheckIdx, '建团队分支必须在业管绑定检查之后')
})

test('admin 创建团队的 owner 冲突检查排除 personal 团队', async () => {
  const source = await readFile(join(__dirname, '../routes/admin/post-teams.ts'), 'utf-8')

  assert.match(source, /PERSONAL_TEAM_TYPE/)
  assert.match(source, /\.where\('team_type', '!=', PERSONAL_TEAM_TYPE\)/)
})
