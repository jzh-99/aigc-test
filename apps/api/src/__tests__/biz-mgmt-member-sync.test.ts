import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeBizMgmtMember, pickDefaultBizMgmtMemberName } from '../services/biz-mgmt-member-sync.js'

test('normalizeBizMgmtMember keeps identity and entitlement fields only', () => {
  const result = normalizeBizMgmtMember({
    userId: 'AED8352BF32B429EAB0EE4C8295391BC',
    phone: '17714420972',
    userName: '个人账号',
    compName: '个人',
    userType: '1',
    status: 1,
    pointsNum: 500,
    sumPointsNum: 800,
    consumePointsNum: 0,
    goodsId: 'TOBYAI000009',
    goodsName: '随心选兑换',
    createTime: '2026-06-23 14:08:10',
  })

  assert.equal(result.bizMgmtUserId, 'AED8352BF32B429EAB0EE4C8295391BC')
  assert.equal(result.userType, '1')
  assert.equal(result.teamName, '个人账号')
  // A 豆余额/累计消费不得落入本地标准化结构，避免被误写入绑定表
  assert.equal('pointsNum' in result, false)
  assert.equal('sumPointsNum' in result, false)
  assert.equal('consumePointsNum' in result, false)
})

test('company member team name prefers compName', () => {
  assert.equal(pickDefaultBizMgmtMemberName({ userName: '吃瓜', compName: '牛奶', userType: '2' }), '牛奶')
})

test('syncBizMgmtMembersForLocalUser is exported for login orchestration', async () => {
  const mod = await import('../services/biz-mgmt-member-sync.js')
  assert.equal(typeof mod.syncBizMgmtMembersForLocalUser, 'function')
})

// ─── status 全量同步契约（1正常/2冻结/3删除）──────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const SYNC_SOURCE = readFileSync(join(__dirname, '..', 'services', 'biz-mgmt-member-sync.ts'), 'utf8')

test('fetchBizMgmtMembersByPhone 不再过滤 status=1，返回全量 status 给 sync 分流', () => {
  // 旧代码有 .filter((member) => member.status === 1)，移除后不应出现
  assert.doesNotMatch(
    SYNC_SOURCE,
    /\.filter\(\s*\(\s*member\s*\)\s*=>\s*member\.status\s*===\s*1\s*\)/,
    'fetchBizMgmtMembersByPhone 不应再过滤 status===1，需返回全量 status 给 sync 分流',
  )
})

test('sync 按 status 分流：status=3 软删 team + 清空 is_selected，status=2 不动 team', () => {
  // status=3 分支必须软删 team（is_deleted=true）
  assert.match(SYNC_SOURCE, /member\.status\s*===\s*3[\s\S]*?is_deleted.*true/, 'status=3 必须软删 team')
  // status=3 必须清空悬空 is_selected（clearIfSelected=true）
  assert.match(SYNC_SOURCE, /member\.status\s*===\s*3[\s\S]*?clearIfSelected/, 'status=3 必须 clearIfSelected 清空 is_selected')
  // status=2 分支必须存在且不软删 team
  assert.match(SYNC_SOURCE, /member\.status\s*===\s*2/, 'sync 必须有 status=2 分支')
  // 旧的 not in 冻结逻辑必须移除
  assert.doesNotMatch(SYNC_SOURCE, /'not in'[\s\S]*?biz_mgmt_member_bindings/, '不应再用 not in 推断冻结（改用业管权威 status）')
})

test('normalizeBizMgmtMember 保留 status 1/2/3（不再强制过滤）', () => {
  const result = normalizeBizMgmtMember({
    userId: 'X', phone: '1', userName: 'u', compName: 'c', userType: '1', status: 3,
  })
  assert.equal(result.status, 3, 'status=3 的会员应能被 normalize 保留，不抛错')
})
