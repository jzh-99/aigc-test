'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronLeft, ChevronRight, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BizMgmtLedgerRow } from '@/hooks/use-biz-mgmt-ledger'

/**
 * 业管 A 豆流水展示组件（基于后端映射后的中性契约 BizMgmtLedgerRow）。
 *
 * 与旧 ledger-card.tsx 的区别：字段对的是业管 AIHUB_POINTS_CHANGE_QUERY 映射结果，
 * 不含已退役本地 credits_ledger 的 module/model/provider/prompt/canvas_id 等字段，
 * 也没有 personal/team 账户切换（业管按当前选中会员身份查询，无此概念）。
 */

interface Props {
  data: { data: BizMgmtLedgerRow[]; total: number; pageNum: number; pageSize: number } | undefined
  loading: boolean
  hasIdentity: boolean
  changeType: string
  setChangeType: (t: string) => void
  pageNum: number
  totalPages: number
  setPage: (p: number) => void
}

// changeType 筛选 tab：值对应业管 changeType，'' 为全部
const TYPE_TABS: { label: string; value: string }[] = [
  { label: '全部', value: '' },
  { label: '扣减', value: '1' },
  { label: '返还', value: '2' },
  { label: '赠送', value: '3' },
  { label: '过期', value: '4' },
  { label: '充值', value: '5' },
]

// amount 颜色：正数绿、扣减红、过期中性、未知中性
const AMOUNT_COLOR: Record<BizMgmtLedgerRow['type'], string> = {
  deduct: 'text-red-500',
  expire: 'text-muted-foreground',
  refund: 'text-green-600',
  gift: 'text-green-600',
  recharge: 'text-green-600',
  unknown: 'text-foreground',
}

// Badge 配色：扣减偏红、过期中性、返还/赠送/充值偏绿、未知中性
const TYPE_BADGE_CLASS: Record<BizMgmtLedgerRow['type'], string> = {
  deduct: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  expire: 'border-border bg-muted/50 text-muted-foreground',
  refund: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  gift: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  recharge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  unknown: 'border-border bg-muted/50 text-muted-foreground',
}

export function BizMgmtLedgerCard({
  data, loading, hasIdentity, changeType, setChangeType, pageNum, totalPages, setPage,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">A豆流水</CardTitle>
          <div className="flex gap-1 text-sm">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setChangeType(tab.value)}
                className={cn(
                  'px-3 py-1 rounded-md transition-colors whitespace-nowrap',
                  changeType === tab.value
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!hasIdentity ? (
          <p className="text-center text-muted-foreground py-10 text-sm">请先选择业管会员身份</p>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.data.length ? (
          <p className="text-center text-muted-foreground py-10 text-sm">暂无记录</p>
        ) : (
          <>
            <div className="divide-y divide-border/70">
              {data.data.map((row) => (
                <LedgerRowItem key={row.id} row={row} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  第 {pageNum} / {totalPages} 页，共 {data.total} 条
                </span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={pageNum <= 1} onClick={() => setPage(pageNum - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={pageNum >= totalPages} onClick={() => setPage(pageNum + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LedgerRowItem({ row }: { row: BizMgmtLedgerRow }) {
  // amount 正数前缀加 +；后端已保证扣减/过期为负
  const amountText = `${row.amount > 0 ? '+' : ''}${row.amount.toLocaleString()}`
  // createdAt 是业管本地时间字符串（无时区），前端 new Date() 按本地时区解析渲染
  const createdAt = row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : ''
  // 时间解析失败时 toLocaleString 输出 "Invalid Date"，回退原值
  const displayTime = createdAt === 'Invalid Date' ? row.createdAt : createdAt

  return (
    <div className="px-6 py-4 transition-colors hover:bg-muted/30">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn('h-5 rounded-full px-2 text-[11px] font-medium shrink-0', TYPE_BADGE_CLASS[row.type])}
            >
              {row.typeName}
            </Badge>
            {row.operator && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <UserRound className="h-3 w-3" />
                {row.operator}
              </span>
            )}
          </div>

          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {row.reason || row.typeName}
          </p>

          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            {row.bizNo && (
              <span className="min-w-0 max-w-[260px] truncate rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px]">
                {row.bizNo}
              </span>
            )}
            {displayTime && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                {displayTime}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-[72px] justify-end">
          <span className={cn('text-base font-semibold tabular-nums tracking-tight', AMOUNT_COLOR[row.type])}>
            {amountText}
          </span>
        </div>
      </div>
    </div>
  )
}
