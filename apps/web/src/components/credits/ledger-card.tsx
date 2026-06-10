'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronLeft, ChevronRight, Clock, UserRound, CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  topup: '充值', subscription: '订阅', freeze: '冻结',
  confirm: '消费', refund: '退回', bonus: '赠送', expire: '过期',
}

const MODULE_LABELS: Record<string, string> = {
  image: '图片生成', video: '视频生成', tts: '语音合成',
  lipsync: '口型同步', agent: '智能体', avatar: '数字人', action_imitation: '动作模仿',
  music: '音乐生成', music_voice_clone: '音乐音色克隆',
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

const TYPE_BADGE_CLASS: Record<string, string> = {
  topup: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  subscription: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  bonus: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  refund: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  confirm: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  expire: 'border-border bg-muted/50 text-muted-foreground',
}

export interface LedgerRow {
  id: string
  amount: number
  type: string
  description: string | null
  created_at: string
  task_id?: string | null
  batch_id?: string | null
  user_id?: string | null
  username?: string | null
  module?: string | null
  model?: string | null
  provider?: string | null
  prompt?: string | null
  canvas_id?: string | null
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
            <div className="divide-y divide-border/70">
              {ledgerData.data.map((row) => (
                <LedgerRowItem key={row.id} row={row} showUser={ledgerAccount === 'team'} />
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

function LedgerRowItem({ row, showUser }: { row: LedgerRow; showUser: boolean }) {
  const hasTask = row.module || row.model
  const isCanvas = !!row.canvas_id
  const description = row.description?.trim() ?? ''
  const moduleLabel = MODULE_LABELS[row.module ?? ''] ?? row.module
  const isFailureRefund = row.type === 'refund' && /失败/.test(description)
  const typeLabel = isFailureRefund ? '失败退回' : TYPE_LABELS[row.type] ?? row.type
  const displayDescription = isFailureRefund ? description.replace(/[：:].*$/, '') : description
  const amountText = isFailureRefund
    ? `退回 ${Math.abs(row.amount).toLocaleString()}`
    : `${TYPE_SIGN[row.type]}${Math.abs(row.amount).toLocaleString()}`
  const amountColor = isFailureRefund ? 'text-muted-foreground' : TYPE_COLOR[row.type]
  const refundTooltip = `任务先冻结 ${Math.abs(row.amount).toLocaleString()} A豆，失败后已退回可用额度`
  const createdAt = new Date(row.created_at).toLocaleString('zh-CN')

  return (
    <div className="px-6 py-4 transition-colors hover:bg-muted/30">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2.5">
            <Badge
              variant="outline"
              className={cn(
                'h-5 rounded-full px-2 text-[11px] font-medium shrink-0',
                TYPE_BADGE_CLASS[row.type],
              )}
            >
              {typeLabel}
            </Badge>
            {hasTask && (
              <Badge
                variant="secondary"
                className="h-5 rounded-full px-2 text-[11px] font-medium shrink-0 bg-accent-orange/10 text-accent-orange border border-accent-orange/15"
              >
                {isCanvas ? '画布 · ' : ''}{moduleLabel}
              </Badge>
            )}
            {showUser && row.username && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <UserRound className="h-3 w-3" />
                {row.username}
              </span>
            )}
          </div>

          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {displayDescription || typeLabel}
          </p>

          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            {row.model && (
              <span className="min-w-0 max-w-[260px] truncate rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px]">
                {row.model}
              </span>
            )}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Clock className="h-3 w-3" />
              {createdAt}
            </span>
          </div>
        </div>

        <div className="flex min-w-[72px] justify-end">
          {isFailureRefund ? (
            <div className={cn('flex items-center justify-end gap-1.5 text-base font-semibold tabular-nums tracking-tight', amountColor)}>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <CircleAlert className="h-4 w-4 cursor-help text-amber-500" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {refundTooltip}
                </TooltipContent>
              </Tooltip>
              <span>
                {amountText}
              </span>
            </div>
          ) : (
            <span className={cn('text-base font-semibold tabular-nums tracking-tight', amountColor)}>
              {amountText}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
