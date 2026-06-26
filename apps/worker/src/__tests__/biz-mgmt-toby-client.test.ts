import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyBizMgmtCreationResult,
  syncBizMgmtMemberSubCard,
  syncBizMgmtSubscribe,
} from '../lib/biz-mgmt-toby-client.js'

test('worker biz-mgmt toby client exports notify and sync functions', () => {
  assert.equal(typeof notifyBizMgmtCreationResult, 'function')
  assert.equal(typeof syncBizMgmtMemberSubCard, 'function')
  // Task 19: 订购同步函数用于充值/包月订单支付成功后通知业管加 A 豆
  assert.equal(typeof syncBizMgmtSubscribe, 'function')
})
