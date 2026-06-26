import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ───────────────────────────────────────────────────────────────────────────
// /auth/check-biz-mgmt 接口契约测试
//
// 这是两步式登录"下一步"按钮的后端实现。
// 用户明确要求（2026-06-26）：输入手机号点"下一步"时就要从业管获取数据，
// 业管有会员才进密码步，业管查无就立即报"用户不存在"。
//
// 本测试验证接口实现了业管先行的查询语义：
//   - 调用 fetchBizMgmtMembersByPhone 查业管
//   - 业管查无（空数组）或故障（catch）→ 清理本地孤儿 + 401 BIZ_MGMT_NOT_FOUND
//   - 业管有会员 → 200 { exists: true }
// ───────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  join(__dirname, '..', 'routes', 'auth', 'post-check-biz-mgmt.ts'),
  'utf8',
)

describe('check-biz-mgmt 业管查询契约', () => {
  it('路由必须是 POST /auth/check-biz-mgmt', () => {
    assert.match(SOURCE, /app\.post.*'\/auth\/check-biz-mgmt'/, '必须是 POST /auth/check-biz-mgmt')
  })

  it('必须调用 fetchBizMgmtMembersByPhone 查业管', () => {
    assert.match(SOURCE, /fetchBizMgmtMembersByPhone/, '必须调 fetchBizMgmtMembersByPhone')
  })

  it('业管查询必须用 try/catch 包裹（故障等同查无）', () => {
    assert.match(
      SOURCE,
      /try\s*\{[\s\S]*fetchBizMgmtMembersByPhone[\s\S]*catch/,
      'fetchBizMgmtMembersByPhone 必须在 try/catch 中，故障时按查无处理',
    )
  })

  it('业管查无时必须返回 BIZ_MGMT_NOT_FOUND', () => {
    assert.match(SOURCE, /BIZ_MGMT_NOT_FOUND/, '业管查无必须返回 BIZ_MGMT_NOT_FOUND')
  })

  it('业管查无时若有本地孤儿 user，必须调 purgeLocalUserCascade 清理', () => {
    // purgeLocalUserCascade 必须在长度为 0 的分支内被调用
    assert.match(
      SOURCE,
      /length\s*===\s*0[\s\S]*purgeLocalUserCascade/,
      'members.length===0 分支内必须调 purgeLocalUserCascade（清理本地孤儿）',
    )
  })

  it('purgeLocalUserCascade 必须受"本地 user 存在"条件保护', () => {
    assert.match(
      SOURCE,
      /if\s*\(\s*existingUser\s*\)\s*\{[\s\S]*purgeLocalUserCascade/,
      'purgeLocalUserCascade 必须在确认 existingUser 存在后才调用',
    )
  })

  it('业管有会员时必须返回 exists: true', () => {
    assert.match(SOURCE, /exists:\s*true/, '业管有会员时返回 { exists: true }')
  })

  it('必须用 /^1\\d{10}$/ 校验手机号格式', () => {
    assert.match(SOURCE, /\/\^1\\d\{10\}\$\//, '必须用 /^1\\d{10}$/ 校验手机号')
  })

  it('必须导入 fetchBizMgmtMembersByPhone 和 purgeLocalUserCascade', () => {
    assert.match(SOURCE, /import[\s\S]*fetchBizMgmtMembersByPhone/, '必须导入 fetchBizMgmtMembersByPhone')
    assert.match(SOURCE, /import[\s\S]*purgeLocalUserCascade/, '必须导入 purgeLocalUserCascade')
  })
})
