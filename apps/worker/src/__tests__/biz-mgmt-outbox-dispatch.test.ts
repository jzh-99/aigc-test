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

test('dispatch routes creation_result_notify and subscribe_sync to corresponding toby APIs', async () => {
  // outbox dispatch 按 event_type 路由到对应业管接口。
  // 2026-06-30 起 member_sub_card_sync 已改为 API 同步调用（post-create-member.ts），
  // 不再经 outbox 派发；dispatch 只处理 creation_result_notify 与 subscribe_sync 两类，
  // 收到其它类型必须显式抛错（不能兜底误调 subscribe_sync）。
  const source = await readFile(join(__dirname, '../lib/biz-mgmt-outbox-dispatch.ts'), 'utf8')
  assert.match(source, /import.*syncBizMgmtSubscribe.*from '\.\/biz-mgmt-toby-client\.js'/)
  // 两类事件分别路由到对应业管接口
  assert.match(source, /event\.event_type === 'creation_result_notify'/)
  assert.match(source, /event\.event_type === 'subscribe_sync'/)
  assert.match(source, /await syncBizMgmtSubscribe\(payload\)/)
  // 不允许再保留 member_sub_card_sync 的派发分支（已下线）
  assert.doesNotMatch(source, /syncBizMgmtMemberSubCard/, 'dispatch 不应再保留 member_sub_card_sync 派发分支')
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
