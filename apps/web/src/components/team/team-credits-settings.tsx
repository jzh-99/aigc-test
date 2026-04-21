'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { apiPatch, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { LedgerCard } from '@/components/credits/ledger-card'

interface TeamInfo {
  allow_member_topup: boolean
}

const LIMIT = 20

export function TeamCreditsSettings({ teamId }: { teamId: string }) {
  const { data, mutate } = useSWR<TeamInfo>(`/teams/${teamId}`)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  const { data: ledgerData, isLoading: ledgerLoading } = useSWR<{ data: any[]; total: number }>(
    `/payment/ledger?account=team&team_id=${teamId}&page=${page}&limit=${LIMIT}`
  )

  const totalPages = ledgerData ? Math.ceil(ledgerData.total / LIMIT) : 1

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
      <Card>
        <CardHeader>
          <CardTitle>积分充值权限</CardTitle>
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
    </div>
  )
}
