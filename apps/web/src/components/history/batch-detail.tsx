'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { BatchResponse } from '@aigc/types'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Download, RotateCcw, Check, ImagePlus, Loader2, Music, Clapperboard } from 'lucide-react'
import { useBatch, cancelSeedanceBatch } from '@/hooks/use-batches'
import { downloadImage } from '@/lib/download'
import { translateTaskError } from '@/lib/error-messages'
import { useGenerationStore } from '@/stores/generation-store'
import { generateUUID } from '@/lib/utils'
import { toast } from 'sonner'
import { parseAspectRatio } from './batch-list-card'

interface BatchDetailProps {
  batchId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied?: () => void
  onReferenceAdded?: () => void
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.1-flash-image-preview':    '全能图片2 1K',
  'gemini-3.1-flash-image-preview-2k': '全能图片2 2K',
  'gemini-3.1-flash-image-preview-4k': '全能图片2 4K',
  'gpt-image-2':                       '超能图片2',
  'nano-banana-pro':                   '全能图片Pro 1K',
  'nano-banana-pro-2k':                '全能图片Pro 2K',
  'nano-banana-pro-4k':                '全能图片Pro 4K',
  'veo3.1-fast':                       '全能视频3.1 Fast',
  'veo3.1-components':                 '全能视频3.1',
  'jimeng_realman_avatar_picture_omni_v15': 'OmniHuman 1.5 数字人',
  'jimeng_dreamactor_m20_gen_video': '动作模仿2.0',
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'processing' | 'warning' | 'outline' }> = {
  pending: { label: '等待中', variant: 'outline' },
  processing: { label: '生成中', variant: 'processing' },
  completed: { label: '已完成', variant: 'success' },
  partial_complete: { label: '部分完成', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

export function BatchDetail({ batchId, open, onOpenChange, onApplied, onReferenceAdded }: BatchDetailProps) {
  const { data: batch, isLoading, mutate } = useBatch(open ? batchId : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="generation-detail-dialog h-[88vh] w-[min(1240px,calc(100vw-40px))] max-w-none overflow-hidden rounded-[28px] border border-violet-200/25 bg-[#070914]/95 p-0 text-white shadow-[0_36px_140px_rgba(1,3,16,0.78)] backdrop-blur-2xl">
        <DialogHeader className="generation-detail-header px-8 pb-5 pt-7 text-left">
          <DialogTitle className="text-2xl font-semibold text-white">批次详情</DialogTitle>
          <DialogDescription className="mt-3 line-clamp-2 max-w-[980px] whitespace-pre-wrap break-words pr-10 text-left text-sm leading-6 text-[#c8d7ff]/70">
            {((batch as any)?.module === 'action_imitation' && !batch?.prompt) ? '动作模仿任务' : (batch?.prompt ?? '加载中...')}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !batch ? (
          <div className="space-y-4 p-7">
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
          <BatchDetailContent batch={batch} onClose={() => onOpenChange(false)} onApplied={onApplied} onReferenceAdded={onReferenceAdded} onCancelled={() => mutate()} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function BatchDetailContent({ batch, onClose, onApplied, onReferenceAdded, onCancelled }: { batch: BatchResponse; onClose: () => void; onApplied?: () => void; onReferenceAdded?: () => void; onCancelled?: () => void }) {
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const addReferenceImage = useGenerationStore((s) => s.addReferenceImage)
  const sendImagesToVideoReference = useGenerationStore((s) => s.sendImagesToVideoReference)
  const referenceCount = useGenerationStore((s) => s.referenceImages.length)
  const status = statusConfig[batch.status] ?? statusConfig.pending
  const time = new Date(batch.created_at)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [applied, setApplied] = useState(false)
  const [sendingUrl, setSendingUrl] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  function handleApply() {
    applyBatch(batch)
    setApplied(true)
    setTimeout(() => setApplied(false), 1500)
    onApplied?.()
    onClose()
  }

  async function handleCancel() {
    if (!confirm('确认取消这个 Seedance 任务？')) return
    setCancelling(true)
    try {
      await cancelSeedanceBatch(batch.id)
      toast.success('任务已取消，A豆已退回')
      onCancelled?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消任务失败')
    } finally {
      setCancelling(false)
    }
  }

  async function handleSendToReference(previewUrl: string, showSuccess = true) {
    if (referenceCount >= 10) {
      toast.error('最多添加 10 张参考图')
      return
    }
    setSendingUrl(previewUrl)
    try {
      addReferenceImage({
        id: generateUUID(),
        previewUrl,
      })
      if (showSuccess) {
        toast.success('已发送至参考区')
        onReferenceAdded?.()
      }
    } finally {
      setSendingUrl(null)
    }
  }

  async function handleSendAllToReference() {
    if (completedImageUrls.length === 0) return
    if (referenceCount >= 10) {
      toast.error('最多添加 10 张参考图')
      return
    }
    setSendingAll(true)
    try {
      const availableSlots = 10 - referenceCount
      const toAdd = completedImageUrls.slice(0, availableSlots)
      for (const url of toAdd) {
        addReferenceImage({ id: generateUUID(), previewUrl: url })
      }
      toast.success('已发送至参考区')
      if (completedImageUrls.length > availableSlots) {
        toast.info(`参考区最多 10 张，已添加前 ${availableSlots} 张`)
      }
      onReferenceAdded?.()
    } finally {
      setSendingAll(false)
    }
  }

  function handleTurnIntoVideo() {
    if (completedImageUrls.length === 0) return
    sendImagesToVideoReference(
      completedImageUrls.slice(0, 10).map((url) => ({
        id: generateUUID(),
        previewUrl: url,
        dataUrl: url,
      }))
    )
    toast.success('已切换到视频页签，并添加到参考素材')
    onReferenceAdded?.()
    onClose()
  }

  const completedAssetItems = batch.tasks
    .filter((t) => t.status === 'completed' && (t.asset?.storage_url ?? t.asset?.original_url))
    .map((t) => ({
      type: t.asset!.type,
      url: t.asset!.storage_url ?? t.asset!.original_url!,
    }))
  const completedImageUrls = completedAssetItems
    .filter((asset) => asset.type === 'image')
    .map((asset) => asset.url)
  const completedVideoUrls = completedAssetItems
    .filter((asset) => asset.type === 'video')
    .map((asset) => asset.url)
  const completedAudioUrls = completedAssetItems
    .filter((asset) => asset.type === 'audio')
    .map((asset) => asset.url)

  const isVideo = (batch as any).module === 'video' || (batch as any).module === 'avatar' || (batch as any).module === 'action_imitation' || completedVideoUrls.length > 0
  const isAudio = !isVideo && (
    (batch as any).module === 'tts' ||
    (batch as any).module === 'music' ||
    (batch as any).module === 'music_voice_clone' ||
    completedAudioUrls.length > 0
  )
  const canCancelSeedance = (batch.status === 'pending' || batch.status === 'processing') && batch.provider === 'volcengine' && /^seedance-/i.test(batch.model)

  const thumbnailAspect = parseAspectRatio((batch as any).params?.aspect_ratio)

  return (
    <div className="generation-detail-content flex h-[calc(88vh-132px)] min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden px-8 pb-5 pt-2 lg:grid-cols-[270px_minmax(0,1fr)]">
        {/* Meta info */}
        <aside className="generation-detail-meta space-y-5 overflow-hidden rounded-[22px] p-5 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <p className="generation-detail-label">状态</p>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <div>
              <p className="generation-detail-label">进度</p>
              <p className="generation-detail-value">{batch.completed_count}/{batch.quantity}</p>
            </div>
            <div className="col-span-2">
              <p className="generation-detail-label">模型</p>
              <p className="generation-detail-value">{MODEL_DISPLAY_NAMES[batch.model] ?? batch.model}</p>
            </div>
            <div>
              <p className="generation-detail-label">A豆</p>
              <p className="generation-detail-value">{batch.actual_credits || batch.estimated_credits}</p>
            </div>
            {batch.user && (
              <div>
                <p className="generation-detail-label">操作人</p>
                <p className="generation-detail-value">{batch.user.username}</p>
              </div>
            )}
            <div className={batch.user ? '' : 'col-span-2'}>
              <p className="generation-detail-label">创建时间</p>
              <p className="generation-detail-value">{time.toLocaleString('zh-CN')}</p>
            </div>
          </div>

          {canCancelSeedance && (
            <Button
              variant="destructive"
              size="sm"
              className="w-full gap-2"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              取消任务
            </Button>
          )}
        </aside>

        {/* Task results */}
        <section className="generation-detail-results flex min-h-0 flex-col overflow-hidden rounded-[24px] p-5">
        <p className="mb-4 shrink-0 text-sm font-medium text-white/85">生成结果</p>
        {batch.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">无任务数据</p>
        ) : isAudio ? (
          /* Audio tasks */
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {batch.tasks.map((task) => {
              const url = task.asset?.storage_url ?? task.asset?.original_url
              if (task.status === 'completed' && url) {
                return (
                  <div key={task.id} className="generation-detail-audio-card rounded-2xl p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <Music className="h-3.5 w-3.5 shrink-0" />
                        <span>音频结果</span>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => downloadImage(url, 'audio')}>
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </Button>
                    </div>
                    <audio src={url} controls className="block h-9 w-full rounded-md" />
                  </div>
                )
              }
              return (
                <div key={task.id} className="flex h-20 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                  {task.status === 'failed' ? (
                    <div className="text-center px-3">
                      <p className="font-medium text-destructive">生成失败</p>
                      {task.error_message && (
                        <p className="mt-1 line-clamp-3 text-xs text-destructive/80">{translateTaskError(task.error_message)}</p>
                      )}
                    </div>
                  ) : task.status === 'processing' ? '音频生成中...' : '等待中'}
                </div>
              )
            })}
          </div>
        ) : isVideo ? (
          /* Video tasks */
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {batch.tasks.map((task) => {
              const url = task.asset?.storage_url ?? task.asset?.original_url
              if (task.status === 'completed' && url) {
                return (
                  <div key={task.id} className="generation-detail-video-card overflow-hidden rounded-3xl">
                    <video
                      src={url}
                      controls
                      className="max-h-full w-full object-contain"
                      preload="metadata"
                    />
                    <div className="flex justify-end px-4 py-3">
                      <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => downloadImage(url, 'video')}>
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </Button>
                    </div>
                  </div>
                )
              }
              return (
                <div key={task.id} className="flex h-20 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                  {task.status === 'failed' ? (
                    <div className="text-center px-3">
                      <p className="font-medium text-destructive">生成失败</p>
                      {task.error_message && (
                        <p className="mt-1 line-clamp-3 text-xs text-destructive/80">{translateTaskError(task.error_message)}</p>
                      )}
                    </div>
                  ) : task.status === 'processing' ? '视频生成中...' : '等待中'}
                </div>
              )
            })}
          </div>
        ) : (
          /* Image tasks */
          <div className={completedImageUrls.length <= 1 ? 'generation-detail-image-list generation-detail-image-list-single' : 'generation-detail-image-list generation-detail-image-list-grid'}>
            {batch.tasks.map((task) => {
              const url = task.asset?.storage_url ?? task.asset?.original_url

              if (task.status === 'completed' && url) {
                const urlIndex = completedImageUrls.indexOf(url)
                return (
                  <div
                    key={task.id}
                    className={completedImageUrls.length <= 1 ? 'generation-detail-image-tile generation-detail-image-tile-single group relative cursor-pointer overflow-hidden' : 'generation-detail-image-tile group relative cursor-pointer overflow-hidden'}
                    style={completedImageUrls.length <= 1 ? undefined : { aspectRatio: thumbnailAspect }}
                    onClick={() => setLightboxIndex(urlIndex)}
                  >
                    <Image
                      src={url}
                      alt=""
                      fill
                      className="object-contain"
                      sizes={completedImageUrls.length <= 1 ? '900px' : '360px'}
                      unoptimized
                    />
                    <div className="absolute inset-0 flex items-end justify-end bg-black/0 p-3 opacity-0 transition-colors group-hover:bg-black/30 group-hover:opacity-100">
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
                          onClick={(e) => { e.stopPropagation(); handleSendToReference(url) }}
                          disabled={sendingUrl === url}
                          title="发送至参考"
                        >
                          {sendingUrl === url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
                          onClick={(e) => { e.stopPropagation(); downloadImage(url, task.asset?.type) }}
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
                    <div className="text-center px-3">
                      <p className="font-medium text-destructive">生成失败</p>
                      {task.error_message && (
                        <p className="mt-1 line-clamp-3 text-xs text-destructive/80">{translateTaskError(task.error_message)}</p>
                      )}
                    </div>
                  ) : task.status === 'processing' ? '生成中' : '等待中'}
                </div>
              )
            })}
          </div>
        )}
        </section>
      </div>

      <div className="generation-detail-action-bar flex shrink-0 items-center justify-center px-8 pb-6 pt-2">
        <div className="generation-detail-actions">
          <Button
            variant="outline"
            size="lg"
            className="generation-detail-action generation-detail-action-muted gap-2"
            onClick={handleApply}
            disabled={applied}
          >
            {applied ? <Check className="h-4 w-4 text-green-400" /> : <RotateCcw className="h-4 w-4" />}
            复用
          </Button>

          <Button
            size="lg"
            className="generation-detail-action generation-detail-action-primary gap-2"
            onClick={handleSendAllToReference}
            disabled={isVideo || isAudio || completedImageUrls.length === 0 || sendingAll || referenceCount >= 10}
          >
            {sendingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            参考
          </Button>

          {!isVideo && !isAudio && completedImageUrls.length > 0 && (
            <Button
              size="lg"
              className="generation-detail-action generation-detail-action-video gap-2"
              onClick={handleTurnIntoVideo}
            >
              <Clapperboard className="h-4 w-4" />
              变视频
            </Button>
          )}
        </div>
      </div>

      {/* Lightbox (images only) */}
      {!isVideo && !isAudio && lightboxIndex !== null && completedImageUrls[lightboxIndex] && (
        <ImageLightbox
          url={completedImageUrls[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex((i) => i! - 1) : undefined}
          onNext={lightboxIndex < completedImageUrls.length - 1 ? () => setLightboxIndex((i) => i! + 1) : undefined}
        />
      )}
    </div>
  )
}
