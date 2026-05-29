'use client'

import { useEffect } from 'react'
import { useBatches } from '@/hooks/use-batches'
import { useMultipleBatchSSE } from '@/hooks/use-multiple-batch-sse'
import { BatchListCard } from '@/components/history/batch-list-card'
import { Loader2 } from 'lucide-react'

const TERMINAL_STATUSES = ['completed', 'failed', 'partial_complete']

export function RecentBatches() {
  const { batches, isLoadingInitial, updateBatchInList } = useBatches('generation')
  
  const activeBatchIds = batches
    .filter(b => !TERMINAL_STATUSES.includes(b.status))
    .map(b => b.id)

  const handleBatchUpdate = (updatedBatch: typeof batches[0]) => {
    console.log(`[RecentBatches] Received SSE update: id=${updatedBatch.id}, status=${updatedBatch.status}`)
    updateBatchInList(updatedBatch)
  }

  useMultipleBatchSSE({
    batchIds: activeBatchIds,
    onUpdate: handleBatchUpdate,
    enabled: batches.length > 0
  })

  useEffect(() => {
    console.log(`[RecentBatches] Total batches: ${batches.length}, active: ${activeBatchIds.length}`)
  }, [batches, activeBatchIds.length])

  if (isLoadingInitial) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-accent-blue" />
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground">暂无任务</p>
          <p className="text-sm text-muted-foreground mt-1">点击上方按钮开始创建生成任务</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {batches.slice(0, 5).map((batch) => (
        <BatchListCard key={batch.id} batch={batch} />
      ))}
    </div>
  )
}
