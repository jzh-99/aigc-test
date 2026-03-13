'use client'

import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import useSWR from 'swr'

interface CreditsBadgeProps {
  collapsed: boolean
}

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

export function CreditsBadge({ collapsed }: CreditsBadgeProps) {
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const { data } = useSWR<TeamInfo>(activeTeamId ? `/teams/${activeTeamId}` : null)

  const teamRole = activeTeam()?.role
  const isOwnerOrAdmin = teamRole === 'owner' || user?.role === 'admin'

  let displayValue: number
  let label: string

  if (isOwnerOrAdmin) {
    // Owner/admin sees team balance
    displayValue = data?.credits?.balance ?? 0
    label = '积分余额'
  } else {
    // Editor sees personal remaining quota: credit_quota - credit_used, min 0
    const me = data?.members?.find((m) => m.user_id === user?.id)
    if (me && me.credit_quota !== null && me.credit_quota !== undefined) {
      displayValue = Math.max(0, me.credit_quota - (me.credit_used ?? 0))
    } else {
      // No quota set — show team balance as fallback
      displayValue = data?.credits?.balance ?? 0
    }
    label = '可用积分'
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <Coins className="h-4 w-4 text-accent-orange" />
        <span>{displayValue}</span>
      </div>
    )
  }

  // Editor with quota: show breakdown
  const me = !isOwnerOrAdmin ? data?.members?.find((m) => m.user_id === user?.id) : null
  const hasQuota = me && me.credit_quota !== null && me.credit_quota !== undefined

  return (
    <div className={cn('flex items-center gap-2 rounded-md bg-muted px-3 py-2')}>
      <Coins className="h-4 w-4 text-accent-orange shrink-0" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{displayValue.toLocaleString()}</span>
        {hasQuota && (
          <span className="text-[10px] text-muted-foreground">
            配额 {me.credit_quota!.toLocaleString()} · 已用 {(me.credit_used ?? 0).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}
