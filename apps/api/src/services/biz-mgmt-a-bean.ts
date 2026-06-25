import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import {
  deductTobyPoints,
  queryTobyMemberPoints,
  queryTobyPointsChangeList,
} from '../lib/toby-open-api.js'

/**
 * 业务管理平台 A 豆服务：余额查询、流水查询、生成前扣减。
 *
 * 权威约束（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 本服务只负责余额、流水和扣减；创作结果同步必须写入 biz_mgmt_outbox_events
 *   后交给 biz-mgmt-notify-queue 投递，不能在这里直接调用业管结果同步接口。
 * - 余额是业管权威数据：付费生成前必须先调单独余额接口实时校验，不读本地缓存。
 */

export interface CurrentBizMgmtIdentity {
  localUserId: string
  teamId: string
  workspaceId: string | null
  bizMgmtUserId: string
}

/**
 * 构造业管 A 豆扣减幂等请求号。
 * 规则：bizmgmt-{batchId}-{taskId 或 batch}。同一批次/任务重复扣减必须复用同一值。
 */
export function buildBizMgmtDeductRequestNo(input: {
  batchId: string
  taskId?: string | null
}): string {
  return `bizmgmt-${input.batchId}-${input.taskId ?? 'batch'}`
}

/**
 * 标准化业管余额响应为数值。
 * pointsNum 必须是合法非负数（字符串或数字），否则视为余额异常抛错。
 */
export function normalizeBizMgmtPointsBalance(payload: {
  pointsNum?: number | string | null
}): number {
  const value = Number(payload.pointsNum)
  if (!Number.isFinite(value) || value < 0) throw new Error('A 豆余额格式错误')
  return value
}

/**
 * 规范化业管流水查询参数：pageNum 从 1 起，pageSize 夹紧到 1~100。
 * changeType 仅在传入时携带，避免业管接口收到空字符串。
 */
export function normalizeBizMgmtPointsLedgerQuery(input: {
  bizMgmtUserId: string
  changeType?: string
  pageNum?: number
  pageSize?: number
}) {
  return {
    userId: input.bizMgmtUserId,
    ...(input.changeType ? { changeType: input.changeType } : {}),
    pageNum: Math.max(1, Math.trunc(input.pageNum ?? 1)),
    pageSize: Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 20))),
  }
}

/**
 * 读取当前选中的业管会员身份（is_selected=true 且 status=1）。
 * 未选择身份时抛错，调用方（生成/余额/流水）应先确保用户已选身份。
 */
export async function getCurrentBizMgmtIdentity(
  localUserId: string,
): Promise<CurrentBizMgmtIdentity> {
  const db = getDb()
  const binding = await db
    .selectFrom('biz_mgmt_member_bindings')
    .select(['local_user_id', 'team_id', 'workspace_id', 'biz_mgmt_user_id'])
    .where('local_user_id', '=', localUserId)
    .where('is_selected', '=', true)
    .where('status', '=', 1)
    .executeTakeFirst()

  if (!binding) throw new Error('请先选择可用的业管会员身份')
  return {
    localUserId: binding.local_user_id,
    teamId: binding.team_id,
    workspaceId: binding.workspace_id,
    bizMgmtUserId: binding.biz_mgmt_user_id,
  }
}

/**
 * 实时查询当前选中业管会员的 A 豆余额（MEMBER-1004）。
 * 不写入本地表——余额是业管权威数据，每次都现查。
 */
export async function queryCurrentBizMgmtBalance(localUserId: string): Promise<number> {
  const identity = await getCurrentBizMgmtIdentity(localUserId)
  const response = await queryTobyMemberPoints({ userId: identity.bizMgmtUserId })
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆余额查询失败')
  return normalizeBizMgmtPointsBalance(response.decryptedData as { pointsNum?: number | string | null })
}

/**
 * 查询当前选中业管会员的 A 豆流水（AIHUB_POINTS_CHANGE_QUERY）。
 * 直接返回业管响应数据，不读取本地 credits_ledger。
 */
export async function queryCurrentBizMgmtLedger(input: {
  localUserId: string
  changeType?: string
  pageNum?: number
  pageSize?: number
}) {
  const identity = await getCurrentBizMgmtIdentity(input.localUserId)
  const response = await queryTobyPointsChangeList(
    normalizeBizMgmtPointsLedgerQuery({
      bizMgmtUserId: identity.bizMgmtUserId,
      changeType: input.changeType,
      pageNum: input.pageNum,
      pageSize: input.pageSize,
    }),
  )
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆流水查询失败')
  return response.decryptedData ?? {}
}

/**
 * 付费生成前扣减业管 A 豆（AIHUB_POINTS_CHANGE）。
 *
 * 流程（严格顺序，见计划「生成前推荐顺序」）：
 * 1. 校验当前选中业管身份与生成团队一致
 * 2. 实时查余额（MEMBER-1004），余额不足则不扣减、不创建任务
 * 3. 写扣减审计记录（pending），幂等键 request_no 唯一
 * 4. 调用业管扣减接口
 * 5. 按业管返回更新审计 succeeded/failed；失败抛错，调用方须回滚任务
 *
 * 注意：本函数不负责创作结果同步——那由 worker 终态写入 outbox 后异步投递。
 */
export async function deductBizMgmtPointsForGeneration(input: {
  localUserId: string
  teamId: string
  workspaceId?: string | null
  batchId: string
  taskId?: string | null
  pointsNum: number
  source: number
  remark: string
}) {
  const identity = await getCurrentBizMgmtIdentity(input.localUserId)
  // 防止跨身份扣减：生成团队必须与当前选中业管身份的团队一致
  if (identity.teamId !== input.teamId) throw new Error('当前业管身份与生成团队不匹配')

  // 实时校验余额（权威数据，不读本地缓存）
  const balance = await queryCurrentBizMgmtBalance(input.localUserId)
  if (balance < input.pointsNum) throw new Error('A 豆余额不足')

  const requestNo = buildBizMgmtDeductRequestNo({ batchId: input.batchId, taskId: input.taskId })
  const workNo = input.taskId ?? input.batchId
  const db = getDb()

  // 先落审计（pending）：幂等键冲突时 doNothing，保证重复请求复用同一审计行
  await db
    .insertInto('biz_mgmt_a_bean_transactions')
    .values({
      local_user_id: input.localUserId,
      team_id: input.teamId,
      workspace_id: input.workspaceId ?? identity.workspaceId,
      biz_mgmt_user_id: identity.bizMgmtUserId,
      request_no: requestNo,
      work_no: workNo,
      source: input.source,
      points_num: String(input.pointsNum),
      remark: input.remark,
      task_id: input.taskId ?? null,
      batch_id: input.batchId,
    })
    .onConflict((oc) => oc.column('request_no').doNothing())
    .execute()

  const response = await deductTobyPoints({
    userId: identity.bizMgmtUserId,
    requestNo,
    source: input.source,
    workNo,
    pointsNum: input.pointsNum,
    remark: input.remark,
  })

  // 更新审计：成功记 succeeded，失败记 failed + last_error
  await db
    .updateTable('biz_mgmt_a_bean_transactions')
    .set({
      deduct_status: response.code === '0000' ? 'succeeded' : 'failed',
      deduct_response: sql`${JSON.stringify(response)}::jsonb`,
      last_error: response.code === '0000' ? null : response.message,
      updated_at: sql`now()`,
    })
    .where('request_no', '=', requestNo)
    .execute()

  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆扣减失败')
  return { requestNo, workNo, bizMgmtUserId: identity.bizMgmtUserId }
}
