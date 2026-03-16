'use client'

import { useRef, useCallback, useState } from 'react'
import Image from 'next/image'
import { useGenerationStore } from '@/stores/generation-store'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const MAX_IMAGES = 5
const MAX_SIZE_MB = 10

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

interface ReferenceImageUploadCompactProps {
  expanded?: boolean
}

export function ReferenceImageUploadCompact({ expanded = false }: ReferenceImageUploadCompactProps) {
  const { referenceImages, addReferenceImage, removeReferenceImage, clearReferenceImages } = useGenerationStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (referenceImages.length >= MAX_IMAGES) break
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_SIZE_MB * 1024 * 1024) continue

      const dataUrl = await fileToDataUrl(file)
      addReferenceImage({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        dataUrl,
      })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [referenceImages.length, addReferenceImage])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    await handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  if (expanded) {
    return (
      <div
        className={cn(
          'relative rounded-xl transition-colors',
          isDragging && 'bg-primary/5'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* 拖拽遮罩 */}
        {isDragging && (
          <div className="absolute inset-0 rounded-xl z-10 border-2 border-dashed border-primary flex flex-col items-center justify-center gap-2 pointer-events-none bg-primary/5">
            <ImagePlus className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-primary">松开以添加参考图</span>
          </div>
        )}

        <div className={cn('grid grid-cols-4 gap-3 mb-4', isDragging && 'opacity-30')}>
          {/* 上传按钮格 */}
          {referenceImages.length < MAX_IMAGES && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'aspect-square rounded-xl border-2 border-dashed transition-all cursor-pointer',
                'border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50',
                'flex flex-col items-center justify-center gap-2'
              )}
            >
              <ImagePlus className="h-8 w-8 text-primary" />
              <span className="text-sm font-medium text-primary">上传</span>
            </div>
          )}

          {/* 已上传图片预览 */}
          {referenceImages.map((img) => (
            <div
              key={img.id}
              className="relative aspect-square rounded-xl overflow-hidden border-2 border-border group"
            >
              <Image
                src={img.previewUrl}
                alt="参考图"
                fill
                className="object-cover"
                sizes="200px"
                unoptimized
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
              <button
                onClick={() => removeReferenceImage(img.id)}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className={cn('flex items-center justify-between', isDragging && 'opacity-30')}>
          <p className="text-xs text-muted-foreground">
            支持 JPG / PNG · 最多 {MAX_IMAGES} 张 · 单张不超过 {MAX_SIZE_MB}MB · 可直接拖拽到此处
          </p>
          {referenceImages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 ml-3"
              onClick={clearReferenceImages}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空全部
            </Button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    )
  }

  // 紧凑模式 - 在提示词框内显示（保留备用）
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImagePlus className="h-3.5 w-3.5" />
        添加参考图
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  )
}
