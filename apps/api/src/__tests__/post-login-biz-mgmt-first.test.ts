import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ───────────────────────────────────────────────────────────────────────────
// post-login 业管先行登录流程契约测试
//
// 需求（计划 Critical Login Invariant + 用户 2026-06-26 澄清）：
// 业管是账号唯一判官。手机号登录时必须【无条件先查业管】判存亡，
// 再决定是否查本地 / 创建本地用户 / 校验密码。
//
// 本测试用源码文本扫描验证 post-login.ts 的控制流符合业管先行语义，
// 覆盖 4 种关键分支：
//   ① 业管查无会员（或故障）+ 本地无 user → 直接 401 USER_NOT_FOUND
//   ② 业管查无会员（或故障）+ 本地有 user → 清理孤儿(purgeLocalUserCascade) + 401
//   ③ 业管有会员 + 本地无 user → 创建本地 user/team/workspace + 初始密码
//   ④ 业管有会员 + 本地有 user → bcrypt 校验密码
//
// 另外验证两个不变量：
//   - 业管同步改为异步（不 await，不阻塞登录性能）
//   - 邮箱登录走旧逻辑（本地先行），不被业管先行影响
// ───────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  join(__dirname, '..', 'routes', 'auth', 'post-login.ts'),
  'utf8',
)

describe('post-login 业管先行：手机号登录主流程契约', () => {
  it('必须导入 fetchBizMgmtMembersByPhone（业管查询入口）', () => {
    assert.match(
      SOURCE,
      /fetchBizMgmtMembersByPhone/,
      '业管先行必须导入并调用 fetchBizMgmtMembersByPhone',
    )
  })

  it('必须导入 purgeLocalUserCascade（孤儿清理入口）', () => {
    assert.match(
      SOURCE,
      /purgeLocalUserCascade/,
      '业管查无时若本地有 user 必须调用 purgeLocalUserCascade 清理',
    )
  })

  it('必须导入 ensureLocalUserForBizMgmtPhone（本地用户初始化）', () => {
    assert.match(
      SOURCE,
      /ensureLocalUserForBizMgmtPhone/,
      '业管有会员但本地无 user 时必须调用 ensureLocalUserForBizMgmtPhone 创建本地用户',
    )
  })

  it('必须用正则 /^1\\d{10}$/ 识别手机号（区分手机号登录与邮箱登录分支）', () => {
    assert.match(
      SOURCE,
      /\/\^1\\d\{10\}\$\//,
      '必须用 /^1\\d{10}$/ 判断 identifier 是否为手机号，以分流业管先行逻辑',
    )
  })
})

// ─── 分支 ① ②：业管查无 / 故障 ─────────────────────────────────────────────
describe('post-login 业管先行：分支①② 业管查无或故障', () => {
  it('必须返回 BIZ_MGMT_NOT_FOUND 错误码（前端据此切回手机号步）', () => {
    assert.match(
      SOURCE,
      /BIZ_MGMT_NOT_FOUND/,
      '业管查无会员时必须返回 BIZ_MGMT_NOT_FOUND，前端区分"用户不存在"与"密码错"',
    )
  })

  it('返回 BIZ_MGMT_NOT_FOUND 前必须提示"用户不存在"或类似文案', () => {
    assert.match(
      SOURCE,
      /用户不存在|未查询到可用会员|账号不存在/,
      'BIZ_MGMT_NOT_FOUND 应有面向用户的"用户不存在"类提示',
    )
  })

  it('业管查询失败（fetchBizMgmtMembersByPhone throw）必须被捕获并走查无分支', () => {
    // 查无和故障都要走到同一个"拒绝+清理"分支，所以 fetch 必须包在 try/catch 里
    assert.match(
      SOURCE,
      /try\s*\{[^}]*fetchBizMgmtMembersByPhone|catch.*purgeLocalUserCascade|fetchBizMgmtMembersByPhone[\s\S]*catch/,
      'fetchBizMgmtMembersByPhone 必须包在 try/catch 中，故障时走与查无相同的拒绝分支',
    )
  })
})

