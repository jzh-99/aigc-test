'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Coins } from 'lucide-react'
import { apiPatch, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { LedgerCard } from '@/components/credits/ledger-card'
import type { LedgerRow } from '@/components/credits/ledger-card'
import { TopupModal } from '@/components/credits/topup-modal'

interface TeamInfo {
  allow_member_topup: boolean
  credits?: { balance: number; frozen_credits: number }
}

const LIMIT = 20

export function TeamCreditsSettings({ teamId }: { teamId: string }) {
  const { data, mutate } = useSWR<TeamInfo>(`/teams/${teamId}`)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [topupOpen, setTopupOpen] = useState(false)

  const { data: ledgerData, isLoading: ledgerLoading } = useSWR<{ data: LedgerRow[]; total: number }>(
    `/payment/ledger?account=team&team_id=${teamId}&page=${page}&limit=${LIMIT}`
  )

  const totalPages = ledgerData ? Math.ceil(ledgerData.total / LIMIT) : 1
  const balance = data?.credits?.balance ?? 0
  const frozen = data?.credits?.frozen_credits ?? 0
  const available = Math.max(0, balance - frozen)

  async function handleToggle(val: boolean) {
    setLoading(true)
    try {
      await apiPatch(`/teams/${teamId}/allow-member-topup`, { allow: val })
      mutate((prev) => prev ? { ...prev, allow_member_topup: val } : prev, false)
      toast.success(val ? '已开放成员充值' : '已关闭成员充值')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Team balance + topup */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">团队积分余额</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-accent-orange" />
              <span className="text-2xl font-bold">{available.toLocaleString()}</span>
            </div>
            {frozen > 0 && (
              <p className="text-xs text-muted-foreground mt-1">冻结中: {frozen.toLocaleString()}</p>
            )}
          </div>
          <Button onClick={() => setTopupOpen(true)}>充值团队积分</Button>
        </CardContent>
      </Card>

      {/* Member topup permission */}
      <Card>
        <CardHeader>
          <CardTitle>成员充值权限</CardTitle>
          <CardDescription>控制团队成员是否可以自行充值个人积分</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="member-topup-switch">允许成员充值</Label>
              <p className="text-xs text-muted-foreground">
                开启后，editor 成员可充值个人积分账户（独立于团队积分池）
              </p>
            </div>
            <Switch
              id="member-topup-switch"
              checked={data?.allow_member_topup ?? false}
              onCheckedChange={handleToggle}
              disabled={loading || !data}
            />
          </div>
        </CardContent>
      </Card>

      {/* Team ledger */}
      <LedgerCard
        isOwnerOrAdmin={false}
        activeTeamId={teamId}
        ledgerAccount="team"
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
        teamId={teamId}
      />
    </div>
  )
}
