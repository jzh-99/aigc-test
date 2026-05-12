'use client'

import { useState, useRef, useCallback } from 'react'
import { ImagePlus, X, Music, Play, Search } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import { cn, generateUUID } from '@/lib/utils'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import type { FrameImage, MediaPreview } from '../shared/types'
import { readFrameFile, isValidVideoFile, isValidAudioFile, fetchAssetFile, getDraggedAsset, isValidImageFile } from '../shared/file-utils'
import { MAX_MULTIMODAL_IMAGES, MAX_MULTIMODAL_VIDEOS, MAX_MULTIMODAL_AUDIOS, SEEDANCE_MAX_TOTAL_VIDEO_DURATION } from '../shared/constants'

export interface MultimodalAudio {
  id: string
  name: string
  previewUrl: string
  file: File
  duration: number
}

export interface MultimodalVideo {
  id: string
  name: string
  previewUrl: string
  file: File
  duration: number
}

interface VideoMultimodalZoneProps {
  images: FrameImage[]
  videos: MultimodalVideo[]
  audios: MultimodalAudio[]
  isSeedance: boolean
  onImagesChange: (imgs: FrameImage[]) => void
  onVideosChange: (vids: MultimodalVideo[]) => void
  onAudiosChange: (auds: MultimodalAudio[]) => void
}

