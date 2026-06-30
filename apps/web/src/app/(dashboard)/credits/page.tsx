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
import { useAuthStore } from '@/stores/auth-store'
import Link from 'next/link'

/**
 * A 豆管理页。
 *
 * 硬切换后本地积分系统已退役，余额与流水均来自业管平台：
 * - 余额：GET /credits/biz-mgmt/balance → { balance }（业管 MEMBER-1004 现查）
 * - 流水：GET /credits/biz-mgmt/ledger（业管 AIHUB_POINTS_CHANGE_QUERY 现查，经服务层映射成统一契约）
 * 不再区分团队/个人账户，业管以当前选中会员身份查询。
 */
const DEFAULT_PAGE_SIZE = 10

export default function CreditsPage() {
  // 【暂时取消】A 豆「充值」功能。通过此开关隐藏充值入口（按钮不渲染），保留 TopupModal 与 topupOpen
  // 状态以便后续恢复，恢复方式：把 ENABLE_TOPUP 改回 true。
  // 说明：后端充值相关接口保留不动，仅前端入口下线。
  const ENABLE_TOPUP = false

  const [topupOpen, setTopupOpen] = useState(false)
  const [changeType, setChangeType] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const activeBizMgmtMember = useAuthStore((s) => s.activeBizMgmtMember())

  // 权限拆分：查看 A 豆余额/流水是只读操作，所有业管会员身份（含普通成员/副卡）都能看；
  // 只有「管理 A 豆」（充值、团队成员管理入口）才需要公司主卡权限。
  const isOwner =
    activeBizMgmtMember?.userType === '2' &&
    (activeBizMgmtMember.isMaster ?? activeBizMgmtMember.is_master)

  // 余额统一指向业管 A 豆余额接口
  const { data: balanceData } = useBizMgmtBalance()

  // 流水：key 随 changeType/page 变化自动重查
  const { data: ledgerData, isLoading: ledgerLoading, error: ledgerError } =
    useBizMgmtLedger({ changeType, pageNum: page, pageSize })

  const balance = balanceData?.balance ?? 0
  const totalPages = ledgerData
    ? Math.max(1, Math.ceil(ledgerData.total / (ledgerData.pageSize || pageSize)))
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
          {ENABLE_TOPUP && isOwner && (
            <Button size="sm" onClick={() => setTopupOpen(true)}>充值A豆</Button>
          )}
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
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={(nextPageSize) => {
          setPageSize(nextPageSize)
          setPage(1)
        }}
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

      {isOwner && (
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
      )}

      <TopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
      />
    </div>
  )
}
