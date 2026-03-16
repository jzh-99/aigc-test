'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGenerationStore } from '@/stores/generation-store'
import { useGenerate } from '@/hooks/use-generate'
import { Sparkles, Loader2, Coins, Image as ImageIcon, Video, Zap, Target, Plus } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { ReferenceImageUploadCompact } from './reference-image-upload-compact'
import { cn } from '@/lib/utils'
import Image from 'next/image'

const MODEL_CREDITS: Record<'gemini' | 'nano-banana-pro', number> = {
  gemini: 5,
  'nano-banana-pro': 10,
}

const MODEL_OPTIONS = [
  {
    value: 'gemini',
    label: '全能图片2',
    icon: Zap,
    desc: '快速生成，适合日常使用',
    credits: 5
  },
  {
    value: 'nano-banana-pro',
    label: '全能图片Pro',
    icon: Target,
    desc: '高质量输出，细节丰富',
    credits: 10
  },
] as const

const RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
] as const

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const

const QUANTITY_OPTIONS = [1, 2, 3, 4, 5] as const

interface GenerationPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
}

export function GenerationPanel({ onBatchCreated, disabled }: GenerationPanelProps) {
  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [imageDialogOpen, setImageDialogOpen] = useState(false)

  const {
    prompt,
    setPrompt,
    modelType,
    setModelType,
    resolution,
    setResolution,
    quantity,
    setQuantity,
    aspectRatio,
    setAspectRatio,
    referenceImages,
    isGenerating
  } = useGenerationStore()

  const estimatedCredits = (MODEL_CREDITS[modelType] ?? 5) * quantity
  const { generate } = useGenerate()

  const handleGenerate = async () => {
    try {
      const batch = await generate()
      if (batch) {
        onBatchCreated(batch)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message)
      } else {
        toast.error('生成请求失败，请稍后重试')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating && !disabled) {
      handleGenerate()
    }
  }

  const currentModel = MODEL_OPTIONS.find(m => m.value === modelType)

  return (
    <div className="space-y-4">
      {/* 模式切换 - 极简 */}
      <div className="flex items-center justify-end">
        <div className="flex gap-1 p-0.5 bg-muted rounded-md">
          <button
            onClick={() => setMode('image')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all',
              mode === 'image'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ImageIcon className="h-3 w-3" />
            图片
          </button>
          <button
            onClick={() => setMode('video')}
            disabled
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-muted-foreground cursor-not-allowed opacity-40"
          >
            <Video className="h-3 w-3" />
            视频
          </button>
        </div>
      </div>

      {mode === 'image' ? (
        <>
          {/* 提示词 + 参考图 */}
          <div className="rounded-xl border bg-card p-5">
            <div className="space-y-4">
              {/* 添加参考图按钮 - 左上角 */}
              <div className="flex items-start justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setImageDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加参考图
                </Button>
                {referenceImages.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {referenceImages.length}/5
                  </span>
                )}
              </div>

              {/* 参考图堆叠预览 */}
              {referenceImages.length > 0 && (
                <div
                  onClick={() => setImageDialogOpen(true)}
                  className="cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    {/* 堆叠图片 - 左侧 */}
                    <div className="relative w-20 h-16 shrink-0">
                      {referenceImages.slice(0, 3).map((img, index) => (
                        <div
                          key={img.id}
                          className="absolute rounded-lg border-2 border-background shadow-md overflow-hidden transition-transform group-hover:scale-105"
                          style={{
                            width: '48px',
                            height: '48px',
                            left: `${index * 16}px`,
                            top: `${index * 4}px`,
                            zIndex: 3 - index,
                          }}
                        >
                          <Image
                            src={img.previewUrl}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="48px"
                            unoptimized
                          />
                        </div>
                      ))}
                    </div>

                    {/* 文字信息 - 右侧 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {referenceImages.length} 张参考图
                      </div>
                      <div className="text-xs text-muted-foreground">
                        点击查看和管理
                      </div>
                    </div>

                    <ImageIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                </div>
              )}

              {/* 提示词输入 */}
              <div>
                <Textarea
                  placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="min-h-[160px] resize-none"
                  disabled={isGenerating || disabled}
                />
              </div>
            </div>
          </div>

          {/* 生成配置 */}
          <div className="rounded-xl border bg-card p-5">
            <div className="space-y-4">
              {/* 模型选择 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">模型</Label>
                <Select
                  value={modelType}
                  onValueChange={(v) => setModelType(v as 'gemini' | 'nano-banana-pro')}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue>
                      {currentModel?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((model) => {
                      const Icon = model.icon
                      return (
                        <SelectItem key={model.value} value={model.value} className="py-3">
                          <div className="flex items-start gap-3">
                            <Icon className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm mb-0.5">{model.label}</div>
                              <div className="text-xs text-muted-foreground leading-relaxed">
                                {model.desc}
                              </div>
                              <div className="flex items-center gap-1 text-xs font-medium text-primary mt-1">
                                <Coins className="h-3 w-3" />
                                {model.credits} 积分/张
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* 质量 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">质量</Label>
                <div className="grid grid-cols-3 gap-2">
                  {RESOLUTION_OPTIONS.map((res) => (
                    <button
                      key={res.value}
                      onClick={() => setResolution(res.value)}
                      disabled={disabled}
                      className={cn(
                        'py-2 px-3 rounded-lg border-2 text-sm font-medium transition-all',
                        resolution === res.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                        disabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 画面比例 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">比例</Label>
                <div className="grid grid-cols-5 gap-2">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.value}
                      onClick={() => setAspectRatio(ar.value)}
                      disabled={disabled}
                      className={cn(
                        'flex flex-col items-center gap-1.5 py-2 px-1 rounded-lg border-2 transition-all',
                        aspectRatio === ar.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/50',
                        disabled && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="flex items-end justify-center h-4">
                        <AspectRatioIcon ratio={ar.value} active={aspectRatio === ar.value} />
                      </div>
                      <span className="text-xs font-medium">{ar.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center gap-3">
            {/* 数量选择 */}
            <Select
              value={String(quantity)}
              onValueChange={(v) => setQuantity(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-[100px] h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUANTITY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} 张
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* 积分显示 */}
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Coins className="h-4 w-4 text-amber-500" />
              <span>{estimatedCredits} 积分</span>
            </div>

            {/* 生成按钮 */}
            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8 ml-auto"
              onClick={handleGenerate}
              disabled={isGenerating || disabled || !prompt.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  生成
                </>
              )}
            </Button>
          </div>

          {/* 参考图管理对话框 */}
          <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>参考图片管理</DialogTitle>
              </DialogHeader>
              <div className="mt-4">
                <ReferenceImageUploadCompact expanded />
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="py-20 text-center text-muted-foreground">
          <Video className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">视频生成功能即将推出</p>
          <p className="text-sm">敬请期待...</p>
        </div>
      )}
    </div>
  )
}

function AspectRatioIcon({ ratio, active }: { ratio: string; active: boolean }) {
  const [w, h] = ratio.split(':').map(Number)
  const maxSize = 16
  const scale = maxSize / Math.max(w, h)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)

  return (
    <div
      className={cn(
        'rounded border-2',
        active ? 'border-primary bg-primary/20' : 'border-current opacity-40'
      )}
      style={{ width, height }}
    />
  )
}
