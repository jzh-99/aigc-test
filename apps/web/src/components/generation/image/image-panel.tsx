'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, ImagePlus, Image as ImageIcon, Search } from 'lucide-react'
import { resolveMentionPrompt, syncMentionResourceLabels } from '@/components/shared/mention-editor'
import type { MentionResource } from '@/components/shared/mention-editor'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerate } from '@/hooks/use-generate'
import { useConfirm } from '@/hooks/use-confirm'
import type { BatchResponse } from '@aigc/types'
import type { ModelItem } from '@aigc/types'
import { toast } from 'sonner'
import { getRequestErrorMessage } from '@/lib/api-client'
import { CompanyAImagePicker } from '../company-a-image-picker'
import { cn, generateUUID } from '@/lib/utils'
import { ModelBrandIcon } from '../shared/model-brand-icon'
import { ImmersiveEditor } from '../shared/immersive-editor'
import type { MediaGridItem } from '../shared/media-grid-types'

import { ImageParams } from './image-params'
import { isValidImageFile } from '../shared/file-utils'
import { MAX_REF_IMAGES } from '../shared/constants'
import { getModelResolutions, getPriceByResolution } from '../shared/schema-utils'
import { useModels } from '@/hooks/use-models'
import { getMaxImageReferenceCount } from '@/lib/image-categories'

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
    referenceImages, addReferenceImage,
    isGenerating,
    setImageModels,
  } = useGenerationStore()

  const { generate } = useGenerate()
  const confirm = useConfirm()
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { models: imageModels, isReady: imageModelsReady } = useModels('image', activeWorkspaceId)
  const currentImageModel = imageModels.find((m) => m.code === modelType)
  const maxReferenceImages = currentImageModel ? getMaxImageReferenceCount(currentImageModel) : MAX_REF_IMAGES
  const estimatedCredits = currentImageModel ? getPriceByResolution(currentImageModel, resolution) * quantity : 0
  const previousMentionResourcesRef = useRef<MentionResource[] | null>(null)

  /** 将已上传的参考图映射为 @ 提及资源 */
  const mentionResources = useMemo<MentionResource[]>(() =>
    referenceImages.map((img, index) => ({
      id: img.id,
      mentionLabel: `图片${index + 1}`,
      sourceLabel: '参考图',
      kind: 'image',
    }))
  , [referenceImages])

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

  const [companyAPickerOpen, setCompanyAPickerOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const previousResources = previousMentionResourcesRef.current
    previousMentionResourcesRef.current = mentionResources
    if (!previousResources) return
    const nextPrompt = syncMentionResourceLabels(prompt, previousResources, mentionResources)
    if (nextPrompt !== prompt) setPrompt(nextPrompt)
  }, [mentionResources, prompt, setPrompt])

  /** 将参考图映射为缩略图网格条目 */
  const gridItems = useMemo<MediaGridItem[]>(() =>
    referenceImages.map((img, index) => ({
      id: img.id,
      kind: 'image' as const,
      previewUrl: img.previewUrl,
      label: `图片${index + 1}`,
    }))
  , [referenceImages])

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
      const resolvedPrompt = resolveMentionPrompt(prompt, mentionResources)
      const batch = await generate(resolvedPrompt)
      if (batch) onBatchCreated(batch)
    } catch (err) {
      toast.error(getRequestErrorMessage(err, '生成请求失败，请稍后重试'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating && !disabled) handleGenerate()
  }

  /** 删除单张参考图 */
  const handleRemoveReferenceImage = useCallback((id: string) => {
    useGenerationStore.setState((state) => ({
      referenceImages: state.referenceImages.filter((img) => img.id !== id),
    }))
  }, [])

  return (
    <>
      <ImageModelSelectorRow
        models={imageModels}
        modelType={modelType}
        isDisabled={isGenerating || !!disabled}
        onModelChange={(v) => {
          setModelType(v)
          const resolutions = getModelResolutions(v, imageModels)
          if (resolutions.length > 0) setResolution(resolutions[0] as typeof resolution)
        }}
      />

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
          {/* CompanyA 图库搜索按钮（在编辑器上方） */}
          {isCompanyA && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setCompanyAPickerOpen(true)}
                className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                图库搜索
              </button>
            </div>
          )}

          {/* 沉浸式编辑器（缩略图网格 + 文本输入） */}
          <ImmersiveEditor
            gridItems={gridItems}
            showAddButton={referenceImages.length < maxReferenceImages}
            onAddClick={() => fileInputRef.current?.click()}
            addButtonDisabled={isGenerating || disabled}
            onRemoveItem={handleRemoveReferenceImage}
            gridEmptyText={`点击或拖拽上传参考图 · 最多 ${maxReferenceImages} 张`}
            gridEmptyClassName="h-[88px] flex-col justify-center gap-2 text-center"
            gridEmptyIcon={ImagePlus}
            onGridEmptyClick={() => fileInputRef.current?.click()}
            editorValue={prompt}
            editorOnChange={setPrompt}
            editorResources={mentionResources}
            editorPlaceholder={'上传参考图、输入文字或 @ （紫色）参考内容，描述你想生成的图片。'}
            editorDisabled={isGenerating || disabled}
            editorMentionClassName={() =>
              'inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/12 px-1.5 py-0.5 font-semibold text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_12px_rgba(200,156,236,0.12)] align-baseline'
            }
            editorMentionIcon={() => ImageIcon}
            editorEmptyText="暂无可引用资源，请先上传参考图"
          />
        </div>
      </div>

      <ImageParams
        models={imageModels}
        modelType={modelType}
        resolution={resolution}
        aspectRatio={aspectRatio}
        quantity={quantity}
        isGenerating={isGenerating}
        disabled={disabled}
        promptEmpty={!prompt.trim()}
        onResolutionChange={(v) => setResolution(v as typeof resolution)}
        onAspectRatioChange={setAspectRatio}
        onQuantityChange={setQuantity}
        onGenerate={handleGenerate}
      />

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
        onChange={(e) => handleImageFiles(e.target.files)} />

      {isCompanyA && (
        <CompanyAImagePicker open={companyAPickerOpen} onOpenChange={setCompanyAPickerOpen} onSelectPoster={handleSelectCompanyAImage} />
      )}
    </>
  )
}

