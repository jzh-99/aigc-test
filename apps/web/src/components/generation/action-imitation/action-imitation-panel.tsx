'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Coins, ImagePlus, Clapperboard, Play, X } from 'lucide-react'
import Image from 'next/image'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { fetchWithAuth, ApiError, getRequestErrorMessage, reportClientSubmissionError, classifyRequestError } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import type { FrameImage } from '../shared/types'
import { readFrameFile, isValidImageFile, isValidVideoFile, getDraggedAsset, fetchAssetFile, getActionImagePayload } from '../shared/file-utils'

interface ActionVideo {
  file: File
  previewUrl: string
  duration: number
  name: string
}

interface ActionImitationPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
}

export function ActionImitationPanel({ onBatchCreated, disabled }: ActionImitationPanelProps) {
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)

  const [actionImage, setActionImage] = useState<FrameImage | null>(null)
  const [actionVideo, setActionVideo] = useState<ActionVideo | null>(null)
  const [actionVideoPreviewOpen, setActionVideoPreviewOpen] = useState(false)
  const [isActionGenerating, setIsActionGenerating] = useState(false)

  const actionImageRef = useRef<HTMLInputElement>(null)
  const actionVideoRef = useRef<HTMLInputElement>(null)

  const handleActionImageDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    if (asset.type === 'video') { toast.error('当前区域只支持图片参考，请拖拽图片资产'); return }
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'action-image')
      if (file.size > 4.7 * 1024 * 1024) { toast.error('人物图片不能超过 4.7 MB'); return }
      const img = await readFrameFile(file, true)
      if (img) setActionImage(img)
    } catch {
      toast.error('图片加载失败，请确认网络可访问图片服务器')
    }
  }

  const handleActionVideoDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    if (asset.type !== 'video') { toast.error('当前区域只支持视频参考，请拖拽视频资产'); return }
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'action-video')
      if (!isValidVideoFile(file)) { toast.error(`文件「${file.name}」格式不支持，请上传 MP4 / MOV / WEBM 格式的视频`); return }
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.src = url
      video.onloadedmetadata = () => {
        const dur = video.duration
        URL.revokeObjectURL(url)
        if (dur > 30) { toast.error('驱动视频时长不能超过 30 秒'); return }
        setActionVideo({ file, previewUrl: URL.createObjectURL(file), duration: dur, name: file.name })
      }
    } catch {
      toast.error('视频加载失败，请确认网络可访问视频服务器')
    }
  }

  const handleActionImitationGenerate = async () => {
    if (!actionImage || !actionVideo) return
    setIsActionGenerating(true)
    try {
      const videoForm = new FormData()
      videoForm.append('file', actionVideo.file, actionVideo.name)
      const videoUpload = await fetchWithAuth<{ url: string }>('/action-imitation/upload', { method: 'POST', body: videoForm })

      const actionImagePayload = await getActionImagePayload(actionImage)

      const batch = await fetchWithAuth<BatchResponse>('/action-imitation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspaceId,
          image_base64: actionImagePayload.base64,
          image_mime: actionImagePayload.mime,
          video_url: videoUpload.url,
          video_duration: actionVideo.duration,
        }),
      })
      onBatchCreated(batch)
    } catch (err) {
      if (err instanceof Error && err.message === 'ACTION_IMAGE_UNSUPPORTED_FORMAT') {
        toast.error('动作模仿仅支持 JPG / PNG 人物图片，请更换图片')
        return
      }
      const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
      void reportClientSubmissionError({
        error_code: classifyRequestError(err),
        detail: rawMessage.slice(0, 500) || undefined,
        http_status: err instanceof ApiError ? err.status : null,
      })
      toast.error(getRequestErrorMessage(err, '动作模仿生成请求失败，请稍后重试'))
    } finally {
      setIsActionGenerating(false)
    }
  }

  const estimatedCredits = actionVideo ? `${Math.ceil(actionVideo.duration) * 20} 积分` : '20 积分/秒'
  const isDisabled = isActionGenerating || !!disabled

  return (
    <>
      <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4 flex-1 flex flex-col min-h-0 gap-2">
        {/* 人物图片上传 */}
        <div className="flex-1 min-h-0 flex flex-col">
          <p className="text-[11px] text-muted-foreground mb-1 shrink-0">人物图片（必填，≤4.7MB）</p>
          {actionImage ? (
            <div className="flex-1 min-h-0 relative rounded-lg overflow-hidden border bg-muted group"
              onDragOver={(e) => e.preventDefault()} onDrop={handleActionImageDrop}>
              <Image src={actionImage.previewUrl} alt="" fill className="object-contain" sizes="300px" unoptimized />
              <button
                onClick={() => setActionImage(null)}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
              ><X className="h-3 w-3 text-background" /></button>
            </div>
          ) : (
            <button
              onClick={() => actionImageRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleActionImageDrop}
              className="flex-1 min-h-0 w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex flex-col items-center justify-center gap-1"
            >
              <ImagePlus className="h-5 w-5 text-primary shrink-0" />
              <div className="text-center">
                <div className="text-sm font-medium text-primary">上传人物图片</div>
                <div className="text-[11px] text-primary/60">jpg / png · 最大 4.7MB</div>
              </div>
            </button>
          )}
        </div>

        {/* 驱动视频上传 */}
        <div className="flex-1 min-h-0 flex flex-col">
          <p className="text-[11px] text-muted-foreground mb-1 shrink-0">驱动视频（必填，≤30秒）</p>
          {actionVideo ? (
            <div
              className="flex-1 min-h-0 relative rounded-lg overflow-hidden border bg-black group cursor-pointer"
              onClick={() => setActionVideoPreviewOpen(true)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleActionVideoDrop}
            >
              <video src={actionVideo.previewUrl} className="absolute inset-0 w-full h-full object-contain"
                muted playsInline preload="metadata"
                onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                <Play className="h-8 w-8 text-white drop-shadow" />
              </div>
              <div className="absolute bottom-1 left-1 right-7">
                <span className="text-[10px] bg-black/60 text-white rounded px-1 py-0.5 truncate block">
                  {actionVideo.name} · {actionVideo.duration.toFixed(1)}s
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setActionVideo(null) }}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
              ><X className="h-3 w-3 text-background" /></button>
            </div>
          ) : (
            <button
              onClick={() => actionVideoRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleActionVideoDrop}
              className="flex-1 min-h-0 w-full rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex flex-col items-center justify-center gap-1"
            >
              <Clapperboard className="h-4 w-4 text-primary shrink-0" />
              <div className="text-center">
                <div className="text-sm font-medium text-primary">上传驱动视频</div>
                <div className="text-[11px] text-primary/60">mp4 / mov / webm · 最大 30s</div>
              </div>
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground shrink-0">💡 图片与视频中人物比例越接近，效果越好</p>

        {/* 隐藏文件输入 */}
        <input ref={actionImageRef} type="file" accept="image/jpeg,image/png" className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!isValidImageFile(f)) { toast.error(`文件「${f.name}」格式不支持，请上传 JPG / PNG 格式的图片`); e.target.value = ''; return }
            if (f.size > 4.7 * 1024 * 1024) { toast.error('人物图片不能超过 4.7 MB'); e.target.value = ''; return }
            const img = await readFrameFile(f, true)
            if (img) setActionImage(img)
            e.target.value = ''
          }}
        />
        <input ref={actionVideoRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!isValidVideoFile(f)) { toast.error(`文件「${f.name}」格式不支持，请上传 MP4 / MOV / WEBM 格式的视频`); e.target.value = ''; return }
            const url = URL.createObjectURL(f)
            const video = document.createElement('video')
            video.src = url
            video.onloadedmetadata = () => {
              const dur = video.duration
              URL.revokeObjectURL(url)
              if (dur > 30) { toast.error('驱动视频时长不能超过 30 秒'); return }
              setActionVideo({ file: f, previewUrl: URL.createObjectURL(f), duration: dur, name: f.name })
            }
            e.target.value = ''
          }}
        />

        {actionVideoPreviewOpen && actionVideo && (
          <Dialog open={actionVideoPreviewOpen} onOpenChange={setActionVideoPreviewOpen}>
            <DialogContent className="max-w-2xl p-2">
              <video src={actionVideo.previewUrl} controls autoPlay className="w-full rounded-lg max-h-[70vh]" />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Coins className="h-4 w-4 text-amber-500" />
          <span>{estimatedCredits}</span>
        </div>
        <Button variant="gradient" size="lg" className="gap-2 px-8"
          onClick={handleActionImitationGenerate}
          disabled={isDisabled || !actionImage || !actionVideo}
        >
          {isActionGenerating
            ? <><Loader2 className="h-4 w-4 animate-spin" />生成中...</>
            : <><Sparkles className="h-4 w-4" />生成</>}
        </Button>
      </div>
    </>
  )
}
