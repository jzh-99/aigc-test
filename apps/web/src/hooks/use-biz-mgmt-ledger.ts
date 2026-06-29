import useSWR from 'swr'

const BASE_KEY = '/credits/biz-mgmt/ledger'

export interface BizMgmtLedgerRow {
  id: string
  type: 'deduct' | 'refund' | 'gift' | 'expire' | 'recharge' | 'unknown'
  typeName: string
  amount: number
  balanceAfter: number | null
  bizNo: string | null
  reason: string | null
  source: number | null
  operator: string | null
  remark: string | null
  createdAt: string
}

export interface BizMgmtLedgerResponse {
  data: BizMgmtLedgerRow[]
  total: number
  pageNum: number
  pageSize: number
}

const DEFAULT_PAGE_SIZE = 20

/**
 * 业管 A 豆流水查询 SWR。
 * - 数据源：GET /credits/biz-mgmt/ledger（后端实时从业管 AIHUB_POINTS_CHANGE_QUERY 现查，
 *   经 mapTobyPointsChangeRecord 映射成中性契约，不读本地流水表）。
 * - changeType：1 扣减 / 2 返还 / 3 赠送 / 4 过期 / 5 充值；空串 = 全部。
 * - key 随 changeType/page 变化自动重查；SWR 全局默认 revalidateOnFocus=false，
 *   流水不需要像余额那样轮询刷新（消费后跳 /credits 即可看到最新）。
 */
export function useBizMgmtLedger(input: { changeType?: string; pageNum?: number; pageSize?: number } = {}) {
  const changeType = input.changeType ?? ''
  const pageNum = Math.max(1, input.pageNum ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE))

  // changeType 为空时不带该参数（业管返回全部流水）
  const query = changeType
    ? `${BASE_KEY}?changeType=${encodeURIComponent(changeType)}&pageNum=${pageNum}&pageSize=${pageSize}`
    : `${BASE_KEY}?pageNum=${pageNum}&pageSize=${pageSize}`

  return useSWR<BizMgmtLedgerResponse>(query)
}
