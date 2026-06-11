'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { User, Loader2, RotateCcw, Check, Video, X, Trash2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { BatchResponse, GenerateImageRequest } from '@aigc/types'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, generateUUID } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { translateTaskError } from '@/lib/error-messages'
import { apiDelete, apiPost, getRequestErrorMessage } from '@/lib/api-client'
import { getBatchImagePreviewUrls, getBatchVideoPreviewUrl, getBatchResourceTypes } from './batch-preview'

interface BatchListCardProps {
  batch: BatchResponse & { thumbnail_urls?: string[] }
  onClick?: () => void
  onHide?: (id: string) => void
  onRegenerateCreated?: (batch: BatchResponse) => void
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'processing' | 'warning' | 'outline' }> = {
  pending: { label: '排队中', variant: 'outline' },
  processing: { label: '生成中', variant: 'processing' },
  completed: { label: '已完成', variant: 'success' },
  partial_complete: { label: '部分完成', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

const resourceTypeLabels: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

/** 将 "16:9" 格式的宽高比转为 CSS aspect-ratio 值 "16 / 9" */
export function parseAspectRatio(ratio?: string): string {
  if (!ratio) return '1 / 1'
  const [w, h] = ratio.split(':')
  if (!w || !h || isNaN(Number(w)) || isNaN(Number(h))) return '1 / 1'
  return `${w} / ${h}`
}

/** 视频预览：16:9 固定比例，进入视野自动静音播放 */
function VideoPreview({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={url}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        controls
      />
    </div>
  )
}

/** 判断是否为竖向比例（高 > 宽） */
function isPortraitRatio(ratio: string): boolean {
  const [w, h] = ratio.split(':').map(Number)
  return !!w && !!h && h > w
}

/** 图片轮播：
 *  - 横图（16:9 / 4:3 / 1:1）：固定高度 280px，宽度按比例，一次一张，左右翻页
 *  - 竖图（9:16 / 3:4）：瀑布流展示所有图，左下角页签点击滚动定位
 */
function ImageCarousel({ urls, aspectRatio }: { urls: string[]; aspectRatio: string }) {
  const [index, setIndex] = useState(0)
  const isPortrait = isPortraitRatio(aspectRatio)
  const isMulti = urls.length > 1
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIndex((i) => Math.max(0, i - 1))
  }
  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIndex((i) => Math.min(urls.length - 1, i + 1))
  }

  // 竖图：点击页签滚动到对应图片
  const handleTabClick = (e: React.MouseEvent, i: number) => {
    e.stopPropagation()
    setIndex(i)
    itemRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // 横图模式
  if (!isPortrait) {
    return (
      <div className="generation-dream-media-frame group relative w-full rounded-2xl overflow-hidden bg-muted flex justify-center">
        <div className="relative" style={{ height: 400, aspectRatio }}>
          <Image
            src={urls[index]}
            alt=""
            fill
            className="object-cover"
            sizes="600px"
            unoptimized
          />
        </div>
        {isMulti && (
          <>
            <button
              className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full
                flex items-center justify-center
                bg-white/20 backdrop-blur-sm border border-white/30
                text-white shadow-[0_2px_8px_rgba(107,163,245,0.4)]
                opacity-0 group-hover:opacity-100 transition-all duration-200
                hover:bg-gradient-to-br hover:from-[#F5A962] hover:via-[#C89BEC] hover:to-[#6BA3F5]
                hover:border-transparent hover:scale-110
                disabled:opacity-0 disabled:pointer-events-none"
              onClick={handlePrev}
              disabled={index === 0}
            >
              <ChevronLeft className="h-5 w-5 drop-shadow" />
            </button>
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full
                flex items-center justify-center
                bg-white/20 backdrop-blur-sm border border-white/30
                text-white shadow-[0_2px_8px_rgba(107,163,245,0.4)]
                opacity-0 group-hover:opacity-100 transition-all duration-200
                hover:bg-gradient-to-br hover:from-[#F5A962] hover:via-[#C89BEC] hover:to-[#6BA3F5]
                hover:border-transparent hover:scale-110
                disabled:opacity-0 disabled:pointer-events-none"
              onClick={handleNext}
              disabled={index === urls.length - 1}
            >
              <ChevronRight className="h-5 w-5 drop-shadow" />
            </button>
            {/* 左下角页码 */}
            <div className="absolute bottom-2 left-3 flex items-center gap-1">
              {urls.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setIndex(i) }}
                  className="h-5 min-w-[20px] px-1.5 rounded text-[10px] font-medium transition-all duration-200 leading-none"
                  style={{
                    background: i === index
                      ? 'linear-gradient(90deg, #F5A962, #C89BEC, #6BA3F5)'
                      : 'rgba(0,0,0,0.45)',
                    backdropFilter: 'blur(6px)',
                    color: i === index ? 'white' : 'rgba(255,255,255,0.85)',
                    border: i === index ? 'none' : '1px solid rgba(255,255,255,0.5)',
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            {/* 底部居中指示点 */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
              {urls.map((_, i) => (
                <span
                  key={i}
                  className="block h-1 rounded-full transition-all duration-300"
                  style={{
                    width: i === index ? 16 : 4,
                    background: i === index
                      ? 'linear-gradient(90deg, #F5A962, #C89BEC, #6BA3F5)'
                      : 'rgba(255,255,255,0.45)',
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // 竖图模式：瀑布流 + 左下角页签
  return (
    <div className="generation-dream-media-frame relative w-full rounded-2xl overflow-hidden bg-muted">
      <div
        ref={containerRef}
        className="columns-2 gap-1.5"
        style={{ columnFill: 'balance' }}
      >
        {urls.map((url, i) => (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el }}
            className="break-inside-avoid mb-1.5 overflow-hidden rounded-sm"
          >
            <Image
              src={url}
              alt=""
              width={0}
              height={0}
              sizes="50vw"
              className="w-full h-auto block"
              style={{ aspectRatio }}
              unoptimized
            />
          </div>
        ))}
      </div>
      {/* 左下角页签 */}
      {isMulti && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 flex-wrap max-w-[60%]">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={(e) => handleTabClick(e, i)}
              className="h-5 min-w-[20px] px-1.5 rounded text-[10px] font-medium transition-all duration-200 leading-none"
              style={{
                background: i === index
                  ? 'linear-gradient(90deg, #F5A962, #C89BEC, #6BA3F5)'
                  : 'rgba(255,255,255,0.25)',
                backdropFilter: 'blur(4px)',
                color: 'white',
                border: i === index ? 'none' : '1px solid rgba(255,255,255,0.3)',
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`
}

function getBatchParams(batch: BatchResponse): Record<string, unknown> {
  return batch.params && typeof batch.params === 'object' && !Array.isArray(batch.params)
    ? batch.params as Record<string, unknown>
    : {}
}

async function regenerateBatch(batch: BatchResponse, workspaceId: string): Promise<BatchResponse> {
  const params = getBatchParams(batch)

  if (batch.module === 'image') {
    const imageParams = { ...params }
    if (!imageParams.image && Array.isArray(imageParams.reference_image_urls)) {
      imageParams.image = imageParams.reference_image_urls
    }
    const body: GenerateImageRequest = {
      idempotency_key: generateUUID(),
      model: batch.model,
      prompt: batch.prompt.trim(),
      quantity: batch.quantity,
      params: imageParams,
      workspace_id: workspaceId,
    }
    return apiPost<BatchResponse>('/generate/image', body)
  }

  if (batch.module === 'video') {
    return apiPost<BatchResponse>('/videos/generate', {
      workspace_id: workspaceId,
      model: batch.model,
      prompt: batch.prompt.trim(),
      ...params,
    })
  }

  throw new Error('当前类型暂不支持从历史记录直接重新生成')
}

export function BatchListCard({ batch, onClick, onHide, onRegenerateCreated }: BatchListCardProps) {
  const router = useRouter()
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [applied, setApplied] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const status = statusConfig[batch.status] ?? statusConfig.pending

  const isCancellable =
    (batch as any).module === 'video' &&
    (batch as any).provider === 'volcengine' &&
    (batch.status === 'processing' || batch.status === 'pending')

  useEffect(() => {
    if (batch.status !== 'processing') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [batch.status])

  async function handleCancel(e: React.MouseEvent) {
    e.stopPropagation()
    if (cancelling) return
    setCancelling(true)
    try {
      await apiDelete(`/videos/batches/${batch.id}/cancel`)
    } catch {
      // SSE will update status; ignore errors silently
    } finally {
      setCancelling(false)
    }
  }

  async function handleHide(e: React.MouseEvent) {
    e.stopPropagation()
    if (hiding) return
    setHiding(true)
    try {
      onHide?.(batch.id)
    } finally {
      setHiding(false)
    }
  }

  function handleApply(e: React.MouseEvent) {
    e.stopPropagation()
    applyBatch(batch)
    setApplied(true)
    navigateToBatchMode()

    setTimeout(() => setApplied(false), 1500)
  }

  function navigateToBatchMode() {
    const isVideo = (batch as any).module === 'video' || (batch as any).module === 'avatar' || (batch as any).module === 'action_imitation'
    if ((batch as any).module === 'avatar') {
      router.push('/generation?mode=avatar')
    } else if ((batch as any).module === 'action_imitation') {
      router.push('/generation?mode=action_imitation')
    } else if (isVideo) {
      router.push('/generation?mode=video')
    } else {
      router.push('/generation')
    }
  }

  async function handleRegenerate(e: React.MouseEvent) {
    e.stopPropagation()
    if (regenerating) return
    if (!activeWorkspaceId) {
      toast.error('当前没有可用的工作区')
      return
    }
    if (batch.module !== 'image' && batch.module !== 'video') {
      toast.error('当前类型暂不支持从历史记录直接重新生成')
      return
    }
    if (!batch.prompt?.trim()) {
      toast.error('缺少提示词，无法重新生成')
      return
    }

    setRegenerating(true)
    try {
      applyBatch(batch)
      navigateToBatchMode()
      const nextBatch = await regenerateBatch(batch, activeWorkspaceId)
      onRegenerateCreated?.(nextBatch)
      toast.success('已提交重新生成')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, err instanceof Error ? err.message : '重新生成失败，请稍后重试'))
    } finally {
      setRegenerating(false)
    }
  }

  const thumbnails = getBatchImagePreviewUrls(batch)
  const resourceTypes = getBatchResourceTypes(batch)

  const time = new Date(batch.created_at)
  const thumbnailAspect = parseAspectRatio((batch as any).params?.aspect_ratio)

  // First error message: prefer batch-level field (set by list API), fall back to tasks array
  const firstError: string | null =
    (batch as any).error_message
    ?? batch.tasks?.find((t) => t.status === 'failed' && t.error_message)?.error_message
    ?? null

  const isVideo = (batch as any).module === 'video' || (batch as any).module === 'avatar' || (batch as any).module === 'action_imitation'
  const videoUrl = isVideo ? getBatchVideoPreviewUrl(batch) : undefined
  const firstProcessingStartedAt = batch.tasks
    .map((task) => task.processing_started_at)
    .find(Boolean)
  const statusHint = batch.status === 'pending'
    ? typeof (batch as any).queue_position === 'number'
      ? `前方还有 ${(batch as any).queue_position} 个任务`
      : '等待调度'
    : batch.status === 'processing' && firstProcessingStartedAt
      ? `已用时 ${formatElapsed(now - new Date(firstProcessingStartedAt).getTime())}`
      : null

  return (
    <Card
      className={cn('generation-dream-history-card cursor-pointer transition-shadow hover:shadow-md w-full', onClick && 'hover:border-primary/50')}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3 max-w-full overflow-hidden">
        {/* Prompt + meta row */}
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-sm font-medium truncate">{((batch as any).module === 'action_imitation' && !batch.prompt) ? '动作模仿任务' : batch.prompt}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={status.variant} className="text-[10px]">
                {status.label}
              </Badge>
              {resourceTypes.map((type) => (
                <Badge key={type} variant="outline" className="text-[10px]">
                  {resourceTypeLabels[type] ?? type}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground">
                {batch.completed_count}/{batch.quantity}
              </span>
              {statusHint && (
                <span className="text-xs text-muted-foreground">{statusHint}</span>
              )}
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
        </div>

        {/* Thumbnail grid / video preview */}
        {isVideo ? (
          videoUrl ? (
            <VideoPreview url={videoUrl} />
          ) : (batch.status === 'pending' || batch.status === 'processing') ? (
            <div className="generation-dream-media-frame flex h-16 w-16 items-center justify-center rounded-xl bg-muted gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (batch.status === 'failed' || batch.status === 'partial_complete') && firstError ? (
            <div className="flex h-16 w-full items-center gap-2 rounded-md bg-destructive/10 px-3">
              <Video className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs text-destructive line-clamp-2">
                {translateTaskError(firstError)}，本次失败任务A豆已退还
              </p>
            </div>
          ) : (
            <div className="generation-dream-media-frame flex h-16 w-16 items-center justify-center rounded-xl bg-muted gap-2">
              <Video className="h-4 w-4 text-muted-foreground" />
            </div>
          )
        ) : (
          <>
            {/* Image thumbnails — 宽度填满按比例，多图轮播 */}
            {thumbnails.length > 0 && (
              <ImageCarousel urls={thumbnails} aspectRatio={thumbnailAspect} />
            )}

            {/* Loading animation for pending/processing */}
            {thumbnails.length === 0 && (batch.status === 'pending' || batch.status === 'processing') && (
              <div className="generation-dream-media-frame flex h-16 items-center justify-center rounded-xl bg-muted">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* No images / failed placeholder */}
            {thumbnails.length === 0 && batch.status !== 'pending' && batch.status !== 'processing' && (
              (batch.status === 'failed' || batch.status === 'partial_complete') && firstError ? (
                <div className="flex h-16 w-full items-center gap-2 rounded-md bg-destructive/10 px-3">
                  <p className="text-xs text-destructive line-clamp-2">
                    {translateTaskError(firstError)}，本次失败任务A豆已退还
                  </p>
                </div>
              ) : (
                <div className="generation-dream-media-frame flex h-16 items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">
                  暂无图片
                </div>
              )
            )}
          </>
        )}

        {/* Reuse / Cancel / Hide buttons */}
        <div className="flex justify-end gap-1">
          {isCancellable && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <><X className="h-3 w-3 mr-1" />取消</>}
            </Button>
          )}
          <div className="flex h-7 items-center px-2 text-xs font-medium text-muted-foreground">
            {batch.actual_credits || batch.estimated_credits} A豆
          </div>
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
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RefreshCw className="h-3 w-3 mr-1" />重新生成</>}
          </Button>
          {onHide && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleHide}
              disabled={hiding}
              title="隐藏"
            >
              {hiding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
