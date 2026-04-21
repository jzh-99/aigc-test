'use client'

import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import type { CreditBalance } from '@aigc/types'

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
  credits: { balance: number; frozen_credits: number }
  members: TeamMember[]
}

export function CreditsBadge({ collapsed }: CreditsBadgeProps) {
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const router = useRouter()

  const { data: teamData } = useSWR<TeamInfo>(activeTeamId ? `/teams/${activeTeamId}` : null)
  const { data: balanceData } = useSWR<CreditBalance>(
    activeTeamId ? `/payment/balance?team_id=${activeTeamId}` : '/payment/balance'
  )

  const teamRole = activeTeam()?.role
  const isOwnerOrAdmin = teamRole === 'owner' || teamRole === 'admin' || user?.role === 'admin'

  const teamBalance = balanceData?.team_balance ?? 0
  const personalBalance = balanceData?.personal_balance ?? 0

  let displayValue: number
  if (isOwnerOrAdmin) {
    const frozen = teamData?.credits?.frozen_credits ?? 0
    displayValue = Math.max(0, teamBalance - frozen)
  } else {
    const me = teamData?.members?.find((m) => m.user_id === user?.id)
    if (me && me.credit_quota !== null && me.credit_quota !== undefined) {
      displayValue = Math.max(0, me.credit_quota - (me.credit_used ?? 0))
    } else {
      const frozen = teamData?.credits?.frozen_credits ?? 0
      displayValue = Math.max(0, teamBalance - frozen)
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => router.push('/credits')}
        className="flex flex-col items-center gap-1 text-xs text-muted-foreground w-full hover:text-foreground transition-colors"
      >
        <Coins className="h-4 w-4 text-accent-orange" />
        <span>{displayValue}</span>
      </button>
    )
  }

  const me = !isOwnerOrAdmin ? teamData?.members?.find((m) => m.user_id === user?.id) : null
  const hasQuota = me && me.credit_quota !== null && me.credit_quota !== undefined
  const allowMemberTopup = activeTeam()?.allow_member_topup ?? false

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => router.push('/credits')}
        className={cn('flex items-center gap-2 rounded-md bg-muted px-3 py-2 w-full text-left hover:bg-muted/80 transition-colors')}
      >
        <Coins className="h-4 w-4 text-accent-orange shrink-0" />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs text-muted-foreground">团队积分</span>
          <span className="text-sm font-medium">{displayValue.toLocaleString()}</span>
          {hasQuota && (
            <span className="text-[10px] text-muted-foreground">
              配额 {me.credit_quota!.toLocaleString()} · 已用 {(me.credit_used ?? 0).toLocaleString()}
            </span>
          )}
        </div>
      </button>

      {(allowMemberTopup || personalBalance > 0) && (
        <button
          onClick={() => router.push('/credits')}
          className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 w-full text-left hover:bg-muted/80 transition-colors"
        >
          <Coins className="h-4 w-4 text-blue-400 shrink-0" />
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">个人积分</span>
            <span className="text-sm font-medium">{personalBalance.toLocaleString()}</span>
          </div>
        </button>
      )}
    </div>
  )
}
