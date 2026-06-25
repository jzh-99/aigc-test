import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyBizMgmtCreationResult,
  syncBizMgmtMemberSubCard,
} from '../lib/biz-mgmt-toby-client.js'

test('worker biz-mgmt toby client exports notify and sync functions', () => {
  assert.equal(typeof notifyBizMgmtCreationResult, 'function')
  assert.equal(typeof syncBizMgmtMemberSubCard, 'function')
})
