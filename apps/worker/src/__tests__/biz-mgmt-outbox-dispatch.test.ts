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
