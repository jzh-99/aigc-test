import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBizMgmtOutboxNextAttempt } from '../lib/biz-mgmt-outbox-dispatch.js'

test('next attempt follows exponential backoff in minutes', () => {
  const minutes = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000)
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(1)), 5) // 1→5m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(2)), 15) // 2→15m
  assert.equal(minutes(computeBizMgmtOutboxNextAttempt(7)), 1440) // 上限 1 天
})
