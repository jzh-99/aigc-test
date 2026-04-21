'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Coins, ArrowRight } from 'lucide-react'
import { TopupModal } from '@/components/credits/topup-modal'
import { LedgerCard } from '@/components/credits/ledger-card'
import type { LedgerRow } from '@/components/credits/ledger-card'
import type { CreditBalance } from '@aigc/types'
import Link from 'next/link'

interface LedgerResponse { data: LedgerRow[]; total: number }

export default function CreditsPage() {
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const isOwner = activeTeam?.role === 'owner'
  const isOwnerOrAdmin = isOwner || activeTeam?.role === 'admin' || user?.role === 'admin'
  const allowMemberTopup = activeTeam?.allow_member_topup ?? false
  const canTopup = allowMemberTopup || (!isOwnerOrAdmin)

  const [page, setPage] = useState(1)
  const [topupOpen, setTopupOpen] = useState(false)

  const { data: balanceData } = useSWR<CreditBalance>(
    activeTeamId ? `/payment/balance?team_id=${activeTeamId}` : '/payment/balance'
  )

  const { data: ledgerData, isLoading: ledgerLoading } = useSWR<LedgerResponse>(
    `/payment/ledger?account=personal&page=${page}&limit=20`
  )

  const totalPages = Math.ceil((ledgerData?.total ?? 0) / 20)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">积分管理</h1>
        <p className="text-muted-foreground">查看个人余额、充值和消费记录</p>
      </div>

      {/* Team credits nav for owner */}
      {isOwner && activeTeamId && (
        <Link href="/team?tab=credits">
          <Card className="border-accent-orange/30 hover:border-accent-orange/60 transition-colors cursor-pointer">
            <CardContent className="flex items-center justify-between py-4 px-5">
              <div className="flex items-center gap-3">
                <Coins className="h-5 w-5 text-accent-orange" />
                <div>
                  <p className="text-sm font-medium">团队积分管理</p>
                  <p className="text-xs text-muted-foreground">充值、查看团队流水和成员权限</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Personal balance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">个人积分</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-blue-400" />
            <span className="text-2xl font-bold">{(balanceData?.personal_balance ?? 0).toLocaleString()}</span>
          </div>
          {(canTopup || isOwnerOrAdmin) && (
            <Button size="sm" onClick={() => setTopupOpen(true)}>充值个人积分</Button>
          )}
        </CardContent>
      </Card>

      <LedgerCard
        isOwnerOrAdmin={false}
        activeTeamId={null}
        ledgerAccount="personal"
        setLedgerAccount={() => {}}
        ledgerData={ledgerData}
        ledgerLoading={ledgerLoading}
        page={page}
        totalPages={totalPages}
        setPage={setPage}
      />

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
      />
    </div>
  )
}
