'use client'

import { motion } from 'framer-motion'
import { ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PictureBookElement } from '@/lib/picture-book/types'

interface AssetCardProps {
  item: PictureBookElement
  index: number
  kind: 'character' | 'background'
  aspectClass: string
  isGenerating: boolean
  isFailed: boolean
  locked: boolean
  loading?: boolean
  onUpdateName: (name: string) => void
  onUpdatePrompt: (prompt: string) => void
  onGenerate: () => void
  onPreview: (url: string) => void
}

const STATUS_CONFIG = {
  generated: {
    label: '已生成',
    dotClass: 'bg-success',
    glowClass: 'shadow-[0_0_6px_rgba(93,206,168,0.6)]',
  },
  generating: {
    label: '生成中',
    dotClass: 'bg-accent-orange',
    glowClass: 'shadow-[0_0_6px_rgba(245,169,98,0.6)] animate-pulse',
  },
  failed: {
    label: '失败',
    dotClass: 'bg-error',
    glowClass: 'shadow-[0_0_6px_rgba(240,112,128,0.6)]',
  },
  idle: {
    label: '待生成',
    dotClass: 'bg-muted-foreground/40',
    glowClass: '',
  },
} as const

function getStatus(item: PictureBookElement, isGenerating: boolean, isFailed: boolean) {
  if (isGenerating) return STATUS_CONFIG.generating
  if (isFailed) return STATUS_CONFIG.failed
  if (item.imageUrl) return STATUS_CONFIG.generated
  return STATUS_CONFIG.idle
}

export function AssetCard({
  item,
  index,
  kind,
  aspectClass,
  isGenerating,
  isFailed,
  locked,
  loading,
  onUpdateName,
  onUpdatePrompt,
  onGenerate,
  onPreview,
}: AssetCardProps): React.ReactElement {
  const status = getStatus(item, isGenerating, isFailed)
  const isCharacter = kind === 'character'

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, rotateX: 4 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.45, delay: index * 0.08, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.25 } }}
      className="group relative"
    >
      {/* 多层纸张阴影 */}
      <div className="absolute inset-0 translate-y-1 rounded-2xl bg-accent-purple/8 blur-sm transition-all duration-300 group-hover:translate-y-2 group-hover:blur-md" />
      <div className="absolute inset-0 translate-y-0.5 rounded-2xl bg-accent-orange/6 transition-all duration-300 group-hover:translate-y-1" />

      {/* 卡片主体 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/20 p-5 backdrop-blur-sm transition-all duration-300 group-hover:border-accent-purple/30 group-hover:shadow-lg">
        {/* 装饰性背景纹理 */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent-orange/5 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-accent-blue/5 blur-xl" />

        <div className="flex flex-col gap-5">
          {/* 图片区域 */}
          <div className="relative w-full">
            <div className={`
              relative overflow-hidden
              ${aspectClass} rounded-xl ring-1 ring-border/40
              bg-gradient-to-br from-muted/80 to-muted/40
              transition-all duration-300
              group-hover:ring-accent-purple/40
            `}>
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full cursor-pointer object-cover transition-transform duration-500 group-hover:scale-105"
                  onClick={() => onPreview(item.imageUrl!)}
                />
              ) : isGenerating ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <div className="relative">
                    <Loader2 className="h-6 w-6 animate-spin text-accent-orange" />
                    <Sparkles className="absolute -right-1 -top-1 h-3 w-3 animate-pulse text-accent-purple" />
                  </div>
                  <span className="text-xs font-medium text-accent-orange">绘制中...</span>
                </div>
              ) : isFailed ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-error">
                  <span className="text-lg">✕</span>
                  <span className="text-xs font-medium">生成失败</span>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
                  <div className="rounded-full bg-muted p-2">
                    <ImagePlus className="h-4 w-4" />
                  </div>
                  <span className="text-xs">等待绘制</span>
                </div>
              )}

              {/* 重新生成覆盖层 */}
              {item.imageUrl && isGenerating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/80 backdrop-blur-[2px]">
                  <Loader2 className="h-5 w-5 animate-spin text-accent-orange" />
                  <span className="text-xs font-medium text-accent-orange">重新绘制</span>
                </div>
              )}
            </div>
          </div>

          {/* 信息区域 */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {/* 标题行 */}
            <div className="flex items-center gap-3">
              {/* 状态指示点 */}
              <div className={`h-2 w-2 shrink-0 rounded-full ${status.dotClass} ${status.glowClass}`} />

              <input
                value={item.name}
                disabled={locked || isGenerating}
                onChange={(e) => onUpdateName(e.target.value)}
                className="min-w-0 flex-1 truncate bg-transparent text-[15px] font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={isCharacter ? '角色名称' : '场景名称'}
              />

              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {status.label}
                </span>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-full text-accent-purple transition-colors hover:bg-accent-purple/10 hover:text-accent-purple"
                      onClick={onGenerate}
                      disabled={loading || locked || isGenerating || !item.prompt.trim()}
                      aria-label={item.imageUrl ? '重新生成' : '生成'}
                    >
                      {isGenerating
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <ImagePlus className="h-3.5 w-3.5" />
                      }
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {item.imageUrl ? '重新生成形象' : '生成形象'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* 提示词输入 */}
            <Textarea
              value={item.prompt}
              disabled={locked || isGenerating}
              onChange={(e) => onUpdatePrompt(e.target.value)}
              placeholder={isCharacter ? '描述角色外观、服装、表情...' : '描述场景环境、光线、氛围...'}
              className="min-h-[120px] resize-none rounded-xl border-border/50 bg-muted/30 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground/40 focus:border-accent-purple/40 focus:bg-card disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
