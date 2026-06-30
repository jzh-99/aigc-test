import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  notifyBizMgmtCreationResult,
  syncBizMgmtSubscribe,
} from '../lib/biz-mgmt-toby-client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('worker biz-mgmt toby client exports notify and sync functions', () => {
  // 2026-06-30 起 member_sub_card_sync 已改为 API 同步调用（apps/api/src/lib/toby-open-api.ts），
  // worker client 不再保留 syncBizMgmtMemberSubCard；本 client 仅服务 outbox 派发的两类事件。
  assert.equal(typeof notifyBizMgmtCreationResult, 'function')
  // Task 19: 订购同步函数用于充值/包月订单支付成功后通知业管加 A 豆
  assert.equal(typeof syncBizMgmtSubscribe, 'function')
})

test('worker toby client 环境变量名必须与 .env/api 一致：TOBY_OUTBOUND_* 前缀', async () => {
  // .env 和 apps/api 都用 TOBY_OUTBOUND_*（BASE_URL/APP_ID/APP_SECRET/PRIVATE_KEY）。
  // worker client 必须读同名变量，否则 worker 进程会抛 “TOBY_XXX is required”，
  // 所有业管通知（副卡/创作结果/订购同步）全部失败。禁止使用无 OUTBOUND 前缀的旧名。
  const source = await readFile(join(__dirname, '../lib/biz-mgmt-toby-client.ts'), 'utf8')
  // 必须读取这 4 个带 OUTBOUND 前缀的变量
  for (const name of [
    'TOBY_OUTBOUND_BASE_URL',
    'TOBY_OUTBOUND_APP_ID',
    'TOBY_OUTBOUND_APP_SECRET',
    'TOBY_OUTBOUND_PRIVATE_KEY',
  ]) {
    assert.match(source, new RegExp(`getRequiredEnv\\('${name.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'`), `必须读取 ${name}`)
  }
  // 禁止出现无 OUTBOUND 前缀的旧变量名（曾导致 worker 调业管必失败）
  assert.doesNotMatch(source, /getRequiredEnv\('TOBY_BASE_URL'\)/, '禁止用 TOBY_BASE_URL（应为 TOBY_OUTBOUND_BASE_URL）')
  assert.doesNotMatch(source, /getRequiredEnv\('TOBY_APP_ID'\)/, '禁止用 TOBY_APP_ID（应为 TOBY_OUTBOUND_APP_ID）')
  assert.doesNotMatch(source, /getRequiredEnv\('TOBY_APP_SECRET'\)/, '禁止用 TOBY_APP_SECRET（应为 TOBY_OUTBOUND_APP_SECRET）')
  assert.doesNotMatch(source, /getRequiredEnv\('TOBY_PRIVATE_KEY'\)/, '禁止用 TOBY_PRIVATE_KEY（应为 TOBY_OUTBOUND_PRIVATE_KEY）')
})
