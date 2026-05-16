'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useBatches } from '@/hooks/use-batches'
import { BatchListCard } from '@/components/history/batch-list-card'
import { BatchDetail } from '@/components/history/batch-detail'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function RecentBatches() {
  const router = useRouter()
  const { batches, isLoadingInitial } = useBatches()
  const recent = batches.slice(0, 5)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  if (isLoadingInitial) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (recent.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-muted-foreground">暂无记录</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {recent.map((batch) => (
          <BatchListCard
            key={batch.id}
            batch={batch}
            onClick={() => {
              setSelectedBatchId(batch.id)
              setDetailOpen(true)
            }}
          />
        ))}
        {batches.length > 5 && (
          <div className="flex justify-center">
            <Button variant="ghost" className="gap-2" asChild>
              <Link href="/history">
                查看全部 <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </div>

      <BatchDetail
        batchId={selectedBatchId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApplied={() => router.push('/generation')}
        onReferenceAdded={() => router.push('/generation')}
      />
    </>
  )
}
