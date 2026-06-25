import { getDb } from '@aigc/db'
import { sql } from 'kysely'

// 创作结果 remark 控制在业管接口要求的 500 字内
export function buildBizMgmtCreationResultRemark(input: {
  status: 'completed' | 'failed'
  module?: string | null
  message?: string | null
}): string {
  const prefix = input.status === 'completed' ? '创作成功' : '创作失败'
  return `${prefix}${input.module ? `：${input.module}` : ''}${input.message ? `，${input.message}` : ''}`.slice(0, 500)
}

export function buildCreationResultOutboxPayload(input: {
  localUserId: string
  bizMgmtUserId: string
  teamId: string
  workspaceId?: string | null
  batchId: string
  taskId: string
  taskStatus: 'completed' | 'failed'
  pointsNum: number
  requestNo: string
  workNo: string
  module?: string | null
  message?: string | null
}) {
  const remark = buildBizMgmtCreationResultRemark({
    status: input.taskStatus,
    module: input.module,
    message: input.message,
  })
  return {
    eventType: 'creation_result_notify' as const,
    dedupeKey: `creation-result:${input.requestNo}`,
    localUserId: input.localUserId,
    bizMgmtUserId: input.bizMgmtUserId,
    teamId: input.teamId,
    workspaceId: input.workspaceId ?? null,
    batchId: input.batchId,
    taskId: input.taskId,
    taskStatus: input.taskStatus,
    pointsNum: input.pointsNum,
    payload: {
      userId: input.bizMgmtUserId,
      requestNo: input.requestNo,
      workNo: input.workNo,
      success: input.taskStatus === 'completed',
      remark,
    },
  }
}

// 幂等写入 outbox：dedupe_key 冲突 doNothing，重复终态不重复入队
export async function enqueueCreationResultOutbox(
  input: ReturnType<typeof buildCreationResultOutboxPayload>,
): Promise<void> {
  const db = getDb()
  await db
    .insertInto('biz_mgmt_outbox_events')
    .values({
      event_type: input.eventType,
      dedupe_key: input.dedupeKey,
      local_user_id: input.localUserId,
      biz_mgmt_user_id: input.bizMgmtUserId,
      team_id: input.teamId,
      workspace_id: input.workspaceId,
      task_id: input.taskId,
      batch_id: input.batchId,
      task_status: input.taskStatus,
      points_num: String(input.pointsNum),
      payload: sql`${JSON.stringify(input.payload)}::jsonb`,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute()
}
