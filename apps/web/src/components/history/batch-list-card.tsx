'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { User, Loader2, RotateCcw, Check, Video, Play } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'
import { translateTaskError } from '@/lib/error-messages'

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
  const router = useRouter()
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const [applied, setApplied] = useState(false)
  const status = statusConfig[batch.status] ?? statusConfig.pending

  function handleApply(e: React.MouseEvent) {
    e.stopPropagation()
    applyBatch(batch)
    setApplied(true)

    // Auto-navigate to appropriate generation page
    const isVideo = (batch as any).module === 'video' || (batch as any).module === 'avatar'
    if ((batch as any).module === 'avatar') {
      router.push('/image?mode=avatar')
    } else if (isVideo) {
      router.push('/image?mode=video')
    } else {
      router.push('/image')
    }

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

  // First error message: prefer batch-level field (set by list API), fall back to tasks array
  const firstError: string | null =
    (batch as any).error_message
    ?? batch.tasks?.find((t) => t.status === 'failed' && t.error_message)?.error_message
    ?? null

  const isVideo = (batch as any).module === 'video' || (batch as any).module === 'avatar'
  const videoUrl = isVideo
    ? batch.tasks.find((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))?.asset?.storage_url
      ?? batch.tasks.find((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))?.asset?.original_url
      ?? (batch as any).thumbnail_urls?.[0]  // fallback: list API puts video URL here
    : undefined

  return (
    <Card
      className={cn('cursor-pointer transition-shadow hover:shadow-md w-full', onClick && 'hover:border-primary/50')}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3 max-w-full overflow-hidden">
        {/* Prompt + meta row */}
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
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
            <div className="flex gap-2 overflow-hidden">
              <div className="relative h-16 w-16 shrink-0 rounded-md overflow-hidden bg-muted [transform:translateZ(0)]">
                <video
                  src={videoUrl}
                  className="h-full w-full object-contain"
                  muted
                  preload="metadata"
                  onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }}
                />
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-black/60 rounded px-1 py-0.5">
                  <Play className="h-2 w-2 text-white fill-white" />
                  <span className="text-[9px] text-white font-medium leading-none">视频</span>
                </div>
              </div>
            </div>
          ) : (batch.status === 'pending' || batch.status === 'processing') ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (batch.status === 'failed' || batch.status === 'partial_complete') && firstError ? (
            <div className="flex h-16 w-full items-center gap-2 rounded-md bg-destructive/10 px-3">
              <Video className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs text-destructive line-clamp-2">{translateTaskError(firstError)}</p>
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted gap-2">
              <Video className="h-4 w-4 text-muted-foreground" />
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

            {/* No images / failed placeholder */}
            {thumbnails.length === 0 && batch.status !== 'pending' && batch.status !== 'processing' && (
              (batch.status === 'failed' || batch.status === 'partial_complete') && firstError ? (
                <div className="flex h-16 w-full items-center gap-2 rounded-md bg-destructive/10 px-3">
                  <p className="text-xs text-destructive line-clamp-2">{translateTaskError(firstError)}</p>
                </div>
              ) : (
                <div className="flex h-16 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                  暂无图片
                </div>
              )
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
