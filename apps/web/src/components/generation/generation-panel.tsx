'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useGenerationStore } from '@/stores/generation-store'
import { useGenerate } from '@/hooks/use-generate'
import { Sparkles, Loader2, Coins, Image as ImageIcon, Video, Zap, Target } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { ReferenceImageUpload } from './reference-image-upload'
import { cn } from '@/lib/utils'

const MODEL_CREDITS: Record<'gemini' | 'nano-banana-pro', number> = {
  gemini: 5,
  'nano-banana-pro': 10,
}

const MODEL_OPTIONS = [
  { value: 'gemini', label: '全能图片2', icon: Zap, desc: '快速生成，适合日常使用', credits: 5 },
  { value: 'nano-banana-pro', label: '全能图片Pro', icon: Target, desc: '高质量输出，细节丰富', credits: 10 },
] as const

const RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K', desc: '512px' },
  { value: '2k', label: '2K', desc: '1024px' },
  { value: '4k', label: '4K', desc: '2048px' },
] as const

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1', desc: '正方形' },
  { value: '4:3', label: '4:3', desc: '横向' },
  { value: '3:4', label: '3:4', desc: '纵向' },
  { value: '16:9', label: '16:9', desc: '宽屏' },
  { value: '9:16', label: '9:16', desc: '竖屏' },
] as const

const QUANTITY_OPTIONS = [1, 2, 3, 4, 5] as const

interface GenerationPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
}

export function GenerationPanel({ onBatchCreated, disabled }: GenerationPanelProps) {
  const [mode, setMode] = useState<'image' | 'video'>('image')
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

  return (
    <div className="space-y-4">
      {/* 模式切换 */}
      <div className="flex gap-2 p-1 bg-muted rounded-lg">
        <button
          onClick={() => setMode('image')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md transition-all',
            mode === 'image'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <ImageIcon className="h-4 w-4" />
          <span className="font-medium">图片生成</span>
        </button>
        <button
          onClick={() => setMode('video')}
          disabled
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-muted-foreground cursor-not-allowed opacity-50"
        >
          <Video className="h-4 w-4" />
          <span>视频生成</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted-foreground/10">即将推出</span>
        </button>
      </div>

      {mode === 'image' ? (
        <>
          {/* 参考图片上传 */}
          <div>
            <Label className="text-sm font-medium mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              参考图片
            </Label>
            <ReferenceImageUpload />
            <p className="text-xs text-muted-foreground mt-2">
              支持 JPG/PNG • 最多5张 • 单张不超过10MB
            </p>
          </div>

          {/* 提示词 */}
          <div>
            <Label className="text-sm font-medium mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              描述你的创意
            </Label>
            <Textarea
              placeholder="描述你想要生成的图片...（Ctrl+Enter 发送）"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[100px] resize-none"
              disabled={isGenerating || disabled}
            />
            <p className="text-xs text-muted-foreground mt-2">
              💡 试试: 赛博朋克城市、霓虹灯、未来感
            </p>
          </div>

          {/* 生成设置 */}
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              {/* 模型选择 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">模型</Label>
                <Select
                  value={modelType}
                  onValueChange={(v) => setModelType(v as 'gemini' | 'nano-banana-pro')}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-auto py-2.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((model) => {
                      const Icon = model.icon
                      return (
                        <SelectItem key={model.value} value={model.value}>
                          <div className="flex items-center gap-2 py-1">
                            <Icon className="h-4 w-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">{model.label}</div>
                              <div className="text-xs text-muted-foreground">{model.desc}</div>
                            </div>
                            <div className="flex items-center gap-1 text-xs font-medium shrink-0">
                              <Coins className="h-3 w-3" />
                              {model.credits}
                            </div>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* 数量选择 */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">数量</Label>
                <Select
                  value={String(quantity)}
                  onValueChange={(v) => setQuantity(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger>
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
              </div>
            </div>

            {/* 质量选择 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">质量</Label>
              <div className="grid grid-cols-3 gap-2">
                {RESOLUTION_OPTIONS.map((res) => (
                  <button
                    key={res.value}
                    onClick={() => setResolution(res.value)}
                    disabled={disabled}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 px-3 rounded-lg border-2 transition-all',
                      resolution === res.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="font-semibold text-sm">{res.label}</div>
                    <div className="text-xs opacity-70">{res.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 画面比例 */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">画面比例</Label>
              <div className="grid grid-cols-5 gap-2">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.value}
                    onClick={() => setAspectRatio(ar.value)}
                    disabled={disabled}
                    className={cn(
                      'flex flex-col items-center gap-1.5 py-2 px-2 rounded-lg border-2 transition-all',
                      aspectRatio === ar.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <AspectRatioIcon ratio={ar.value} active={aspectRatio === ar.value} />
                    <span className="text-xs font-medium">{ar.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 生成按钮 */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-sm">
              <Coins className="h-4 w-4 text-amber-500" />
              <span className="font-medium">{estimatedCredits} 积分</span>
            </div>
            <Button
              variant="gradient"
              size="lg"
              className="gap-2 px-8"
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
        </>
      ) : (
        <div className="py-12 text-center text-muted-foreground">
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
  const maxSize = 20
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
