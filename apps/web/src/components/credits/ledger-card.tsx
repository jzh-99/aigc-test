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

const MODULE_LABELS: Record<string, string> = {
  image: '图片生成', video: '视频生成', tts: '语音合成',
  lipsync: '口型同步', agent: '智能体', avatar: '数字人', action_imitation: '动作模仿',
}

const TYPE_SIGN: Record<string, string> = {
  topup: '+', subscription: '+', bonus: '+', refund: '+',
  freeze: '', confirm: '-', expire: '-',
}

const DESCRIPTION_LABELS: Record<string, string> = {
  'image generation confirmed': '图片生成成功',
  'video generation confirmed': '视频生成成功',
  'tts generation confirmed': '语音合成成功',
  'lipsync generation confirmed': '口型同步成功',
  'agent generation confirmed': '任务成功',
  'avatar generation confirmed': '数字人生成成功',
  'action imitation generation confirmed': '动作模仿成功',
}

const TYPE_COLOR: Record<string, string> = {
  topup: 'text-green-600', subscription: 'text-green-600',
  bonus: 'text-green-600', refund: 'text-green-600',
  freeze: 'text-yellow-600', confirm: 'text-red-500', expire: 'text-muted-foreground',
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
            <div className="divide-y">
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

function mapLedgerDescription(description: string | null): string {
  if (!description) return ''
  const normalized = description.trim().toLowerCase()
  return DESCRIPTION_LABELS[normalized] ?? description
}

function LedgerRowItem({ row, showUser }: { row: LedgerRow; showUser: boolean }) {
  const hasTask = row.module || row.model
  const isCanvas = !!row.canvas_id
  const description = mapLedgerDescription(row.description)

  return (
    <div className="px-6 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
              {TYPE_LABELS[row.type] ?? row.type}
            </Badge>
            {hasTask && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                {isCanvas ? '画布·' : ''}{MODULE_LABELS[row.module ?? ''] ?? row.module}
              </Badge>
            )}
            {showUser && row.username && (
              <span className="text-xs text-muted-foreground shrink-0">by {row.username}</span>
            )}
          </div>

          {description && (
            <p className="text-sm text-foreground/80 truncate max-w-[520px]">{description}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            {row.model && <span className="font-mono">{row.model}</span>}
            <span>{new Date(row.created_at).toLocaleString('zh-CN')}</span>
          </div>
        </div>

        <span className={cn('text-sm font-medium tabular-nums shrink-0 mt-0.5', TYPE_COLOR[row.type])}>
          {TYPE_SIGN[row.type]}{Math.abs(row.amount).toLocaleString()}
        </span>
      </div>
    </div>
  )
}
