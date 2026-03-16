'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { BatchResponse } from '@aigc/types'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Download } from 'lucide-react'
import { useBatch } from '@/hooks/use-batches'
import { downloadImage } from '@/lib/download'
import { translateTaskError } from '@/lib/error-messages'

interface BatchDetailProps {
  batchId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.1-flash-image-preview':    '全能图片2 1K',
  'gemini-3.1-flash-image-preview-2k': '全能图片2 2K',
  'gemini-3.1-flash-image-preview-4k': '全能图片2 4K',
  'nano-banana-2':                     '全能图片Pro 1K',
  'nano-banana-2-2k':                  '全能图片Pro 2K',
  'nano-banana-2-4k':                  '全能图片Pro 4K',
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'processing' | 'warning' | 'outline' }> = {
  pending: { label: '等待中', variant: 'outline' },
  processing: { label: '生成中', variant: 'processing' },
  completed: { label: '已完成', variant: 'success' },
  partial_complete: { label: '部分完成', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

export function BatchDetail({ batchId, open, onOpenChange }: BatchDetailProps) {
  const { data: batch, isLoading } = useBatch(open ? batchId : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>批次详情</SheetTitle>
          <SheetDescription className="truncate">
            {batch?.prompt ?? '加载中...'}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !batch ? (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          </div>
        ) : (
          <BatchDetailContent batch={batch} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function BatchDetailContent({ batch }: { batch: BatchResponse }) {
  const status = statusConfig[batch.status] ?? statusConfig.pending
  const time = new Date(batch.created_at)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // Collect completed tasks that have a URL
  const completedUrls = batch.tasks
    .filter((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))
    .map((t) => t.asset!.storage_url ?? t.asset!.original_url!)

  return (
    <div className="mt-6 space-y-4">
      {/* Meta info */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">状态</p>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div>
          <p className="text-muted-foreground">进度</p>
          <p className="font-medium">{batch.completed_count}/{batch.quantity}</p>
        </div>
        <div>
          <p className="text-muted-foreground">模型</p>
          <p className="font-medium">{MODEL_DISPLAY_NAMES[batch.model] ?? batch.model}</p>
        </div>
        <div>
          <p className="text-muted-foreground">积分</p>
          <p className="font-medium">{batch.actual_credits || batch.estimated_credits}</p>
        </div>
        {batch.user && (
          <div>
            <p className="text-muted-foreground">操作人</p>
            <p className="font-medium">{batch.user.username}</p>
          </div>
        )}
        <div className={batch.user ? '' : 'col-span-2'}>
          <p className="text-muted-foreground">创建时间</p>
          <p className="font-medium">{time.toLocaleString('zh-CN')}</p>
        </div>
      </div>

      <Separator />

      {/* Task images */}
      <div>
        <p className="text-sm font-medium mb-3">生成结果</p>
        {batch.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">无任务数据</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {batch.tasks.map((task) => {
              const url = task.asset?.storage_url ?? task.asset?.original_url

              if (task.status === 'completed' && url) {
                const urlIndex = completedUrls.indexOf(url)
                return (
                  <div
                    key={task.id}
                    className="group relative aspect-square rounded-lg overflow-hidden border cursor-pointer"
                    onClick={() => setLightboxIndex(urlIndex)}
                  >
                    <Image
                      src={url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="200px"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 bg-background/80 hover:bg-background"
                          onClick={(e) => { e.stopPropagation(); downloadImage(url) }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div key={task.id} className="flex aspect-square items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                  {task.status === 'failed' ? (
                    <div className="text-center px-2">
                      <p>失败</p>
                      {task.error_message && (
                        <p className="mt-1 line-clamp-2 text-[10px]">{translateTaskError(task.error_message)}</p>
                      )}
                    </div>
                  ) : task.status === 'processing' ? '生成中' : '等待中'}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && completedUrls[lightboxIndex] && (
        <ImageLightbox
          url={completedUrls[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex((i) => i! - 1) : undefined}
          onNext={lightboxIndex < completedUrls.length - 1 ? () => setLightboxIndex((i) => i! + 1) : undefined}
        />
      )}
    </div>
  )
}
