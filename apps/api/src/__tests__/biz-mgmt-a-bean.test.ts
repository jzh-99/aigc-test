import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBizMgmtDeductRequestNo,
  normalizeBizMgmtPointsBalance,
  normalizeBizMgmtPointsLedgerQuery,
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
