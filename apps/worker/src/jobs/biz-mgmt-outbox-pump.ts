import { getDb } from '@aigc/db'
import { Queue } from 'bullmq'
import pino_ from 'pino'
import { getRedis, getBullMQConnection } from '../lib/redis.js'
import { DEFAULT_JOB_OPTIONS } from '../lib/queue-options.js'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// biz-mgmt-notify-queue 的生产者：把 outbox 表里到期该投递的 pending 事件投成 BullMQ job。
// 复用单例 Queue，避免每次扫描都建连接。
let _bizMgmtNotifyQueue: Queue | null = null
function getBizMgmtNotifyQueue(): Queue {
  if (!_bizMgmtNotifyQueue) {
    _bizMgmtNotifyQueue = new Queue('biz-mgmt-notify-queue', {
      connection: getBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return _bizMgmtNotifyQueue
}

// 每次扫描最多投递的事件数，防止积压一次性灌爆业管接口
const PUMP_BATCH_SIZE = 50

// pump 分布式锁：防止多机部署时多个 worker 同时扫表投递重复 job。
// 单机单 worker（acquireSingletonLock）下天然不会并发，多机时此锁兜底。
const PUMP_LOCK_KEY = 'biz-mgmt-outbox:pump:lock'
const PUMP_LOCK_TTL_MS = 30_000 // 30 秒，远大于单次扫描耗时，到期自动释放防死锁

/**
 * 尝试获取 pump 分布式锁（Redis SET NX PX，原子操作）。
 * 返回 true 表示抢到锁，应执行扫描；false 表示已有别的实例在扫，跳过本次。
 */
async function acquirePumpLock(): Promise<boolean> {
  const redis = getRedis()
  const token = String(process.pid)
  const result = await redis.set(PUMP_LOCK_KEY, token, 'PX', PUMP_LOCK_TTL_MS, 'NX')
  return result === 'OK'
}

/**
 * 释放 pump 锁（仅当持有者是自己，避免误删别人的锁）。
 */
async function releasePumpLock(): Promise<void> {
  const redis = getRedis()
  const token = String(process.pid)
  // Lua 原子：只有值匹配才删，防止误释放（锁过期后被别人抢走的情况）
  const current = await redis.get(PUMP_LOCK_KEY)
  if (current === token) {
    await redis.del(PUMP_LOCK_KEY)
  }
}

/**
 * 扫描 biz_mgmt_outbox_events 里到期未派发的 pending 事件，投递到 biz-mgmt-notify-queue。
 *
 * 这是 outbox 模式的关键一环：enqueueBizMgmtOutboxEvent（api 侧）只往 outbox 表写一行 pending，
 * 不直接投 BullMQ。本函数由定时任务（biz-mgmt-outbox-pump）周期调用，把到期事件投成 job，
 * worker（biz-mgmt-notify.ts）消费 job → dispatchBizMgmtOutboxEvent → 调业管接口。
 *
 * 防重（两层）：
 * 1. pump 层：Redis 分布式锁（biz-mgmt-outbox:pump:lock）防止多机同时扫表投重复 job；
 *    BullMQ jobId=eventId 在投递层再兜一道去重。
 * 2. 消费层：dispatchBizMgmtOutboxEvent 领取时用 CAS（WHERE status='pending'）抢占，
 *    只有第一个消费者能把事件改成 processing，其余返回 0 行跳过。
 *
 * 扫描条件：status='pending' AND next_attempt_at <= now()。
 * 不扫 processing（已被某个 worker 领取处理中）。
 */
export async function runBizMgmtOutboxPump(): Promise<void> {
  // 多机部署防重：抢不到锁说明别的实例正在扫，跳过本次
  if (!(await acquirePumpLock())) {
    logger.debug('[biz-mgmt-outbox-pump] 未抢到 pump 锁，跳过本次扫描（别的实例正在处理）')
    return
  }

  try {
    const db = getDb()

    // 选出到期的 pending 事件（按创建时间排序，先入先投）
    const dueEvents = await db
      .selectFrom('biz_mgmt_outbox_events')
      .select(['id', 'event_type', 'attempt_count'])
      .where('status', '=', 'pending')
      .where('next_attempt_at', '<=', new Date())
      .orderBy('created_at', 'asc')
      .limit(PUMP_BATCH_SIZE)
      .execute()

    if (dueEvents.length === 0) return

    const queue = getBizMgmtNotifyQueue()
    // 批量投递，每个事件一个 job，jobId=eventId 去重
    await queue.addBulk(
      dueEvents.map((event) => ({
        name: 'biz-mgmt-notify',
        data: { eventId: event.id },
        opts: { jobId: event.id }, // 幂等：同 eventId 只有一个 job
      })),
    )

    logger.info(
      { count: dueEvents.length, types: [...new Set(dueEvents.map((e) => e.event_type))] },
      '[biz-mgmt-outbox-pump] 已投递到期 pending 事件到 biz-mgmt-notify-queue',
    )
  } finally {
    // 无论成功失败都释放锁，避免锁残留影响下次扫描
    await releasePumpLock()
  }
}
