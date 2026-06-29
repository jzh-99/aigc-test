import useSWR, { mutate } from 'swr'

const KEY = '/credits/biz-mgmt/balance'

interface BizMgmtBalance {
  balance: number
}

/**
 * 业管 A 豆余额展示 SWR。
 * - 数据源：GET /credits/biz-mgmt/balance（后端实时从业管 MEMBER-1004 现查，不落本地）。
 * - refreshInterval=3 分钟：常驻页面时自动刷新，捕获在别的端 / 业管后台充值或消费后的变化。
 *   SWR 同 key 去重，6 个展示点共用一份轮询，不会叠加请求。
 * - revalidateOnFocus：切回浏览器标签页时刷新一次。
 * - balance 来自业管权威，前端只做展示；扣减判据在后端创作前置校验（deductBizMgmtPointsForGeneration）。
 */
export function useBizMgmtBalance() {
  return useSWR<BizMgmtBalance>(KEY, {
    refreshInterval: 3 * 60 * 1000,
    revalidateOnFocus: true,
  })
}

/**
 * 命令式刷新余额（预留扩展点，便于后续手动刷新按钮等场景调用）。
 * 本期 A 豆按钮保持跳 /credits，不直接使用。
 */
export function mutateBizMgmtBalance() {
  return mutate(KEY)
}
