'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Coins } from 'lucide-react'
import { TopupModal } from '@/components/credits/topup-modal'
import { SettingsManagementNav } from '@/components/layout/settings-management-nav'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
import Link from 'next/link'

/**
 * A 豆管理页。
 *
 * 硬切换后本地积分系统已退役，余额与流水均来自业管平台：
 * - 余额：GET /credits/biz-mgmt/balance → { balance }（业管 MEMBER-1004 现查）
 * - 流水：GET /credits/biz-mgmt/ledger（业管 AIHUB_POINTS_CHANGE_QUERY 现查）
 * 不再区分团队/个人账户，业管以当前选中会员身份查询。
 */
export default function CreditsPage() {
  const [topupOpen, setTopupOpen] = useState(false)

  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useBizMgmtBalance()

  const balance = balanceData?.balance ?? 0

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">A豆管理</h1>
        <p className="text-muted-foreground">查看当前可用A豆余额（数据来自业务管理平台）</p>
      </div>

      <SettingsManagementNav showBack />

      {/* 当前可用 A 豆（业管权威余额） */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">可用A豆</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-accent-orange" />
            <span className="text-2xl font-bold">{balance.toLocaleString()}</span>
          </div>
          <Button size="sm" onClick={() => setTopupOpen(true)}>充值A豆</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>A 豆余额与消费记录由业务管理平台统一管理。</p>
          <p>充值成功后，A 豆将由业管平台实时入账；如需查看完整流水请前往业务管理平台。</p>
        </CardContent>
      </Card>

      <Link href="/team" className="block">
        <Card className="border-accent-orange/30 hover:border-accent-orange/60 transition-colors cursor-pointer">
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-accent-orange" />
              <div>
                <p className="text-sm font-medium">团队成员管理</p>
                <p className="text-xs text-muted-foreground">查看团队成员与权限</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
      />
    </div>
  )
}
