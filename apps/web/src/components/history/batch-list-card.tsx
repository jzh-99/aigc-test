'use client'

import { useState } from 'react'
import Image from 'next/image'
import { User, Loader2, RotateCcw, Check, Video, Play } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'

interface BatchListCardProps {
  batch: BatchResponse & { thumbnail_urls?: string[] }
  onClick?: () => void
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'processing' | 'warning' | 'outline' }> = {
  pending: { label: '等待中', variant: 'outline' },
  processing: { label: '生成中', variant: 'processing' },
  completed: { label: '已完成', variant: 'success' },
  partial_complete: { label: '部分完成', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

export function BatchListCard({ batch, onClick }: BatchListCardProps) {
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const [applied, setApplied] = useState(false)
  const status = statusConfig[batch.status] ?? statusConfig.pending

  function handleApply(e: React.MouseEvent) {
    e.stopPropagation()
    applyBatch(batch)
    setApplied(true)
    setTimeout(() => setApplied(false), 1500)
  }

  // Use thumbnail_urls from list API, fall back to tasks data
  const thumbnails: string[] = (batch as any).thumbnail_urls?.length
    ? (batch as any).thumbnail_urls
    : batch.tasks
        .filter((t) => t.status === 'completed' && (t.asset?.storage_url || t.asset?.original_url))
        .map((t) => t.asset!.storage_url ?? t.asset!.original_url!)

  const time = new Date(batch.created_at)

  const showLoading = thumbnails.length === 0 && (batch.status === 'pending' || batch.status === 'processing')
  console.log('[BatchListCard]', batch.id, 'status:', batch.status, 'thumbnails:', thumbnails.length, 'showLoading:', showLoading)

  const isVideo = (batch as any).module === 'video'
  const videoUrl = isVideo
    ? batch.tasks.find((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))?.asset?.storage_url
      ?? batch.tasks.find((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))?.asset?.original_url
    : undefined

  return (
    <Card
      className={cn('cursor-pointer transition-shadow hover:shadow-md', onClick && 'hover:border-primary/50')}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Prompt + meta row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{batch.prompt}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={status.variant} className="text-[10px]">
                {status.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {batch.completed_count}/{batch.quantity}
              </span>
              {batch.user && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  {batch.user.username}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {time.toLocaleDateString('zh-CN')} {time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">积分</p>
            <p className="text-sm font-medium">{batch.actual_credits || batch.estimated_credits}</p>
          </div>
        </div>

        {/* Thumbnail grid / video preview */}
        {isVideo ? (
          videoUrl ? (
            <div className="relative h-20 w-full rounded-md overflow-hidden bg-muted">
              <video
                src={videoUrl}
                className="h-full w-full object-cover"
                muted
                preload="metadata"
                onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }}
              />
              {/* Video badge */}
              <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-black/60 rounded-md px-1.5 py-0.5">
                <Play className="h-2.5 w-2.5 text-white fill-white" />
                <span className="text-[10px] text-white font-medium leading-none">视频</span>
              </div>
            </div>
          ) : (batch.status === 'pending' || batch.status === 'processing') ? (
            <div className="flex h-20 items-center justify-center rounded-md bg-muted gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">视频生成中</span>
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center rounded-md bg-muted gap-2">
              <Video className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">视频</span>
            </div>
          )
        ) : (
          <>
            {/* Image thumbnails */}
            {thumbnails.length > 0 && (
              <div className="flex gap-2 overflow-hidden">
                {thumbnails.slice(0, 5).map((url, i) => (
                  <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                    <Image
                      src={url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="64px"
                      unoptimized
                    />
                  </div>
                ))}
                {thumbnails.length > 5 && (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                    +{thumbnails.length - 5}
                  </div>
                )}
              </div>
            )}

            {/* Loading animation for pending/processing */}
            {thumbnails.length === 0 && (batch.status === 'pending' || batch.status === 'processing') && (
              <div className="flex h-16 items-center justify-center rounded-md bg-muted">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* No images placeholder */}
            {thumbnails.length === 0 && batch.status !== 'pending' && batch.status !== 'processing' && (
              <div className="flex h-16 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                暂无图片
              </div>
            )}
          </>
        )}

        {/* Reuse button */}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              'h-7 px-2 text-xs',
              applied && 'text-green-600'
            )}
            onClick={handleApply}
          >
            {applied ? <><Check className="h-3 w-3 mr-1" />已填入</> : <><RotateCcw className="h-3 w-3 mr-1" />复用</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
