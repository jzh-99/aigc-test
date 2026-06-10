'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerate } from '@/hooks/use-generate'
import { useConfirm } from '@/hooks/use-confirm'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { ImagePlus, Search, Trash2, Sparkles, ChevronDown, Plus, Coins } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { getRequestErrorMessage } from '@/lib/api-client'
import { ReferenceImageUploadCompact } from '../reference-image-upload-compact'
import { CompanyAImagePicker } from '../company-a-image-picker'
import { cn, generateUUID } from '@/lib/utils'
import Image from 'next/image'
import { ImageParamsBar, ImageSettingsContent } from './image-params'
import { isValidImageFile } from '../shared/file-utils'
import { MAX_REF_IMAGES } from '../shared/constants'
import { getModelResolutions, getPriceByResolution } from '../shared/schema-utils'
import { useModels } from '@/hooks/use-models'
import { getMaxImageReferenceCount } from '@/lib/image-categories'
import { GenerationSettingsSheet } from '../generation-settings-sheet'

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
  const confirm = useConfirm()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { models: imageModels, isReady: imageModelsReady } = useModels('image', activeWorkspaceId)
  const currentImageModel = imageModels.find((m) => m.code === modelType)
  const maxReferenceImages = currentImageModel ? getMaxImageReferenceCount(currentImageModel) : MAX_REF_IMAGES
  const estimatedCredits = currentImageModel ? getPriceByResolution(currentImageModel, resolution) * quantity : 0

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
      const firstModel = imageModels[0].code
      setModelType(firstModel)
      // 同步重置为新模型的首个分辨率
      const resolutions = getModelResolutions(firstModel, imageModels)
      if (resolutions.length > 0) setResolution(resolutions[0] as typeof resolution)
    } else {
      // 模型有效，但当前 resolution 可能不在该模型支持列表中，自动修正
      const resolutions = getModelResolutions(modelType, imageModels)
      if (resolutions.length > 0 && !resolutions.includes(resolution)) {
        setResolution(resolutions[0] as typeof resolution)
      }
    }
  }, [imageModelsReady, imageModels, modelType, resolution, setModelType, setResolution])

  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [companyAPickerOpen, setCompanyAPickerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    let nextReferenceCount = referenceImages.length
    for (const file of Array.from(files)) {
      if (nextReferenceCount >= maxReferenceImages) {
        toast.error(`当前模型最多添加 ${maxReferenceImages} 张参考图`)
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
      nextReferenceCount += 1
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [referenceImages.length, maxReferenceImages, addReferenceImage])

  const handleSelectCompanyAImage = useCallback(async (url: string) => {
    if (referenceImages.length >= maxReferenceImages) {
      toast.error(`当前模型最多添加 ${maxReferenceImages} 张参考图`)
      return
    }
    addReferenceImage({ id: generateUUID(), previewUrl: url })
    toast.success('已添加参考图，提交时会自动加载原图')
  }, [referenceImages.length, maxReferenceImages, addReferenceImage])

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
      const ok = await confirm({
        title: '确认生成',
        description: `本次操作预计消耗 ${estimatedCredits} A豆（图片生成），确认是否继续？`,
        confirmText: '确认生成',
        destructive: false,
      })
      if (!ok) return
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
        className="flex flex-col gap-2.5 flex-1 min-h-0 relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none rounded-xl">
            <ImagePlus className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-primary">松开以添加参考图</span>
          </div>
        )}

        <div className={cn('flex flex-col gap-2.5 flex-1 min-h-0', isDragging && 'opacity-30 pointer-events-none')}>
          {/* 层1: 模型选择行 — 紧凑卡片 */}
          <Select
            value={modelType}
            onValueChange={(v) => {
              setModelType(v)
              // 切换模型时自动选中新模型的首个可用分辨率
              const resolutions = getModelResolutions(v, imageModels)
              if (resolutions.length > 0) {
                setResolution(resolutions[0] as typeof resolution)
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger className="bg-white/[0.05] rounded-[10px] px-3.5 py-2.5 border-0 h-auto hover:bg-white/[0.08] transition-colors [&>svg]:hidden">
              <div className="flex items-center gap-2.5 w-full">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[13px] font-semibold text-white">{currentImageModel?.name ?? modelType}</div>
                  {currentImageModel?.description && (
                    <div className="text-[11px] text-white/35 mt-0.5 truncate">{currentImageModel.description}</div>
                  )}
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-white/20 shrink-0" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {imageModels.map((m) => {
                const minPrice = m.params_pricing.length > 0
                  ? Math.min(...m.params_pricing.map((r) => r.unit_price))
                  : 0
                return (
                  <SelectItem key={m.code} value={m.code} className="py-2">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm mb-0.5">{m.name}</div>
                        {m.description && (
                          <div className="text-xs text-muted-foreground leading-snug">{m.description}</div>
                        )}
                        <div className="flex items-center gap-1 text-xs font-medium text-primary mt-0.5">
                          <Coins className="h-3 w-3" />{minPrice} A豆/张
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          {/* 层2: 上传区 */}
          {referenceImages.length > 0 ? (
            /* 有参考图时 — 缩略图堆叠 */
            <div
              onClick={() => setImageDialogOpen(true)}
              className="cursor-pointer group bg-white/[0.05] rounded-[12px] px-3.5 py-2.5 flex items-center gap-3 hover:bg-white/[0.08] transition-colors"
            >
              <div className="relative w-16 h-12 shrink-0">
                {referenceImages.slice(0, 3).map((img, index) => (
                  <div
                    key={img.id}
                    className="absolute rounded-lg border-2 border-background shadow-md overflow-hidden transition-transform group-hover:scale-105"
                    style={{ width: '44px', height: '44px', left: `${index * 14}px`, top: `${index * 3}px`, zIndex: 3 - index }}
                  >
                    <Image src={img.previewUrl} alt="" fill className="object-cover" sizes="44px" unoptimized />
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-white">{referenceImages.length} 张参考图</div>
                <div className="text-[11px] text-white/35">点击查看和管理</div>
              </div>
              {isCompanyA && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-[#818cf8] hover:bg-white/[0.08] transition-colors shrink-0"
                  title="从图库搜索添加"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); clearReferenceImages() }}
                className="h-7 w-7 rounded-md flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
                title="清空全部参考图"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            /* 无参考图时 — 虚线居中风格 */
            <div
              className="bg-white/[0.03] border-[1.5px] border-dashed border-white/[0.08] rounded-[14px] py-7 flex flex-col items-center justify-center cursor-pointer hover:border-white/[0.15] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-11 h-11 rounded-xl bg-white/[0.05] flex items-center justify-center mb-2">
                <Plus className="h-5 w-5 text-white/40" />
              </div>
              <div className="text-[13px] text-white/40">
                上传图片 或选择{' '}
                {isCompanyA ? (
                  <span
                    className="text-[#818cf8] cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                  >
                    历史资产
                  </span>
                ) : (
                  <span>参考图</span>
                )}
              </div>
              {isCompanyA && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCompanyAPickerOpen(true) }}
                  className="mt-2.5 flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#818cf8]/20 hover:bg-[#818cf8]/30 text-[#818cf8] text-[12px] font-medium transition-colors"
                >
                  <Search className="h-3.5 w-3.5" />图库搜索
                </button>
              )}
            </div>
          )}

          {/* 层3: 输入框 */}
          <div className="flex-1 min-h-0">
            <Textarea
              placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-full resize-none bg-white/[0.03] border-white/[0.06] text-white placeholder:text-white/25 focus-visible:ring-white/[0.1]"
              disabled={isGenerating || disabled}
            />
          </div>

          {/* 层4: 底部参数栏 + 生成按钮 */}
          <ImageParamsBar
            models={imageModels}
            modelType={modelType}
            resolution={resolution}
            aspectRatio={aspectRatio}
            quantity={quantity}
            isGenerating={isGenerating}
            disabled={disabled}
            promptEmpty={!prompt.trim()}
            onModelChange={(v) => {
              setModelType(v)
              const resolutions = getModelResolutions(v, imageModels)
              if (resolutions.length > 0) {
                setResolution(resolutions[0] as typeof resolution)
              }
            }}
            onResolutionChange={(v) => setResolution(v as typeof resolution)}
            onAspectRatioChange={setAspectRatio}
            onQuantityChange={setQuantity}
            onGenerate={handleGenerate}
            onSaveDefaults={handleSaveDefaults}
            onSettingsOpen={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      {/* 设置弹窗 */}
      <GenerationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} title="图片生成设置">
        <ImageSettingsContent
          models={imageModels}
          modelType={modelType}
          resolution={resolution}
          aspectRatio={aspectRatio}
          quantity={quantity}
          isGenerating={isGenerating}
          promptEmpty={!prompt.trim()}
          disabled={disabled}
          onModelChange={(v) => {
            setModelType(v)
            const resolutions = getModelResolutions(v, imageModels)
            if (resolutions.length > 0) {
              setResolution(resolutions[0] as typeof resolution)
            }
          }}
          onResolutionChange={(v) => setResolution(v as typeof resolution)}
          onAspectRatioChange={setAspectRatio}
          onQuantityChange={setQuantity}
          onGenerate={handleGenerate}
          onSaveDefaults={handleSaveDefaults}
        />
      </GenerationSettingsSheet>

      {/* 参考图管理弹窗 */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>参考图片管理</DialogTitle></DialogHeader>
          <div className="mt-4"><ReferenceImageUploadCompact expanded maxImages={maxReferenceImages} /></div>
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
