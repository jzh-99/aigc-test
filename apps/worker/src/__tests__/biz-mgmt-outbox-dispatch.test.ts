import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeBizMgmtOutboxNextAttempt } from '../lib/biz-mgmt-outbox-dispatch.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('next attempt follows exponential backoff in minutes', () => {
  const minutes = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000)
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(1)), 5) // 1→5m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(2)), 15) // 2→15m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(7)), 1440) // 上限 1 天
})

test('dispatch routes subscribe_sync to syncBizMgmtSubscribe', async () => {
  // Task 19: 充值/包月订单的订购同步经 outbox 派发，必须按 event_type 路由到对应业管接口
  const source = await readFile(join(__dirname, '../lib/biz-mgmt-outbox-dispatch.ts'), 'utf8')
  assert.match(source, /import.*syncBizMgmtSubscribe.*from '\.\/biz-mgmt-toby-client\.js'/)
  // 三类事件必须分别路由：creation_result_notify → notifyBizMgmtCreationResult，
  // subscribe_sync → syncBizMgmtSubscribe，否则（member_sub_card_sync）→ syncBizMgmtMemberSubCard
  assert.match(source, /event\.event_type === 'subscribe_sync'/)
  assert.match(source, /\?\s*await syncBizMgmtSubscribe\(payload\)/)
})

test('dispatch 领取用 CAS（WHERE status=pending）抢占，防 BullMQ 重投/多实例重复消费', async () => {
  // 关键防重：领取 UPDATE 必须带 WHERE status='pending'，只有第一个消费者能把事件改成
  // processing。其余并发消费者（BullMQ 重投/多 worker 实例）返回 0 行直接跳过，
  // 确保事件只被消费一次，避免重复调业管接口（重复扣减/重复建副卡）。
  const source = await readFile(join(__dirname, '../lib/biz-mgmt-outbox-dispatch.ts'), 'utf8')
  // 领取 UPDATE 必须在同一个 updateTable 内同时 set status=processing 与 where status=pending
  assert.match(
    source,
    /updateTable\('biz_mgmt_outbox_events'\)[\s\S]*?status: 'processing'[\s\S]*?where\('id', '=', eventId\)[\s\S]*?where\('status', '=', 'pending'\)/,
    '领取必须用 CAS：set status=processing + where status=pending 同事务',
  )
  // 抢占失败必须跳过（numUpdatedRows === 0 直接 return）
  assert.match(source, /numUpdatedRows[\s\S]*?=== 0[\s\S]*?return/, 'CAS 抢占失败必须 return 跳过')
})
