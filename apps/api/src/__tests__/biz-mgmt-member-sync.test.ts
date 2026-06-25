import { test } from 'node:test'
import assert from 'node:assert/strict'
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
