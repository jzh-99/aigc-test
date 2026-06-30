import type { Redis } from 'ioredis'
import { queryTobyMemberPoints } from '../lib/toby-open-api.js'
import { normalizeBizMgmtPointsBalance } from './biz-mgmt-a-bean.js'

const BALANCE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const BALANCE_REFRESH_DEBOUNCE_SECONDS = 5

export interface BizMgmtBalanceCacheValue {
  balance: number
  updatedAt: string
}

function getBalanceCacheKey(bizMgmtUserId: string): string {
  return `biz_mgmt:points_balance:${bizMgmtUserId}`
}

export async function readBizMgmtBalanceCache(
  redis: Redis,
  bizMgmtUserId: string | null | undefined,
): Promise<BizMgmtBalanceCacheValue | null> {
  if (!bizMgmtUserId) return null
  const raw = await redis.get(getBalanceCacheKey(bizMgmtUserId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<BizMgmtBalanceCacheValue>
    const balance = Number(parsed.balance)
    if (!Number.isFinite(balance) || !parsed.updatedAt) return null
    return { balance, updatedAt: String(parsed.updatedAt) }
  } catch {
    return null
  }
}

export async function writeBizMgmtBalanceCache(
  redis: Redis,
  bizMgmtUserId: string,
  balance: number,
): Promise<BizMgmtBalanceCacheValue> {
  const value = {
    balance,
    updatedAt: new Date().toISOString(),
  }
  await redis.set(
    getBalanceCacheKey(bizMgmtUserId),
    JSON.stringify(value),
    'EX',
    BALANCE_CACHE_TTL_SECONDS,
  )
  return value
}

function isCacheFresh(cache: BizMgmtBalanceCacheValue, debounceSeconds: number): boolean {
  const updatedAt = new Date(cache.updatedAt).getTime()
  if (Number.isNaN(updatedAt)) return false
  return Date.now() - updatedAt < debounceSeconds * 1000
}

/**
 * 回源业管刷新 A 豆余额展示缓存。
 *
 * 该缓存只服务团队成员列表等展示场景，不参与生成前余额判断、扣减事务或任何财务权威逻辑。
 * 默认 5 秒防抖：短时间重复刷新直接返回 Redis 快照，避免连续点击打爆业管接口。
 */
export async function refreshBizMgmtBalanceCache(
  redis: Redis,
  bizMgmtUserId: string,
): Promise<BizMgmtBalanceCacheValue> {
  const cached = await readBizMgmtBalanceCache(redis, bizMgmtUserId)
  if (cached && isCacheFresh(cached, BALANCE_REFRESH_DEBOUNCE_SECONDS)) return cached

  const response = await queryTobyMemberPoints({ userId: bizMgmtUserId })
  if (response.code !== '0000') throw new Error(response.message || '业管 A 豆余额查询失败')
  const balance = normalizeBizMgmtPointsBalance(response.decryptedData as { pointsNum?: number | string | null })
  return writeBizMgmtBalanceCache(redis, bizMgmtUserId, balance)
}
