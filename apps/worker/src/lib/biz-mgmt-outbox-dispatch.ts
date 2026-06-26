import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { notifyBizMgmtCreationResult, syncBizMgmtMemberSubCard, syncBizMgmtSubscribe } from './biz-mgmt-toby-client.js'

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
  if (!event || event.status === 'succeeded' || event.status === 'failed') return

  // 领取：attempt_count+1，置 processing 并加锁，记录领取时间与 worker 标识
  await db.updateTable('biz_mgmt_outbox_events')
    .set({
      status: 'processing',
      locked_at: new Date(),
      locked_by: 'biz-mgmt-notify',
      attempt_count: sql`attempt_count + 1`,
      updated_at: new Date(),
    })
    .where('id', '=', eventId)
    .execute()

  const maxAttempts = Number(event.max_attempts ?? 8)
  try {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
    // 按 event_type 分派到对应业管接口
    const response = event.event_type === 'creation_result_notify'
      ? await notifyBizMgmtCreationResult(payload)
      : event.event_type === 'subscribe_sync'
        ? await syncBizMgmtSubscribe(payload)
        : await syncBizMgmtMemberSubCard(payload)

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
  } catch (err) {
    // 失败：记录错误，按指数退避设下次重试时间；达上限置 failed 不再重试
    const nextAttemptCount = Number(event.attempt_count ?? 0) + 1
    const exhausted = nextAttemptCount >= maxAttempts
    await db.updateTable('biz_mgmt_outbox_events')
      .set({
        status: exhausted ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
        next_attempt_at: computeBizMgmtOutboxNextAttempt(nextAttemptCount),
        updated_at: new Date(),
      })
      .where('id', '=', eventId)
      .execute()
    // 未耗尽重试次数时抛错，触发 BullMQ 重试（与 outbox 表退避双保险）
    if (!exhausted) throw err
  }
}
