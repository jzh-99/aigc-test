'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  topup: '充值', subscription: '订阅', freeze: '冻结',
  confirm: '消费', refund: '退款', bonus: '赠送', expire: '过期',
}

const TYPE_SIGN: Record<string, string> = {
  topup: '+', subscription: '+', bonus: '+', refund: '+',
  freeze: '', confirm: '-', expire: '-',
}

const TYPE_COLOR: Record<string, string> = {
  topup: 'text-green-600', subscription: 'text-green-600',
  bonus: 'text-green-600', refund: 'text-green-600',
  freeze: 'text-yellow-600', confirm: 'text-red-500', expire: 'text-muted-foreground',
}

interface LedgerRow {
  id: string
  amount: number
  type: string
  description: string | null
  created_at: string
}

interface Props {
  isOwnerOrAdmin: boolean
  activeTeamId: string | null | undefined
  ledgerAccount: 'personal' | 'team'
  setLedgerAccount: (acc: 'personal' | 'team') => void
  ledgerData: { data: LedgerRow[]; total: number } | undefined
  ledgerLoading: boolean
  page: number
  totalPages: number
  setPage: (p: number) => void
}

export function LedgerCard({
  isOwnerOrAdmin, activeTeamId, ledgerAccount, setLedgerAccount,
  ledgerData, ledgerLoading, page, totalPages, setPage,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">消费流水</CardTitle>
          {isOwnerOrAdmin && activeTeamId && (
            <div className="flex gap-1 text-sm">
              {(['personal', 'team'] as const).map((acc) => (
                <button
                  key={acc}
                  onClick={() => setLedgerAccount(acc)}
                  className={cn('px-3 py-1 rounded-md transition-colors',
                    ledgerAccount === acc
                      ? 'bg-muted font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >{acc === 'personal' ? '个人' : '团队'}</button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ledgerLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !ledgerData?.data.length ? (
          <p className="text-center text-muted-foreground py-10 text-sm">暂无记录</p>
        ) : (
          <>
            <div className="divide-y">
              {ledgerData.data.map((row) => (
                <div key={row.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        {TYPE_LABELS[row.type] ?? row.type}
                      </Badge>
                      {row.description && (
                        <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {row.description}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <span className={cn('text-sm font-medium tabular-nums', TYPE_COLOR[row.type])}>
                    {TYPE_SIGN[row.type]}{Math.abs(row.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  第 {page} / {totalPages} 页，共 {ledgerData.total} 条
                </span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
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
