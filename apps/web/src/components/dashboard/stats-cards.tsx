'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, ImageIcon, TrendingUp } from 'lucide-react'
import { useBatchStats } from '@/hooks/use-batch-stats'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'

export function StatsCards() {
  const { total, totalCompleted, successRate, isLoading: isStatsLoading } = useBatchStats()
  // 余额统一指向业管 A 豆余额接口（不区分团队/个人）
  const { data: balanceData, isLoading: isBalanceLoading } = useBizMgmtBalance()

  const creditLabel = '可用A豆'
  const creditValue = balanceData?.balance ?? 0

  const stats = [
    {
      label: creditLabel,
      value: isBalanceLoading ? null : creditValue.toLocaleString(),
      subtitle: null,
      icon: Coins,
      color: 'text-accent-orange',
      bg: 'bg-accent-orange/10',
    },
    {
      label: '生成次数',
      value: isStatsLoading ? null : String(total),
      subtitle: null,
      icon: ImageIcon,
      color: 'text-accent-blue',
      bg: 'bg-accent-blue/10',
    },
    {
      label: '成功率',
      value: isStatsLoading ? null : (successRate !== null ? `${successRate}%` : '-'),
      subtitle: null,
      icon: TrendingUp,
      color: 'text-success',
      bg: 'bg-success/10',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex items-center gap-4 p-5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.bg}`}>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              {stat.value === null ? (
                <Skeleton className="h-8 w-16 mt-1" />
              ) : (
                <p className="text-2xl font-semibold">{stat.value}</p>
              )}
              {stat.subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{stat.subtitle}</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