// ─── 分支 ②：业管查无 + 本地有 user → 清理孤儿 ─────────────────────────────
describe('post-login 业管先行：分支② 本地有孤儿 user 时清理', () => {
  it('purgeLocalUserCascade 的调用必须受"本地 user 存在"条件保护（无 user 不必清理）', () => {
    // purgeLocalUserCascade 不能无条件调用，否则本地无 user 时会报错
    // 必须在 if (existingUser) 之类条件内，或在 ?. 可选链后
    assert.match(
      SOURCE,
      /if\s*\([^)]*user[^)]*\)\s*\{[^}]*purgeLocalUserCascade|existingUser[^;]*purgeLocalUserCascade|purgeLocalUserCascade[^;]*existingUser/,
      'purgeLocalUserCascade 必须在确认本地 user 存在后才调用，否则本地无 user 时会误调用',
    )
  })
})

// ─── 分支 ③ ④：业管有会员 ──────────────────────────────────────────────────
describe('post-login 业管先行：分支③④ 业管有会员', () => {
  it('业管有会员时必须查本地 users（phone 匹配）决定创建或校验', () => {
    // 必须有针对 phone 的本地查询
    assert.match(
      SOURCE,
      /selectFrom\('users'\)[\s\S]*'phone'[\s\S]*identifier|'phone'[\s\S]*identifier[\s\S]*selectFrom\('users'\)/,
      '业管有会员后必须查本地 users.phone，决定是创建本地用户还是校验密码',
    )
  })

  it('本地无 user 时必须调 ensureLocalUserForBizMgmtPhone 并接收 oneTimePassword', () => {
    assert.match(
      SOURCE,
      /ensureLocalUserForBizMgmtPhone[\s\S]*oneTimePassword|oneTimePassword[\s\S]*ensureLocalUserForBizMgmtPhone/,
      '本地无 user 时必须调 ensureLocalUserForBizMgmtPhone 并取一次性初始密码',
    )
  })

  it('必须保留 bcrypt.compare 密码校验（本地 user 存在时）', () => {
    assert.match(SOURCE, /bcrypt\.compare/, '本地 user 存在时必须用 bcrypt.compare 校验密码')
  })
})

// ─── 不变量：业管同步异步化（不阻塞登录）──────────────────────────────────
describe('post-login 业管先行：异步刷新不变量', () => {
  it('syncBizMgmtMembersForLocalUser 必须异步调用（不 await，不阻塞登录响应）', () => {
    // 关键：不能用 await syncBizMgmtMembersForLocalUser，否则业管慢会拖慢登录
    // 应使用 setImmediate / queueMicrotask / .catch() 等异步触发
    assert.match(
      SOURCE,
      /setImmediate\([^)]*syncBizMgmtMembersForLocalUser|queueMicrotask\([^)]*syncBizMgmtMembersForLocalUser|syncBizMgmtMembersForLocalUser[^;]*\.catch/,
      'syncBizMgmtMembersForLocalUser 必须异步触发（setImmediate/queueMicrotask/.catch），不能用 await 阻塞登录',
    )
    // 反向断言：不允许出现 "await syncBizMgmtMembersForLocalUser"
    assert.doesNotMatch(
      SOURCE,
      /await\s+syncBizMgmtMembersForLocalUser/,
      '禁止 await syncBizMgmtMembersForLocalUser，会阻塞登录响应',
    )
  })
})

// ─── 不变量：邮箱登录走旧逻辑 ──────────────────────────────────────────────
describe('post-login 业管先行：邮箱登录兼容不变量', () => {
  it('邮箱登录（非手机号）必须走本地密码校验，不触发业管查询', () => {
    // 手机号判断的 else 分支或早期 return 必须保留邮箱的本地校验路径
    // 验证：account 匹配查询仍存在（邮箱登录用 account 字段）
    assert.match(
      SOURCE,
      /'account'/,
      '邮箱登录依赖 users.account 查询，必须保留',
    )
  })

  it('必须保留 ACCOUNT_LOCKED / 频率限制等安全机制', () => {
    assert.match(SOURCE, /ACCOUNT_LOCKED|checkAccountLocked/, '必须保留账户锁定检查')
    assert.match(SOURCE, /rateLimit/, '必须保留频率限制')
  })
})
