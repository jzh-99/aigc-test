'use client'

import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface CreditsBadgeProps {
  collapsed: boolean
}

export function CreditsBadge({ collapsed }: CreditsBadgeProps) {
  const router = useRouter()

  // 余额统一指向业管 A 豆余额接口（不区分团队/个人，业管以当前选中会员身份查询）
  const { data: balanceData } = useBizMgmtBalance()

  // 用 mounted gate 保证 SSR 与首屏 CSR 输出一致：
  // SWR 命中缓存时首屏 CSR 的 data 可能与 SSR（undefined）不同，会触发 hydration mismatch。
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const balance = balanceData?.balance ?? 0

  if (collapsed) {
    return (
      <button
        onClick={() => router.push('/credits')}
        className="flex flex-col items-center gap-1 text-xs text-muted-foreground w-full hover:text-foreground transition-colors"
      >
        <Coins className="h-4 w-4 text-accent-orange" />
        <span>{balance}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => router.push('/credits')}
        className={cn('flex items-center gap-2 rounded-md bg-muted px-3 py-2 w-full text-left hover:bg-muted/80 transition-colors')}
      >
        <Coins className="h-4 w-4 text-accent-orange shrink-0" />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs text-muted-foreground">A豆</span>
          <span className="text-sm font-medium">{hasMounted ? balance.toLocaleString() : 0}</span>
        </div>
      </button>
    </div>
  )
}
