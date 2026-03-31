'use client'

import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGenerationStore } from '@/stores/generation-store'
import { useGenerate } from '@/hooks/use-generate'
import { Sparkles, Loader2, Coins } from 'lucide-react'
import type { BatchResponse } from '@aigc/types'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'

const MODEL_CREDITS: Record<'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0', number> = {
  gemini: 5,
  'nano-banana-pro': 10,
  'seedream-5.0-lite': 50,
  'seedream-4.5': 50,
  'seedream-4.0': 50,
}

interface PromptInputProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
}

export function PromptInput({ onBatchCreated, disabled }: PromptInputProps) {
  const { prompt, setPrompt, modelType, setModelType, resolution, setResolution, quantity, setQuantity, isGenerating } = useGenerationStore()
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
      <div>
        <Textarea
          placeholder="描述你想要生成的图片...（Ctrl+Enter 发送）"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[120px] resize-none"
          disabled={isGenerating || disabled}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={modelType} onValueChange={(v) => setModelType(v as 'gemini' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0')} disabled={disabled}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="模型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">全能图片2</SelectItem>
            <SelectItem value="nano-banana-pro">全能图片Pro</SelectItem>
            <SelectItem value="seedream-5.0-lite">Seedream 5.0</SelectItem>
            <SelectItem value="seedream-4.5">Seedream 4.5</SelectItem>
            <SelectItem value="seedream-4.0">Seedream 4.0</SelectItem>
          </SelectContent>
        </Select>

        <Select value={resolution} onValueChange={(v) => setResolution(v as '1k' | '2k' | '4k')} disabled={disabled}>
          <SelectTrigger className="w-[90px]">
            <SelectValue placeholder="分辨率" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1k">1K</SelectItem>
            <SelectItem value="2k">2K</SelectItem>
            <SelectItem value="4k">4K</SelectItem>
          </SelectContent>
        </Select>

        <Select value={String(quantity)} onValueChange={(v) => setQuantity(Number(v))} disabled={disabled}>
          <SelectTrigger className="w-[100px]">
            <SelectValue placeholder="数量" />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} 张
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Coins className="h-4 w-4 text-accent-orange" />
            <span>{estimatedCredits} 积分</span>
          </div>
          <Button
            variant="gradient"
            className="gap-2"
            onClick={handleGenerate}
            disabled={isGenerating || disabled || !prompt.trim()}
          >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {isGenerating ? '生成中...' : '生成'}
          </Button>
        </div>
      </div>
    </div>
  )
}
