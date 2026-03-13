'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, ImageIcon, TrendingUp } from 'lucide-react'
import { useBatches } from '@/hooks/use-batches'
import { useAuthStore } from '@/stores/auth-store'
import useSWR from 'swr'

interface TeamMember {
  user_id: string
  credit_quota: number | null
  credit_used: number
  role: string
}

interface TeamInfo {
  credits: {
    balance: number
    frozen_credits: number
  }
  members: TeamMember[]
}

export function StatsCards() {
  const { batches, isLoadingInitial } = useBatches()
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const { data: teamData } = useSWR<TeamInfo>(activeTeamId ? `/teams/${activeTeamId}` : null)

  // Compute real stats from batch data
  const completedImages = batches.reduce((sum, b) => sum + b.completed_count, 0)
  const failedImages = batches.reduce((sum, b) => sum + b.failed_count, 0)
  const finishedImages = completedImages + failedImages
  const successRate = finishedImages > 0 ? Math.round((completedImages / finishedImages) * 100) : 0

  const teamRole = activeTeam()?.role
  const isOwnerOrAdmin = teamRole === 'owner' || user?.role === 'admin'

  let creditLabel: string
  let creditValue: number

  if (isOwnerOrAdmin) {
    creditLabel = '积分余额'
    creditValue = teamData?.credits?.balance ?? 0
  } else {
    // Editor: show personal remaining = credit_quota - credit_used, min 0
    const me = teamData?.members?.find((m) => m.user_id === user?.id)
    if (me && me.credit_quota !== null && me.credit_quota !== undefined) {
      creditValue = Math.max(0, me.credit_quota - (me.credit_used ?? 0))
    } else {
      creditValue = teamData?.credits?.balance ?? 0
    }
    creditLabel = '可用积分'
  }

  // Editor quota details for subtitle
  const me = !isOwnerOrAdmin ? teamData?.members?.find((m) => m.user_id === user?.id) : null
  const hasQuota = me && me.credit_quota !== null && me.credit_quota !== undefined
  const creditSubtitle = hasQuota
    ? `配额 ${me.credit_quota!.toLocaleString()} · 已用 ${(me.credit_used ?? 0).toLocaleString()}`
    : null

  const stats = [
    {
      label: creditLabel,
      value: isLoadingInitial ? null : creditValue.toLocaleString(),
      subtitle: creditSubtitle,
      icon: Coins,
      color: 'text-accent-orange',
      bg: 'bg-accent-orange/10',
    },
    {
      label: '生成次数',
      value: isLoadingInitial ? null : String(completedImages),
      subtitle: null,
      icon: ImageIcon,
      color: 'text-accent-blue',
      bg: 'bg-accent-blue/10',
    },
    {
      label: '成功率',
      value: isLoadingInitial ? null : (finishedImages > 0 ? `${successRate}%` : '-'),
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
