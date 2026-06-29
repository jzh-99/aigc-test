'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Coins } from 'lucide-react'
import { TopupModal } from '@/components/credits/topup-modal'
import { SettingsManagementNav } from '@/components/layout/settings-management-nav'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
import { useBizMgmtLedger } from '@/hooks/use-biz-mgmt-ledger'
import { BizMgmtLedgerCard } from '@/components/credits/biz-mgmt-ledger-card'
import Link from 'next/link'

/**
 * A 豆管理页。
 *
 * 硬切换后本地积分系统已退役，余额与流水均来自业管平台：
 * - 余额：GET /credits/biz-mgmt/balance → { balance }（业管 MEMBER-1004 现查）
 * - 流水：GET /credits/biz-mgmt/ledger（业管 AIHUB_POINTS_CHANGE_QUERY 现查，经服务层映射成统一契约）
 * 不再区分团队/个人账户，业管以当前选中会员身份查询。
 */
const PAGE_SIZE = 20

export default function CreditsPage() {
  const [topupOpen, setTopupOpen] = useState(false)
  const [changeType, setChangeType] = useState('')
  const [page, setPage] = useState(1)

  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useBizMgmtBalance()

  // 流水：key 随 changeType/page 变化自动重查
  const { data: ledgerData, isLoading: ledgerLoading, error: ledgerError } =
    useBizMgmtLedger({ changeType, pageNum: page, pageSize: PAGE_SIZE })

  const balance = balanceData?.balance ?? 0
  const totalPages = ledgerData
    ? Math.max(1, Math.ceil(ledgerData.total / (ledgerData.pageSize || PAGE_SIZE)))
    : 1

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

      {/* 业管 A 豆流水（统一契约，带类型筛选 + 分页） */}
      <BizMgmtLedgerCard
        data={ledgerData}
        loading={ledgerLoading}
        // 接口 400（未选身份）时 error 非 null，hasIdentity 为 false 显示"请先选择业管会员身份"
        hasIdentity={!ledgerError}
        changeType={changeType}
        setChangeType={(t) => {
          setChangeType(t)
          setPage(1) // 切换类型时重置回第一页
        }}
        pageNum={page}
        totalPages={totalPages}
        setPage={setPage}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>A 豆余额与消费流水由业务管理平台统一管理。</p>
          <p>充值成功后，A 豆将由业管平台实时入账。</p>
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
