'use client'

import type { BizMgmtMemberAccount } from '@aigc/types'
import { cn } from '@/lib/utils'

interface Props {
  member: BizMgmtMemberAccount
  disabled?: boolean
  onSelect: (member: BizMgmtMemberAccount) => void
}

/**
 * 业管会员身份选择卡片。
 *
 * 展示公司/个人名称、会员类型、当前权益商品名称；不含 A 豆余额——
 * 余额是业管权威数据，必须实时调用余额接口，不能在账号选择页展示缓存值。
 */
export function BizMgmtMemberOptionCard({ member, disabled, onSelect }: Props) {
  const typeLabel = (member.userType ?? member.user_type) === '1' ? '个人会员' : '公司会员'
  const compName = member.compName ?? member.comp_name
  const userName = member.userName ?? member.user_name
  const goodsName = member.goodsName ?? member.goods_name

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(member)}
      className={cn(
        'w-full rounded-lg border border-border bg-card p-4 text-left transition-colors',
        'hover:border-primary disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <div>
        <p className="text-base font-semibold text-foreground">{compName || userName}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {typeLabel} / {goodsName ?? '暂无权益名称'}
        </p>
      </div>
    </button>
  )
}
