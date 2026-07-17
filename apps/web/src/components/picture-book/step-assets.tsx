'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ImagePlus, Loader2, Sparkles, Users, Mountain, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssetCard } from './asset-card'
import type { PictureBookElement, PictureBookState } from '@/lib/picture-book/types'

const ASPECT_RATIO_CLASS: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
}

export function StepAssets({
  state,
  onChange,
  onGenerateImages,
  onGenerateOne,
  loading,
  generatingIds = [],
  locked = false,
  imageGenerating = false,
}: {
  state: PictureBookState
  onChange: (state: PictureBookState) => void
  onGenerateImages: () => void
  onGenerateOne: (kind: 'character' | 'background', refId: string) => void
  loading?: boolean
  generatingIds?: string[]
  locked?: boolean
  imageGenerating?: boolean
}) {
  const [tab, setTab] = useState<'characters' | 'backgrounds'>('characters')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const items = state.assets[tab]
  const allItems = state.assets.characters.concat(state.assets.backgrounds)
  const totalItems = allItems.length
  const generatedItems = allItems.filter(item => item.imageUrl && !generatingIds.includes(item.id) && item.status !== 'pending' && item.status !== 'processing').length
  const aspectClass = ASPECT_RATIO_CLASS[state.settings?.aspectRatio ?? '16:9'] ?? 'aspect-video'

  const updateItem = (id: string, patch: Partial<PictureBookElement>) => {
    if (locked) return
    onChange({
      ...state,
      assets: {
        ...state.assets,
        [tab]: items.map((item) => item.id === id ? { ...item, ...patch } : item),
      },
    })
  }

  return (
    <section className="space-y-6">
      {/* 头部区域 - 渐变装饰 */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-r from-card via-card to-accent-purple/5 p-5">
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent-orange/8 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 right-20 h-24 w-24 rounded-full bg-accent-blue/6 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-orange/20 to-accent-purple/20">
                <Sparkles className="h-4 w-4 text-accent-orange" />
              </div>
              <h2 className="text-lg font-bold tracking-tight">角色 / 场景资产库</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              角色和背景提示词已由上一步自动提炼，编辑并生成图片后确认进入绘本分镜
            </p>
          </div>
          <Button
            onClick={onGenerateImages}
            disabled={loading || locked || !items.length}
            className="rounded-xl bg-gradient-to-r from-accent-orange to-accent-purple px-5 text-white shadow-md shadow-accent-purple/20 transition-all hover:shadow-lg hover:shadow-accent-purple/30"
          >
            {imageGenerating
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ImagePlus className="mr-2 h-4 w-4" />
            }
            {imageGenerating ? '正在提交...' : '批量生成图片'}
          </Button>
        </div>

        {/* 进度条 */}
        <div className="relative mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent-orange via-accent-purple to-accent-blue"
              initial={{ width: 0 }}
              animate={{ width: totalItems > 0 ? `${(generatedItems / totalItems) * 100}%` : '0%' }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {generatedItems}/{totalItems}
          </span>
        </div>
      </div>

      {/* 标签切换 */}
      <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
        <button
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'characters'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('characters')}
        >
          <Users className="h-4 w-4" />
          角色
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            tab === 'characters' ? 'bg-accent-purple/15 text-accent-purple' : 'bg-muted text-muted-foreground'
          }`}>
            {state.assets.characters.length}
          </span>
        </button>
        <button
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'backgrounds'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('backgrounds')}
        >
          <Mountain className="h-4 w-4" />
          场景
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            tab === 'backgrounds' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-muted text-muted-foreground'
          }`}>
            {state.assets.backgrounds.length}
          </span>
        </button>
      </div>

      {/* 卡片网格 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="grid gap-5 lg:grid-cols-2"
        >
          {items.map((item, index) => {
            const isGenerating = generatingIds.includes(item.id) || item.status === 'pending' || item.status === 'processing'
            const isFailed = item.status === 'failed'
            const kind = tab === 'characters' ? 'character' : 'background'
            return (
              <AssetCard
                key={item.id}
                item={item}
                index={index}
                kind={kind}
                aspectClass={aspectClass}
                isGenerating={isGenerating}
                isFailed={isFailed}
                locked={locked}
                loading={loading}
                onUpdateName={(name) => updateItem(item.id, { name })}
                onUpdatePrompt={(prompt) => updateItem(item.id, { prompt })}
                onGenerate={() => onGenerateOne(kind, item.id)}
                onPreview={(url) => setPreviewUrl(url)}
              />
            )
          })}
        </motion.div>
      </AnimatePresence>

      {/* 图片预览弹窗 */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
            onClick={() => setPreviewUrl(null)}
          >
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="absolute right-5 top-5 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
              onClick={() => setPreviewUrl(null)}
            >
              <X className="h-5 w-5" />
            </motion.button>
            <motion.img
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              src={previewUrl}
              alt="预览"
              className="max-h-[85vh] max-w-[85vw] rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
