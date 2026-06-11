'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { BatchResponse } from '@aigc/types'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, Copy, Download, RotateCcw, Check, ImagePlus, Loader2, Music, Clapperboard } from 'lucide-react'
import { useBatch, cancelSeedanceBatch } from '@/hooks/use-batches'
import { downloadImage } from '@/lib/download'
import { translateTaskError } from '@/lib/error-messages'
import { useGenerationStore } from '@/stores/generation-store'
import { generateUUID } from '@/lib/utils'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/use-confirm'
import { copyTextToClipboard } from '@/lib/clipboard'

interface BatchDetailProps {
  batchId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied?: () => void
  onReferenceAdded?: () => void
}

export function BatchDetail({ batchId, open, onOpenChange, onApplied, onReferenceAdded }: BatchDetailProps) {
  const confirm = useConfirm()
  const { data: batch, isLoading, mutate } = useBatch(open ? batchId : null)
  const promptText = ((batch as any)?.module === 'action_imitation' && !batch?.prompt) ? '动作模仿任务' : (batch?.prompt ?? '加载中...')
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  async function handleCopyPrompt() {
    try {
      await copyTextToClipboard(promptText)
      setCopiedPrompt(true)
      toast.success('提示词已复制')
      setTimeout(() => setCopiedPrompt(false), 1400)
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="generation-detail-dialog h-[92vh] w-[min(1280px,calc(100vw-32px))] max-w-none overflow-hidden rounded-[18px] border border-white/10 bg-[#0a0a0b]/95 p-0 text-white shadow-[0_36px_140px_rgba(0,0,0,0.72)] backdrop-blur-2xl">
        <DialogHeader className="generation-detail-header absolute left-10 right-16 top-6 z-20 p-0 text-left">
          <DialogTitle className="sr-only">批次详情</DialogTitle>
          <DialogDescription asChild>
            <div className="generation-detail-prompt-shell" title={promptText}>
              <p className="generation-detail-prompt text-left text-xs font-medium leading-5 text-white/52">
                {promptText}
              </p>
              <button
                type="button"
                className="generation-detail-prompt-copy"
                onClick={handleCopyPrompt}
              >
                {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedPrompt ? '已复制' : '复制'}
              </button>
            </div>
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
  const confirm = useConfirm()
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const addReferenceImage = useGenerationStore((s) => s.addReferenceImage)
  const sendImagesToVideoReference = useGenerationStore((s) => s.sendImagesToVideoReference)
  const referenceCount = useGenerationStore((s) => s.referenceImages.length)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [applied, setApplied] = useState(false)
  const [sendingAll, setSendingAll] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  function handleApply() {
    applyBatch(batch)
    setApplied(true)
    setTimeout(() => setApplied(false), 1500)
    onApplied?.()
    onClose()
  }

  async function handleCancel() {
    if (!await confirm({ title: '取消任务', description: '确认取消这个 Seedance 任务？', confirmText: '取消任务' })) return
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

  const activeImageUrl = completedImageUrls[Math.min(activeImageIndex, Math.max(completedImageUrls.length - 1, 0))]
  const showImageCarousel = !isVideo && !isAudio && completedImageUrls.length > 0

  function goPrevImage() {
    if (completedImageUrls.length <= 1) return
    setActiveImageIndex((index) => (index - 1 + completedImageUrls.length) % completedImageUrls.length)
  }

  function goNextImage() {
    if (completedImageUrls.length <= 1) return
    setActiveImageIndex((index) => (index + 1) % completedImageUrls.length)
  }

  return (
    <div className="generation-detail-content relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden px-8 pb-24 pt-16">

        {/* Task results */}
        <section className="generation-detail-results flex h-full min-h-0 flex-col overflow-hidden">
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
          showImageCarousel ? (
            <div className="generation-detail-carousel">
              <div className="generation-detail-carousel-stage group" onClick={() => setLightboxIndex(Math.min(activeImageIndex, completedImageUrls.length - 1))}>
                {completedImageUrls.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="generation-detail-carousel-arrow left-5"
                    onClick={(e) => { e.stopPropagation(); goPrevImage() }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                )}
                {activeImageUrl && (
                  <Image
                    src={activeImageUrl}
                    alt=""
                    fill
                    className="object-contain"
                    sizes="820px"
                    unoptimized
                  />
                )}
                {completedImageUrls.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="generation-detail-carousel-arrow right-5"
                    onClick={(e) => { e.stopPropagation(); goNextImage() }}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                )}
                <div className="generation-detail-carousel-count">
                  {Math.min(activeImageIndex + 1, completedImageUrls.length)} / {completedImageUrls.length}
                </div>
              </div>

              {completedImageUrls.length > 1 && (
                <div className="generation-detail-carousel-thumbs" aria-label="生成图片缩略图">
                  {completedImageUrls.map((url, index) => (
                    <button
                      key={`${url}-${index}`}
                      type="button"
                      className={index === Math.min(activeImageIndex, completedImageUrls.length - 1) ? 'is-active' : ''}
                      onClick={() => setActiveImageIndex(index)}
                    >
                      <Image src={url} alt="" fill className="object-cover" sizes="64px" unoptimized />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1">
              {batch.tasks.map((task) => (
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
              ))}
            </div>
          )
        )}
        </section>
      </div>

      <div className="generation-detail-action-bar absolute bottom-5 left-0 right-0 z-20 flex items-center justify-center px-8">
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

          {showImageCarousel && activeImageUrl && (
            <Button
              size="lg"
              variant="outline"
              className="generation-detail-action generation-detail-action-muted gap-2"
              onClick={() => downloadImage(activeImageUrl, 'image')}
            >
              <Download className="h-4 w-4" />
              下载
            </Button>
          )}

          {canCancelSeedance && (
            <Button
              variant="destructive"
              size="lg"
              className="generation-detail-action gap-2"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              取消
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
