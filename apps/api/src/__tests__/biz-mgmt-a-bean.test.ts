import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
  mapTobyPointsChangeRecord,
} from '../services/biz-mgmt-a-bean.js'

test('deduct request number is stable for batch and task', () => {
  assert.equal(
    buildBizMgmtDeductRequestNo({ batchId: 'batch-1', taskId: 'task-1' }),
    'bizmgmt-batch-1-task-1',
  )
})

test('balance normalization accepts numeric strings only', () => {
  assert.equal(normalizeBizMgmtPointsBalance({ pointsNum: '97.00' }), 97)
  assert.throws(() => normalizeBizMgmtPointsBalance({ pointsNum: 'abc' }), /A 豆余额格式错误/)
})

test('ledger query clamps page size and maps current member id', () => {
  assert.deepEqual(
    normalizeBizMgmtPointsLedgerQuery({ bizMgmtUserId: 'u1', pageNum: 0, pageSize: 999 }),
    { userId: 'u1', pageNum: 1, pageSize: 100 },
  )
})

test('ledger record maps 5 known changeTypes with correct amount sign', () => {
  const base = {
    changeNo: 'c1',
    userId: 'u1',
    changeTypeName: '类型名',
    bizNo: 'biz1',
    changeReason: '原因',
    source: '1',
    operateUser: 'op',
    remark: '备注',
    createTime: '2026-06-21 10:00:00',
  }
  // changeType 1 扣减 → 负；createTime 无时区原样透传
  assert.deepEqual(
    mapTobyPointsChangeRecord({ ...base, changeType: 1, changePointsNum: '10.00', balancePointsNum: '90.00' }),
    {
      id: 'c1', type: 'deduct', typeName: '类型名', amount: -10, balanceAfter: 90,
      bizNo: 'biz1', reason: '原因', source: 1, operator: 'op', remark: '备注', createdAt: '2026-06-21 10:00:00',
    },
  )
  // changeType 2 返还 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 2, changePointsNum: 5, balancePointsNum: 95 }).amount,
    5,
  )
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 2, changePointsNum: 5 }).type, 'refund',
  )
  // changeType 3 赠送 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 3, changePointsNum: 50 }).amount, 50,
  )
  // changeType 4 过期 → 负
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 4, changePointsNum: 3 }).amount, -3,
  )
  // changeType 5 充值 → 正
  assert.equal(
    mapTobyPointsChangeRecord({ ...base, changeType: 5, changePointsNum: 100 }).amount, 100,
  )
})
