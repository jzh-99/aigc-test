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
import { TopupModal } from '@/components/credits/topup-modal'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'

/**
 * 团队 A 豆设置面板。
 *
 * 硬切换后本地积分系统已退役，余额来自业管平台（GET /credits/biz-mgmt/balance），
 * /teams/:id 不再返回 credits 字段。成员充值权限开关保留（控制前端入口可见性），
 * 但实际 A 豆账户与流水均在业管侧管理。
 */
interface TeamInfo {
  allow_member_topup: boolean
}

export function TeamCreditsSettings({ teamId }: { teamId: string }) {
  const { data, mutate } = useSWR<TeamInfo>(`/teams/${teamId}`)
  const { data: balanceData } = useBizMgmtBalance()
  const [loading, setLoading] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)

  const balance = balanceData?.balance ?? 0

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
      {/* Integrated credits panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>A豆设置</CardTitle>
          <CardDescription>团队 A 豆余额由业务管理平台统一管理</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">可用A豆</p>
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-accent-orange" />
                <span className="text-2xl font-bold">{balance.toLocaleString()}</span>
              </div>
            </div>
            <Button onClick={() => setTopupOpen(true)}>充值A豆</Button>
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="member-topup-switch">成员充值权限</Label>
              <p className="text-xs text-muted-foreground">
                开启后，成员可发起充值，A 豆由业管平台入账
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

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        teamId={teamId}
      />
    </div>
  )
}
