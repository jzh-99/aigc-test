'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Coins } from 'lucide-react'
import { TopupModal } from '@/components/credits/topup-modal'
import { LedgerCard } from '@/components/credits/ledger-card'
import type { LedgerRow } from '@/components/credits/ledger-card'
import type { CreditBalance } from '@aigc/types'

interface LedgerResponse { data: LedgerRow[]; total: number }

export default function CreditsPage() {
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const isOwnerOrAdmin = activeTeam?.role === 'owner' || activeTeam?.role === 'admin' || user?.role === 'admin'
  const allowMemberTopup = activeTeam?.allow_member_topup ?? false
  const canTopup = isOwnerOrAdmin || allowMemberTopup

  const [ledgerAccount, setLedgerAccount] = useState<'personal' | 'team'>('personal')
  const [page, setPage] = useState(1)
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupTarget, setTopupTarget] = useState<'team' | 'personal'>('personal')

  const { data: balanceData } = useSWR<CreditBalance>(
    activeTeamId ? `/payment/balance?team_id=${activeTeamId}` : '/payment/balance'
  )

  const ledgerUrl = ledgerAccount === 'team' && activeTeamId
    ? `/payment/ledger?account=team&team_id=${activeTeamId}&page=${page}&limit=20`
    : `/payment/ledger?account=personal&page=${page}&limit=20`
  const { data: ledgerData, isLoading: ledgerLoading } = useSWR<LedgerResponse>(ledgerUrl)

  const totalPages = Math.ceil((ledgerData?.total ?? 0) / 20)

  function openTopup(target: 'team' | 'personal') {
    setTopupTarget(target)
    setTopupOpen(true)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">积分管理</h1>
        <p className="text-muted-foreground">查看余额、充值和消费记录</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">团队积分</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-accent-orange" />
              <span className="text-2xl font-bold">{(balanceData?.team_balance ?? 0).toLocaleString()}</span>
            </div>
            {isOwnerOrAdmin && (
              <Button size="sm" variant="outline" onClick={() => openTopup('team')}>充值</Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">个人积分</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-blue-400" />
              <span className="text-2xl font-bold">{(balanceData?.personal_balance ?? 0).toLocaleString()}</span>
            </div>
            {canTopup && (
              <Button size="sm" variant="outline" onClick={() => openTopup('personal')}>充值</Button>
            )}
          </CardContent>
        </Card>
      </div>

      <LedgerCard
        isOwnerOrAdmin={isOwnerOrAdmin}
        activeTeamId={activeTeamId}
        ledgerAccount={ledgerAccount}
        setLedgerAccount={(acc) => { setLedgerAccount(acc); setPage(1) }}
        ledgerData={ledgerData}
        ledgerLoading={ledgerLoading}
        page={page}
        totalPages={totalPages}
        setPage={setPage}
      />

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        teamId={topupTarget === 'team' ? activeTeamId ?? undefined : undefined}
      />
    </div>
  )
}
