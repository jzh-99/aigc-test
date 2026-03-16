'use client'

import { useRef, useCallback } from 'react'
import Image from 'next/image'
import { useGenerationStore } from '@/stores/generation-store'
import { ImagePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export function ReferenceImageUpload() {
  const { referenceImages, addReferenceImage, removeReferenceImage } = useGenerationStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div className="grid grid-cols-4 gap-3">
      {/* 上传按钮 */}
      {referenceImages.length < MAX_IMAGES && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
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
            sizes="150px"
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