/** 图片模型选择器行 */
function ImageModelSelectorRow({
  models,
  modelType,
  isDisabled,
  onModelChange,
}: {
  models?: ModelItem[]
  modelType: string
  isDisabled: boolean
  onModelChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const currentModel = models?.find((m) => m.code === modelType)

  return (
    <div className="shrink-0 my-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border px-3 py-2 transition-colors text-left',
              open
                ? 'border-primary/40 bg-card'
                : 'border-border/60 bg-card hover:border-primary/30',
            )}
            disabled={isDisabled}
          >
            {/* 供应商图标 */}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 shrink-0">
              <ModelBrandIcon avatar={currentModel?.avatar} modelCode={currentModel?.code ?? modelType} size={40} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{currentModel?.name ?? modelType}</div>
              {currentModel?.description && (
                <div className="text-[11px] text-muted-foreground truncate">{currentModel.description}</div>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="z-[120] w-[var(--radix-popover-trigger-width)] rounded-xl border border-white/15 bg-card/40 p-1.5 shadow-2xl shadow-black/30 backdrop-blur-2xl ring-1 ring-white/10 animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">选择模型</div>
            {(models ?? []).map((m) => {
              const isActive = m.code === modelType
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => { onModelChange(m.code); setOpen(false) }}
                  disabled={isDisabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-popover-foreground hover:bg-muted',
                    isDisabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 shrink-0">
                    <ModelBrandIcon avatar={m.avatar} modelCode={m.code} size={32} />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.name}</span>
                    {m.description && (
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                        {m.description}
                      </span>
                    )}
                  </span>
                  {isActive && <Check className="h-3 w-3 shrink-0" />}
                </button>
              )
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