export function VideoMultimodalZone({
  images, videos, audios, isSeedance,
  onImagesChange, onVideosChange, onAudiosChange,
}: VideoMultimodalZoneProps) {
  const [managerOpen, setManagerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null)
  const dragCounterRef = useRef(0)

  const allInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const totalCount = images.length + videos.length + audios.length
  const stackPreviews = [
    ...images.map(i => ({ id: i.id ?? '', type: 'image' as const, previewUrl: i.previewUrl })),
    ...videos.map(v => ({ id: v.id, type: 'video' as const, previewUrl: v.previewUrl })),
    ...audios.map(a => ({ id: a.id, type: 'audio' as const, previewUrl: '' })),
  ].slice(0, 3)

  const validateAndAddVideo = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.src = url
    el.onloadedmetadata = () => {
      const dur = el.duration
      URL.revokeObjectURL(url)
      const pixels = (el.videoWidth || 1280) * (el.videoHeight || 720)
      if (pixels > 927408) {
        toast.error(isSeedance ? '视频分辨率过高，请上传 720p 及以下的视频' : '视频分辨率过高，请上传 720p 及以下的视频')
        return
      }
      if (isSeedance) {
        const totalDur = videos.reduce((s, v) => s + v.duration, 0)
        if (totalDur + dur > SEEDANCE_MAX_TOTAL_VIDEO_DURATION) {
          toast.error(`所有参考视频总时长不能超过 ${SEEDANCE_MAX_TOTAL_VIDEO_DURATION} 秒`)
          return
        }
      }
      const previewUrl = URL.createObjectURL(file)
      onVideosChange([...videos, { id: generateUUID(), name: file.name, previewUrl, file, duration: dur }])
    }
  }, [videos, isSeedance, onVideosChange])

  const validateAndAddAudio = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    el.src = url
    el.onloadedmetadata = () => {
      const dur = el.duration
      URL.revokeObjectURL(url)
      const previewUrl = URL.createObjectURL(file)
      onAudiosChange([...audios, { id: generateUUID(), name: file.name, previewUrl, file, duration: dur }])
    }
  }, [audios, onAudiosChange])

  const handleAllFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (isValidImageFile(file)) {
        if (images.length >= MAX_MULTIMODAL_IMAGES) { toast.error(`最多添加 ${MAX_MULTIMODAL_IMAGES} 张参考图`); continue }
        const img = await readFrameFile(file)
        if (img) onImagesChange([...images, img])
      } else if (isValidVideoFile(file)) {
        if (videos.length >= MAX_MULTIMODAL_VIDEOS) { toast.error(`最多添加 ${MAX_MULTIMODAL_VIDEOS} 个参考视频`); continue }
        validateAndAddVideo(file)
      } else if (isValidAudioFile(file)) {
        if (audios.length >= MAX_MULTIMODAL_AUDIOS) { toast.error(`最多添加 ${MAX_MULTIMODAL_AUDIOS} 个参考音频`); continue }
        validateAndAddAudio(file)
      } else {
        toast.error(`文件「${file.name}」格式不支持`)
      }
    }
    if (allInputRef.current) allInputRef.current.value = ''
  }, [images, videos, audios, onImagesChange, validateAndAddVideo, validateAndAddAudio])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) { await handleAllFiles(e.dataTransfer.files); return }
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'asset')
      if (isValidVideoFile(file)) {
        if (videos.length >= MAX_MULTIMODAL_VIDEOS) { toast.error(`最多添加 ${MAX_MULTIMODAL_VIDEOS} 个参考视频`); return }
        validateAndAddVideo(file)
      } else if (isValidImageFile(file)) {
        if (images.length >= MAX_MULTIMODAL_IMAGES) { toast.error(`最多添加 ${MAX_MULTIMODAL_IMAGES} 张参考图`); return }
        const img = await readFrameFile(file, true)
        if (img) onImagesChange([...images, img])
      }
    } catch { toast.error('素材加载失败，请确认网络可访问素材服务器') }
  }, [handleAllFiles, videos, images, onImagesChange, validateAndAddVideo])

  return (
    <div
      className={cn('shrink-0 relative transition-colors', isDragging && 'opacity-50')}
      onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; if (dragCounterRef.current === 1) setIsDragging(true) }}
      onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none rounded-xl border-2 border-primary bg-primary/5">
          <ImagePlus className="h-8 w-8 text-primary" />
          <span className="text-sm font-medium text-primary">松开以添加素材</span>
        </div>
      )}

      {totalCount > 0 ? (
        <div className="flex items-center gap-3 h-[90px]">
          <div className="relative w-20 h-[70px] shrink-0 cursor-pointer group" onClick={() => setManagerOpen(true)}>
            {stackPreviews.map((item, i) => (
              <div key={item.id} className="absolute rounded-lg border-2 border-background shadow-md overflow-hidden transition-transform group-hover:scale-105 bg-muted"
                style={{ width: 48, height: 48, left: i * 13, top: i * 4, zIndex: 3 - i }}>
                {item.type === 'image' && <Image src={item.previewUrl} alt="" fill className="object-cover" sizes="48px" unoptimized />}
                {item.type === 'video' && <video src={item.previewUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="metadata" onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }} />}
                {item.type === 'audio' && <div className="absolute inset-0 flex items-center justify-center bg-primary/10"><Music className="h-5 w-5 text-primary" /></div>}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{totalCount} 个素材</div>
            <div className="text-xs text-muted-foreground mt-0.5 space-x-1.5">
              {images.length > 0 && <span>{images.length} 图</span>}
              {videos.length > 0 && <span>{videos.length} 视频</span>}
              {audios.length > 0 && <span>{audios.length} 音频</span>}
            </div>
            <button onClick={() => setManagerOpen(true)} className="mt-1 text-xs text-primary hover:underline">点击管理素材</button>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={() => allInputRef.current?.click()} className="h-7 px-2.5 rounded-md border text-xs font-medium hover:bg-muted transition-colors">添加</button>
            <button onClick={() => { onImagesChange([]); onVideosChange([]); onAudiosChange([]) }}
              className="h-7 px-2.5 rounded-md border text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors">清空</button>
          </div>
        </div>
      ) : (
        <div onClick={() => allInputRef.current?.click()}
          className="h-[90px] w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-3 px-4">
          <ImagePlus className="h-6 w-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-primary leading-tight">上传素材</div>
            <div className="text-[11px] text-primary/60 leading-tight mt-0.5">图片 / 音频 / 视频（最高支持 720p）</div>
          </div>
        </div>
      )}

      {/* 统一素材 input */}
      <input ref={allInputRef} type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a"
        multiple className="hidden" onChange={(e) => handleAllFiles(e.target.files)} />
      <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
        onChange={(e) => handleAllFiles(e.target.files)} />
      <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" multiple className="hidden"
        onChange={(e) => { const files = e.target.files; if (!files) return; for (const f of Array.from(files)) { if (videos.length >= MAX_MULTIMODAL_VIDEOS) { toast.error('最多添加 3 个参考视频'); break } if (!isValidVideoFile(f)) { toast.error(`文件「${f.name}」格式不支持`); continue } validateAndAddVideo(f) } e.target.value = '' }} />
      <input ref={audioInputRef} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a" multiple className="hidden"
        onChange={(e) => { const files = e.target.files; if (!files) return; for (const f of Array.from(files)) { if (audios.length >= MAX_MULTIMODAL_AUDIOS) { toast.error('最多添加 3 个参考音频'); break } if (!isValidAudioFile(f)) { toast.error(`文件「${f.name}」格式不支持`); continue } validateAndAddAudio(f) } e.target.value = '' }} />

      {/* 素材管理弹窗 */}
      {managerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setManagerOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">素材管理</span>
                <span className="text-xs text-muted-foreground">{totalCount} 个</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => allInputRef.current?.click()} className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">继续添加</button>
                <button onClick={() => setManagerOpen(false)} className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-3 divide-x divide-border">
                {/* 图片栏 */}
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">图片 {images.length}/9</span>
                    {images.length > 0 && <button onClick={() => onImagesChange([])} className="text-[10px] text-destructive hover:underline">清空</button>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {images.map((img, idx) => (
                      <div key={img.id ?? idx} className="relative aspect-square rounded-lg overflow-hidden border bg-muted group cursor-zoom-in"
                        onClick={() => setMediaPreview({ type: 'image', url: img.previewUrl, name: img.id ?? `图片${idx + 1}`, index: idx, total: images.length })}>
                        <Image src={img.previewUrl} alt="" fill className="object-cover" sizes="120px" unoptimized />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <Search className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onImagesChange(images.filter((_, i) => i !== idx)) }}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <X className="h-3 w-3 text-background" />
                        </button>
                      </div>
                    ))}
                    {images.length < MAX_MULTIMODAL_IMAGES && (
                      <button onClick={() => imageInputRef.current?.click()}
                        className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1">
                        <ImagePlus className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">添加</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 视频栏 */}
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">视频 {videos.length}/3</span>
                    {videos.length > 0 && <button onClick={() => onVideosChange([])} className="text-[10px] text-destructive hover:underline">清空</button>}
                  </div>
                  <div className="flex flex-col gap-2">
                    {videos.map((v, idx) => (
                      <div key={v.id} className="relative rounded-lg overflow-hidden border bg-black group cursor-pointer aspect-video"
                        onClick={() => setMediaPreview({ type: 'video', url: v.previewUrl, name: v.name })}>
                        <video src={v.previewUrl} className="absolute inset-0 w-full h-full object-cover" muted playsInline preload="metadata" onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }} />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                          <div className="h-9 w-9 rounded-full bg-white/80 group-hover:bg-white flex items-center justify-center transition-colors shadow">
                            <Play className="h-4 w-4 text-black ml-0.5" />
                          </div>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                          <span className="text-[10px] text-white truncate block">{v.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onVideosChange(videos.filter((_, i) => i !== idx)) }}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <X className="h-3 w-3 text-background" />
                        </button>
                      </div>
                    ))}
                    {videos.length < MAX_MULTIMODAL_VIDEOS && (
                      <button onClick={() => videoInputRef.current?.click()}
                        className="h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1">
                        <Play className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">添加视频</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 音频栏 */}
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">音频 {audios.length}/3</span>
                    {audios.length > 0 && <button onClick={() => onAudiosChange([])} className="text-[10px] text-destructive hover:underline">清空</button>}
                  </div>
                  <div className="flex flex-col gap-3">
                    {audios.map((a, idx) => (
                      <div key={a.id} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border bg-muted/50 group">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0"><Music className="h-4 w-4 text-primary" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{a.name}</p>
                            <p className="text-[10px] text-muted-foreground">{a.duration.toFixed(1)}s</p>
                          </div>
                          <button onClick={() => onAudiosChange(audios.filter((_, i) => i !== idx))}
                            className="h-5 w-5 rounded-full hover:bg-foreground/10 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <audio src={a.previewUrl} controls className="w-full h-7" style={{ accentColor: 'hsl(var(--primary))' }} />
                      </div>
                    ))}
                    {audios.length < MAX_MULTIMODAL_AUDIOS && (
                      <button onClick={() => audioInputRef.current?.click()}
                        className="h-12 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1">
                        <Music className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">添加音频</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 图片全屏预览 */}
            {mediaPreview?.type === 'image' && (
              <ImageLightbox
                url={mediaPreview.url} alt={mediaPreview.name}
                onClose={() => setMediaPreview(null)}
                onPrev={mediaPreview.index > 0 ? () => { const prev = images[mediaPreview.index - 1]; setMediaPreview({ type: 'image', url: prev.previewUrl, name: prev.id ?? `图片${mediaPreview.index}`, index: mediaPreview.index - 1, total: mediaPreview.total }) } : undefined}
                onNext={mediaPreview.index < mediaPreview.total - 1 ? () => { const next = images[mediaPreview.index + 1]; setMediaPreview({ type: 'image', url: next.previewUrl, name: next.id ?? `图片${mediaPreview.index + 2}`, index: mediaPreview.index + 1, total: mediaPreview.total }) } : undefined}
                footer={<p className="text-sm text-white/80">{mediaPreview.index + 1} / {mediaPreview.total}</p>}
              />
            )}

            {/* 视频全屏播放 */}
            {mediaPreview?.type === 'video' && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/80" onClick={() => setMediaPreview(null)}>
                <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <p className="text-sm text-white/80 truncate">{mediaPreview.name}</p>
                    <button onClick={() => setMediaPreview(null)} className="h-7 w-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"><X className="h-4 w-4 text-white" /></button>
                  </div>
                  <video src={mediaPreview.url} controls autoPlay className="w-full rounded-xl max-h-[70vh] bg-black" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
