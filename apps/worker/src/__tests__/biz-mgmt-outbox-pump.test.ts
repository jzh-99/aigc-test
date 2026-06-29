import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('pump 用 Redis 分布式锁防多机重复扫描', async () => {
  // outbox 派发泵必须用 Redis 锁防止多机部署时多个 worker 同时扫表投递重复 job。
  // 锁 key 固定为 biz-mgmt-outbox:pump:lock，SET NX PX 原子抢锁，TTL 防死锁。
  const source = await readFile(join(__dirname, '../jobs/biz-mgmt-outbox-pump.ts'), 'utf8')
  assert.match(source, /biz-mgmt-outbox:pump:lock/, '锁 key 必须固定为 biz-mgmt-outbox:pump:lock')
  assert.match(source, /acquirePumpLock\(\)/, '必须有 acquirePumpLock 抢锁函数')
  assert.match(source, /releasePumpLock\(\)/, '必须有 releasePumpLock 释放锁（finally）')
  // runBizMgmtOutboxPump 开头必须先抢锁，抢不到直接 return
  assert.match(source, /if \(!\(await acquirePumpLock\(\)\)\)[\s\S]*?return/, '抢不到锁必须 return 跳过本次扫描')
  // 释放锁必须在 finally，保证异常时也释放
  assert.match(source, /finally[\s\S]*?await releasePumpLock\(\)/, 'releasePumpLock 必须在 finally 块')
})

test('pump 投递用 jobId=eventId 幂等去重，只扫 pending + next_attempt_at 到期', async () => {
  const source = await readFile(join(__dirname, '../jobs/biz-mgmt-outbox-pump.ts'), 'utf8')
  // 只扫 pending（不扫 processing，避免抢正在处理的事件）
  assert.match(source, /where\('status', '=', 'pending'\)/, '只扫 status=pending 的事件')
  // 必须用 next_attempt_at <= now 过滤到期（未到退避时间的重试事件不提前投）
  assert.match(source, /where\('next_attempt_at', '<=', /, '必须用 next_attempt_at <= now 过滤到期事件')
  // 投递 job 必须用 eventId 作 jobId 去重
  assert.match(source, /opts:\s*\{\s*jobId:\s*event\.id\s*\}/, '投递 job 必须用 jobId=event.id 去重')
})

test('pump 投递前必须清理 BullMQ 残留 failed job，避免 jobId 去重卡死重试', async () => {
  // BullMQ 用 jobId 去重：jobId（=eventId）一旦落在 failed 集合，后续 addBulk 会被静默忽略，
  // job 永远不进 waiting，worker 收不到，outbox 事件死循环卡在 pending。
  // outbox 模式的重试由 outbox 表 next_attempt_at 控制，BullMQ job 只负责一次性触发，
  // 因此每次重新投递前必须先删掉残留的 failed job，让 jobId 重新可用。
  const source = await readFile(join(__dirname, '../jobs/biz-mgmt-outbox-pump.ts'), 'utf8')
  assert.match(source, /queue\.getJob\(event\.id\)/, '投递前必须用 eventId 查残留 job')
  assert.match(source, /isFailed\(\)/, '必须判断残留 job 是否 failed')
  assert.match(source, /existingJob\.remove\(\)/, 'failed 残留 job 必须 remove 让 jobId 重新可用')
})
