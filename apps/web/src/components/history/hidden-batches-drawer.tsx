'use client'

import { useState } from 'react'
import { useHiddenBatches } from '@/hooks/use-batches'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'

interface HiddenBatchesDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusLabels: Record<string, string> = {
  pending: '等待中',
  processing: '生成中',
  completed: '已完成',
  partial_complete: '部分完成',
  failed: '失败',
}

export function HiddenBatchesDrawer({ open, onOpenChange }: HiddenBatchesDrawerProps) {
  const { batches, isLoadingInitial, isLoadingMore, hasMore, loadMore, unhideBatch } = useHiddenBatches(open)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleUnhide(batch: BatchResponse) {
    setLoadingId(batch.id)
    try {
      await unhideBatch(batch.id)
      toast.success('已恢复显示')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>已隐藏的记录</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-1">
          {isLoadingInitial && (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          )}

          {!isLoadingInitial && batches.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">没有已隐藏的记录</p>
          )}

          {batches.map((batch) => (
            <div key={batch.id} className="border rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{batch.prompt || '(无提示词)'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {statusLabels[batch.status] ?? batch.status} · {new Date(batch.created_at).toLocaleDateString('zh-CN')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => handleUnhide(batch)}
                disabled={loadingId === batch.id}
              >
                {loadingId === batch.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Eye className="h-3.5 w-3.5" />
                }
                恢复
              </Button>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                加载更多
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
