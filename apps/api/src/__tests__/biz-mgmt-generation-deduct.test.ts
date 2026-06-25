import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBizMgmtDeductRequestNo } from '../services/biz-mgmt-a-bean.js'

test('generation uses deterministic request number for business management deduction', () => {
  assert.equal(
    buildBizMgmtDeductRequestNo({ batchId: 'batch-123', taskId: 'task-456' }),
    'bizmgmt-batch-123-task-456',
  )
})
