import { getDb } from '@aigc/db'
import { sql } from 'kysely'

/**
 * API 侧业管通知 outbox 入队服务。
 *
 * 用于「本地状态已变化、需通知业管」的事件：创作结果同步（同步生成失败时通知业管退款）、
 * 会员副卡同步。所有事件先写 biz_mgmt_outbox_events，再由 biz-mgmt-notify-queue 异步投递。
 * 成功与失败记录都保留，不删除。
 *
 * 注意：异步生成任务（image/video/music 等）的终态创作结果 outbox 由 worker 写入
 * （见 apps/worker/src/lib/biz-mgmt-result-outbox.ts）；本服务仅用于同步生成路由的失败回退、
 * 会员副卡等 API 侧触发的事件。
 */

export interface CreationResultOutboxInput {
  eventType: 'creation_result_notify'
  dedupeKey: string
  localUserId: string
  bizMgmtUserId: string
  teamId: string
  workspaceId?: string | null
  batchId: string
  taskId: string
  taskStatus: 'completed' | 'failed'
  pointsNum: number
  payload: {
    userId: string
    requestNo: string
    workNo: string
    success: boolean
    remark?: string
  }
}

export interface MemberSubCardOutboxInput {
  eventType: 'member_sub_card_sync'
  dedupeKey: string
  localUserId: string
  bizMgmtUserId: string
  phone: string
  teamId: string
  pointsNum: number
  payload: {
    phone: string
    userName: string
    compName: string
    channel: string
    belongId: string
    initialPointsNum: number
  }
}

export type BizMgmtOutboxInput = CreationResultOutboxInput | MemberSubCardOutboxInput

// 幂等写入 outbox：dedupe_key 冲突 doNothing，重复入队不重复创建事件
export async function enqueueBizMgmtOutboxEvent(input: BizMgmtOutboxInput): Promise<void> {
  const db = getDb()
  await db
    .insertInto('biz_mgmt_outbox_events')
    .values({
      event_type: input.eventType,
      dedupe_key: input.dedupeKey,
      local_user_id: input.localUserId,
      biz_mgmt_user_id: input.bizMgmtUserId,
      ...(input.eventType === 'member_sub_card_sync' ? { phone: input.phone } : {}),
      team_id: input.teamId,
      ...(input.eventType === 'creation_result_notify'
        ? {
            workspace_id: input.workspaceId ?? null,
            task_id: input.taskId,
            batch_id: input.batchId,
            task_status: input.taskStatus,
          }
        : {}),
      points_num: String(input.pointsNum),
      payload: sql`${JSON.stringify(input.payload)}::jsonb`,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute()
}
