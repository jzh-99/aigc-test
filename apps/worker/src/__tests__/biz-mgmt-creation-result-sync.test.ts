import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBizMgmtCreationResultRemark, buildCreationResultOutboxPayload } from '../lib/biz-mgmt-result-outbox.js'

test('creation result remark is bounded to 500 chars', () => {
  const remark = buildBizMgmtCreationResultRemark({ status: 'failed', module: 'image', message: 'x'.repeat(1000) })
  assert.equal(remark.length <= 500, true)
  assert.match(remark, /image/)
})

test('creation result outbox payload contains task and billing context', () => {
  const event = buildCreationResultOutboxPayload({
    localUserId: 'user-1', bizMgmtUserId: 'biz-user-1', teamId: 'team-1', workspaceId: 'workspace-1',
    batchId: 'batch-1', taskId: 'task-1', taskStatus: 'completed', pointsNum: 12,
    requestNo: 'bizmgmt-batch-1-task-1', workNo: 'task-1',
  })
  assert.equal(event.eventType, 'creation_result_notify')
  assert.equal(event.dedupeKey, 'creation-result:bizmgmt-batch-1-task-1')
  assert.equal(event.payload.success, true)
  assert.equal(event.pointsNum, 12)
})
