'use client'

import { useState, useRef, useCallback } from 'react'
import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { toast } from 'sonner'
import { cn, generateUUID } from '@/lib/utils'
import type { FrameImage } from '../shared/types'
import { readFrameFile, fetchAssetFile, getDraggedAsset, isValidImageFile } from '../shared/file-utils'

interface VideoComponentsZoneProps {
  referenceImages: FrameImage[]
  previewIndex: number | null
  onImagesChange: (imgs: FrameImage[]) => void
  onPreviewIndexChange: (idx: number | null) => void
}

const MAX_COMPONENT_IMAGES = 3

export function VideoComponentsZone({ referenceImages, previewIndex, onImagesChange, onPreviewIndexChange }: VideoComponentsZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    const newImages: FrameImage[] = []
    for (const file of Array.from(files)) {
      if (referenceImages.length + newImages.length >= MAX_COMPONENT_IMAGES) {
        toast.error(`最多添加 ${MAX_COMPONENT_IMAGES} 张参考图`)
        break
      }
      const img = await readFrameFile(file)
      if (img) newImages.push(img)
    }
    onImagesChange([...referenceImages, ...newImages])
    if (inputRef.current) inputRef.current.value = ''
  }, [referenceImages, onImagesChange])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) { await handleFiles(e.dataTransfer.files); return }
    const asset = getDraggedAsset(e.dataTransfer)
    if (!asset.url) return
    const looksLikeImage = asset.type === 'image' || !asset.type
    if (looksLikeImage) {
      if (referenceImages.length >= MAX_COMPONENT_IMAGES) { toast.error('最多添加 3 张参考图'); return }
      onImagesChange([...referenceImages, { id: generateUUID(), previewUrl: asset.url, dataUrl: asset.url }])
      return
    }
    try {
      const file = await fetchAssetFile(asset.url, asset.type, 'asset')
      if (isValidImageFile(file)) {
        const img = await readFrameFile(file)
        if (img && referenceImages.length < MAX_COMPONENT_IMAGES) onImagesChange([...referenceImages, img])
        return
      }
      toast.error('当前参考区只支持图片参考')
    } catch { toast.error('图片加载失败，请确认网络可访问图片服务器') }
  }, [handleFiles, referenceImages, onImagesChange])

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
          <span className="text-sm font-medium text-primary">松开以添加参考图</span>
        </div>
      )}

      {referenceImages.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">{referenceImages.length}/3 张参考图</p>
            <button onClick={() => onImagesChange([])} className="text-[11px] text-destructive hover:underline">清空全部</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {referenceImages.map((img, index) => (
              <div key={img.id ?? index} className="relative h-[90px] w-[90px] rounded-lg overflow-hidden border bg-muted group cursor-zoom-in"
                onClick={() => onPreviewIndexChange(index)}>
                <Image src={img.previewUrl} alt="" fill className="object-cover" sizes="90px" unoptimized />
                <button
                  onClick={(e) => { e.stopPropagation(); onImagesChange(referenceImages.filter((_, i) => i !== index)) }}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                ><X className="h-3 w-3 text-background" /></button>
              </div>
            ))}
            {referenceImages.length < MAX_COMPONENT_IMAGES && (
              <button onClick={() => inputRef.current?.click()}
                className="h-[90px] w-[90px] rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1">
                <ImagePlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">添加</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()}
          className="h-[90px] w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-3 px-4">
          <ImagePlus className="h-6 w-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-primary leading-tight">上传参考图片</div>
            <div className="text-[11px] text-primary/60 leading-tight mt-0.5">1-3张 · 支持拖拽</div>
          </div>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
        onChange={(e) => handleFiles(e.target.files)} />

      {previewIndex !== null && referenceImages[previewIndex] && (
        <ImageLightbox
          url={referenceImages[previewIndex].previewUrl}
          alt={`参考图 ${previewIndex + 1}`}
          onClose={() => onPreviewIndexChange(null)}
          onPrev={previewIndex > 0 ? () => onPreviewIndexChange(previewIndex - 1) : undefined}
          onNext={previewIndex < referenceImages.length - 1 ? () => onPreviewIndexChange(previewIndex + 1) : undefined}
          footer={<p className="text-sm text-white/80">参考图 {previewIndex + 1}/{referenceImages.length}</p>}
        />
      )}
    </div>
  )
}
