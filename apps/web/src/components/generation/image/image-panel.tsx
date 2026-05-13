'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerate } from '@/hooks/use-generate'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { ImagePlus, Image as ImageIcon, Search, Trash2 } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { getRequestErrorMessage } from '@/lib/api-client'
import { ReferenceImageUploadCompact } from '../reference-image-upload-compact'
import { CompanyAImagePicker } from '../company-a-image-picker'
import { cn, generateUUID } from '@/lib/utils'
import Image from 'next/image'
import { ImageParams } from './image-params'
import { isValidImageFile } from '../shared/file-utils'
import { MAX_REF_IMAGES } from '../shared/constants'
import { useModels } from '@/hooks/use-models'

interface ImagePanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
  isCompanyA: boolean
}

export function ImagePanel({ onBatchCreated, disabled, isCompanyA }: ImagePanelProps) {
  const {
    prompt, setPrompt,
    modelType, setModelType,
    resolution, setResolution,
    quantity, setQuantity,
    aspectRatio, setAspectRatio,
    referenceImages, addReferenceImage, clearReferenceImages,
    watermark, isGenerating,
    saveAsDefaults, videoDefaults, avatarDefaults, userDefaults,
    setImageModels,
  } = useGenerationStore()

  const { save: saveDefaults } = useGenerationDefaults()
  const { generate } = useGenerate()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { models: imageModels, isReady: imageModelsReady } = useModels('image', activeWorkspaceId)

  // 模型列表加载完成后缓存到 store，供 use-generate 查 params_pricing
  useEffect(() => {
    if (imageModelsReady && imageModels.length > 0) {
      setImageModels(imageModels)
    }
  }, [imageModelsReady, imageModels, setImageModels])

  // 模型列表加载完成后，若当前选中的模型不在可用列表中，自动切换到第一个可用模型
  useEffect(() => {
    if (!imageModelsReady || imageModels.length === 0) return
    const isValid = imageModels.some((m) => m.code === modelType)
    if (!isValid) {
      setModelType(imageModels[0].code)
    }
  }, [imageModelsReady, imageModels, modelType, setModelType])

  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [companyAPickerOpen, setCompanyAPickerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (referenceImages.length >= MAX_REF_IMAGES) {
        toast.error(`最多添加 ${MAX_REF_IMAGES} 张参考图`)
        break
      }
      if (!isValidImageFile(file)) {
        toast.error(`文件「${file.name}」格式不支持，请上传 JPG / PNG / WEBP 格式的图片`)
        continue
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`图片「${file.name}」过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单张不超过 20 MB`)
        continue
      }
      addReferenceImage({ id: generateUUID(), file, previewUrl: URL.createObjectURL(file) })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [referenceImages.length, addReferenceImage])

  const handleSelectCompanyAImage = useCallback(async (url: string) => {
    if (referenceImages.length >= MAX_REF_IMAGES) {
      toast.error(`最多添加 ${MAX_REF_IMAGES} 张参考图`)
      return
    }
    addReferenceImage({ id: generateUUID(), previewUrl: url })
    toast.success('已添加参考图，提交时会自动加载原图')
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      await handleImageFiles(e.dataTransfer.files)
      return
    }
    const url = e.dataTransfer.getData('application/x-aigc-asset-url') || e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const type = e.dataTransfer.getData('application/x-aigc-asset-type')
    if (url) {
      if (type === 'video') {
        toast.error('当前参考区不支持视频参考，请切换到视频的全能参考或动作模仿视频区域')
        return
      }
      await handleSelectCompanyAImage(url)
    }
  }, [handleImageFiles, handleSelectCompanyAImage])

  const handleGenerate = async () => {
    try {
      const batch = await generate()
      if (batch) onBatchCreated(batch)
    } catch (err) {
      toast.error(getRequestErrorMessage(err, '生成请求失败，请稍后重试'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating && !disabled) handleGenerate()
  }

  const handleSaveDefaults = () => {
    saveAsDefaults()
    saveDefaults({ image: { modelType, resolution, aspectRatio, quantity, watermark }, video: videoDefaults ?? undefined, avatar: avatarDefaults ?? undefined })
    toast.success('已保存为默认参数')
  }

  return (
    <>
      <div
        className={cn(
          'border border-border bg-card p-4 flex-1 flex flex-col min-h-0 relative transition-colors',
          isCompanyA ? 'rounded-xl' : 'rounded-b-xl rounded-tr-xl',
          isDragging && 'border-primary bg-primary/5'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className={cn('absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none', isCompanyA ? 'rounded-xl' : 'rounded-b-xl rounded-tr-xl')}>
            <ImagePlus className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-primary">松开以添加参考图</span>
          </div>
        )}
        <div className={cn('flex flex-col flex-1 min-h-0 gap-2', isDragging && 'opacity-30 pointer-events-none')}>
          {/* 参考图区域 */}
          <div className={cn('shrink-0', isCompanyA ? 'h-[88px]' : 'h-[68px]')}>
            {referenceImages.length > 0 ? (
              <div onClick={() => setImageDialogOpen(true)} className="cursor-pointer group h-full">
                <div className="flex items-center gap-3 h-full">
                  <div className="relative w-16 h-14 shrink-0">
                    {referenceImages.slice(0, 3).map((img, index) => (
                      <div key={img.id} className="absolute rounded-lg border-2 border-background shadow-md overflow-hidden transition-transform group-hover:scale-105"
                        style={{ width: '44px', height: '44px', left: `${index * 14}px`, top: `${index * 3}px`, zIndex: 3 - index }}>
                        <Image src={img.previewUrl} alt="" fill className="object-cover" sizes="44px" unoptimized />
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{referenceImages.length} 张参考图</div>
                    <div className="text-xs text-muted-foreground">点击查看和管理</div>
                  </div>
                  <ImageIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  {isCompanyA && (
                    <button onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                      className="h-6 w-6 rounded-md flex items-center justify-center text-blue-500 hover:bg-blue-500/10 transition-colors shrink-0" title="从图库搜索添加">
                      <Search className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); clearReferenceImages() }}
                    className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0" title="清空全部参考图">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : isCompanyA ? (
              <div onClick={() => fileInputRef.current?.click()}
                className="h-full w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-3 px-3">
                <ImagePlus className="h-6 w-6 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-primary leading-tight">上传参考图</div>
                  <div className="text-[11px] text-primary/60 leading-tight mt-0.5">点击或拖拽 · 最多 {MAX_REF_IMAGES} 张</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-xs font-medium transition-colors mr-2">
                  <Search className="h-3.5 w-3.5" />图库搜索
                </button>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()}
                className="h-full w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-3 px-3">
                <ImagePlus className="h-6 w-6 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-primary leading-tight">上传参考图</div>
                  <div className="text-[11px] text-primary/60 leading-tight mt-0.5">最多 {MAX_REF_IMAGES} 张 · 支持拖拽</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            <Textarea
              placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-full resize-none"
              disabled={isGenerating || disabled}
            />
          </div>
        </div>
      </div>

      <ImageParams
        models={imageModels}
        modelsReady={imageModelsReady}
        modelType={modelType}
        resolution={resolution}
        aspectRatio={aspectRatio}
        quantity={quantity}
        isGenerating={isGenerating}
        disabled={disabled}
        onModelChange={(v) => setModelType(v)}
        onResolutionChange={(v) => setResolution(v as typeof resolution)}
        onAspectRatioChange={setAspectRatio}
        onQuantityChange={setQuantity}
        onGenerate={handleGenerate}
        onSaveDefaults={handleSaveDefaults}
      />

      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>参考图片管理</DialogTitle></DialogHeader>
          <div className="mt-4"><ReferenceImageUploadCompact expanded /></div>
        </DialogContent>
      </Dialog>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
        onChange={(e) => handleImageFiles(e.target.files)} />

      {isCompanyA && (
        <CompanyAImagePicker open={companyAPickerOpen} onOpenChange={setCompanyAPickerOpen} onSelectPoster={handleSelectCompanyAImage} />
      )}
    </>
  )
}
