'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssetCardActions } from './asset-card-actions'
import { downloadImage } from '@/lib/download'
import type { AssetItem } from '@/hooks/use-assets'

interface ImageCarouselCardProps {
  /** 同一 batch 的所有图片，至少一张 */
  images: AssetItem[]
  onImageClick: (assetId: string) => void
  onDelete: (id: string) => void
  onReuse: (asset: AssetItem) => void
  isReusing?: boolean
  deletingId?: string | null
}

/** 图片批次卡片：单图静态展示，多图支持左右翻页轮播 */
export function ImageCarouselCard({
  images,
  onImageClick,
  onDelete,
  onReuse,
  isReusing,
  deletingId,
}: ImageCarouselCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const isMulti = images.length > 1
  const current = images[currentIndex]
  const url = current.storage_url ?? current.original_url
  const thumbUrl = current.thumbnail_url ?? url

  // 当前图片正在删除中，显示 loading 占位
  if (deletingId === current.id) {
    return (
      <div className="w-full aspect-[4/3] rounded-[10px] border bg-muted flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!url) return null

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIndex((i) => Math.max(0, i - 1))
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentIndex((i) => Math.min(images.length - 1, i + 1))
  }

  return (
    <div
      className="group relative w-full rounded-[10px] overflow-hidden border border-border bg-muted cursor-pointer flex items-center justify-center"
      style={{ height: '300px' }}
      onClick={() => onImageClick(current.id)}
    >
      {/* 图片：宽度填满，高度按比例自适应 */}
      <img
        src={thumbUrl!}
        alt={current.batch.prompt}
        className="h-full w-full object-contain"
        loading="lazy"
      />

      {/* 多图：左右翻页箭头 */}
      {isMulti && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-primary/80 hover:bg-primary text-white border-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={handlePrev}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-primary/80 hover:bg-primary text-white border-0 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            onClick={handleNext}
            disabled={currentIndex === images.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* 底部指示点 */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {images.map((_, i) => (
              <span
                key={i}
                className={`block h-1.5 w-1.5 rounded-full transition-colors ${
                  i === currentIndex ? 'bg-primary' : 'bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}

      {/* hover 操作层 */}
      <AssetCardActions
        prompt={current.batch.prompt}
        url={url}
        isReusing={isReusing}
        onReuse={() => onReuse(current)}
        onDownload={() => downloadImage(url, 'image')}
        onDelete={() => onDelete(current.id)}
      />
    </div>
  )
}
