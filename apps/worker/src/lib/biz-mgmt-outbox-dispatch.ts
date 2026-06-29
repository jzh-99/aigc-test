import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { notifyBizMgmtCreationResult, syncBizMgmtMemberSubCard, syncBizMgmtSubscribe } from './biz-mgmt-toby-client.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

/**
 * 业管通知 outbox 派发。
 *
 * 关键不变量（见 docs/superpowers/plans/2026-06-25-biz-mgmt-deprecate-local-credits.md）：
 * - 所有通知业管的事件经 outbox + biz-mgmt-notify-queue 异步投递。
 * - 成功与失败记录都保留，不删除。
 * - 失败按指数退避重试，达到 max_attempts 后置 failed。
 */

// 指数退避：1m,5m,15m,60m,360m,720m,1440m,1440m
// attemptCount 是「本次尝试后」的累计次数（领取时已 +1）
export function computeBizMgmtOutboxNextAttempt(attemptCount: number): Date {
  const minutes = [1, 5, 15, 60, 360, 720, 1440, 1440][Math.min(attemptCount, 7)]
  return new Date(Date.now() + minutes * 60_000)
}

// 派发单个 outbox 事件：领取(processing)→调业管→成功(succeeded) / 失败(退避重试或 failed)
export async function dispatchBizMgmtOutboxEvent(eventId: string): Promise<void> {
  const db = getDb()
  const event = await db.selectFrom('biz_mgmt_outbox_events').selectAll().where('id', '=', eventId).executeTakeFirst()
  // 已终态（成功/失败）的事件不再派发，保证幂等
  if (!event || event.status === 'succeeded' || event.status === 'failed') {
    logger.info({ eventId, status: event?.status ?? 'not_found' }, '[outbox-dispatch] 事件已终态或不存在，跳过')
    return
  }

  // 领取（CAS 乐观锁抢占）：只有第一个消费者能把 pending 改成 processing，
  // 其余并发消费者（BullMQ 重投/多实例）返回 0 行直接跳过，确保事件只被消费一次。
  const claimed = await db.updateTable('biz_mgmt_outbox_events')
    .set({
      status: 'processing',
      locked_at: new Date(),
      locked_by: 'biz-mgmt-notify',
      attempt_count: sql`attempt_count + 1`,
      updated_at: new Date(),
    })
    .where('id', '=', eventId)
    .where('status', '=', 'pending') // CAS：仅 pending 可领取
    .executeTakeFirst()
  // 抢占失败（已被别的消费者领取或状态已变）→ 跳过，不重复调业管
  if (!claimed || Number(claimed.numUpdatedRows) === 0) {
    logger.info({ eventId, currentStatus: event.status }, '[outbox-dispatch] CAS 领取失败（已被其他消费者抢走），跳过')
    return
  }
  logger.info(
    { eventId, eventType: event.event_type, attempt: Number(event.attempt_count ?? 0) + 1 },
    '[outbox-dispatch] 已领取事件（CAS 成功），准备调业管接口',
  )

  const maxAttempts = Number(event.max_attempts ?? 8)
  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    // 按 event_type 分派到对应业管接口
    logger.info({ eventId, eventType: event.event_type }, '[outbox-dispatch] 开始调用业管接口')
    const response = event.event_type === 'creation_result_notify'
      ? await notifyBizMgmtCreationResult(payload)
      : event.event_type === 'subscribe_sync'
        ? await syncBizMgmtSubscribe(payload)
        : await syncBizMgmtMemberSubCard(payload)

    logger.info(
      { eventId, eventType: event.event_type, bizCode: response.code, bizMessage: response.message },
      '[outbox-dispatch] 业管接口返回',
    )

    if (response.code !== '0000') throw new Error(response.message || '业管通知失败')

    // 成功：记录响应、清空错误、置 succeeded，保留成功记录不删除
    await db.updateTable('biz_mgmt_outbox_events')
      .set({
        status: 'succeeded',
        last_response: sql`${JSON.stringify(response)}::jsonb`,
        last_error: null,
        sent_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', eventId)
      .execute()
    logger.info({ eventId, eventType: event.event_type }, '[outbox-dispatch] 事件派发成功（status=succeeded）')
  } catch (err) {
    // 失败：记录错误，按指数退避设下次重试时间；达上限置 failed 不再重试
    const errMsg = err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000)
    const nextAttemptCount = Number(event.attempt_count ?? 0) + 1
    const exhausted = nextAttemptCount >= maxAttempts
    await db.updateTable('biz_mgmt_outbox_events')
      .set({
        status: exhausted ? 'failed' : 'pending',
        last_error: errMsg,
        next_attempt_at: computeBizMgmtOutboxNextAttempt(nextAttemptCount),
        updated_at: new Date(),
      })
      .where('id', '=', eventId)
      .execute()
    logger.warn(
      { eventId, eventType: event.event_type, err: errMsg, nextAttemptCount, exhausted },
      '[outbox-dispatch] 事件派发失败（记录错误，退避重试或置 failed）',
    )
    // 未耗尽重试次数时抛错，触发 BullMQ 重试（与 outbox 表退避双保险）
    if (!exhausted) throw err
  }
}
