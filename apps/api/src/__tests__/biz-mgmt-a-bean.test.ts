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

test('ledger record tolerates unknown changeType with positive sign and original typeName', () => {
  const row = mapTobyPointsChangeRecord({
    changeNo: 'c2', changeType: 99, changeTypeName: '新活动',
    changePointsNum: '7', balancePointsNum: '88',
  })
  assert.equal(row.type, 'unknown')
  assert.equal(row.amount, 7) // 保守取正
  assert.equal(row.typeName, '新活动') // 业管原文兜底
})

test('ledger record uses Chinese fallback when changeTypeName missing', () => {
  const row = mapTobyPointsChangeRecord({ changeNo: 'c3', changeType: 1, changePointsNum: 2 })
  assert.equal(row.typeName, '扣减')
})

test('ledger record treats missing changePointsNum as amount 0', () => {
  const row = mapTobyPointsChangeRecord({ changeNo: 'c4', changeType: 1, changePointsNum: null })
  assert.equal(row.amount, 0)
  assert.equal(row.balanceAfter, null) // balancePointsNum 也缺失
})

test('ledger record normalizes empty/nullable string fields to null', () => {
  const row = mapTobyPointsChangeRecord({
    changeNo: 'c5', changeType: 5, changePointsNum: 10,
    bizNo: '', changeReason: '   ', operateUser: undefined, remark: '备注',
  })
  assert.equal(row.bizNo, null)
  assert.equal(row.reason, null)
  assert.equal(row.operator, null)
  assert.equal(row.remark, '备注')
})

test('ledger record passes through createTime as-is (no timezone, no ISO conversion)', () => {
  const ok = mapTobyPointsChangeRecord({ changeNo: 'c6', changeType: 1, changePointsNum: 1, createTime: '2026-06-21 10:00:00' })
  assert.equal(ok.createdAt, '2026-06-21 10:00:00') // 业管本地时间原样透传，不转 ISO（避免时区偏移）
  const bad = mapTobyPointsChangeRecord({ changeNo: 'c7', changeType: 1, changePointsNum: 1, createTime: 'not-a-date' })
  assert.equal(bad.createdAt, 'not-a-date') // 非法值也原样透传，前端 new Date() 解析失败时自行兜底
  const missing = mapTobyPointsChangeRecord({ changeNo: 'c8', changeType: 1, changePointsNum: 1 })
  assert.equal(missing.createdAt, '') // 缺失为空串
})
