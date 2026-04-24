'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import type { BatchResponse } from '@aigc/types'
import { useBatches } from '@/hooks/use-batches'
import { BatchListCard } from './batch-list-card'
import { HiddenBatchesDrawer } from './hidden-batches-drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

export interface BatchListHandle {
  prepend: (batch: BatchResponse) => void
  update: (batch: BatchResponse) => void
  refresh: () => void
  openHiddenDrawer: () => void
}

interface BatchListProps {
  onSelect: (batch: BatchResponse) => void
}

export const BatchList = forwardRef<BatchListHandle, BatchListProps>(function BatchList({ onSelect }, ref) {
  const { batches, isLoadingInitial, isLoadingMore, hasMore, loadMore, error, mutate, prependBatch, updateBatchInList, hideBatch } = useBatches()
  const [hiddenDrawerOpen, setHiddenDrawerOpen] = useState(false)

  useImperativeHandle(ref, () => ({
    prepend: prependBatch,
    update: updateBatchInList,
    refresh: () => mutate(),
    openHiddenDrawer: () => setHiddenDrawerOpen(true),
  }), [prependBatch, updateBatchInList, mutate])

  if (isLoadingInitial) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-destructive">加载失败</p>
        <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">暂无生成记录</p>
          <p className="text-xs text-muted-foreground mt-1">开始你的第一次创作吧</p>
        </div>
        <HiddenBatchesDrawer open={hiddenDrawerOpen} onOpenChange={setHiddenDrawerOpen} />
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {batches.map((batch) => (
          <BatchListCard
            key={batch.id}
            batch={batch}
            onClick={() => onSelect(batch)}
            onHide={hideBatch}
          />
        ))}

        {hasMore && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              加载更多
            </Button>
          </div>
        )}
      </div>

      <HiddenBatchesDrawer open={hiddenDrawerOpen} onOpenChange={setHiddenDrawerOpen} />
    </>
  )
})



