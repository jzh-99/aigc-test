'use client'

import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Search, X } from 'lucide-react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { cn } from '@/lib/utils'
import { MediaThumbnail } from './media-thumbnail'
import { AudioThumbnail } from './audio-thumbnail'
import type { MediaGridItem, MediaPreviewState } from './media-grid-types'

interface MediaThumbnailGridProps {
  /** 媒体条目列表 */
  items: MediaGridItem[]
  /** 是否显示添加按钮 */
  showAddButton: boolean
  /** 添加按钮点击回调 */
  onAddClick: () => void
  /** 添加按钮是否禁用 */
  addButtonDisabled?: boolean
  /** 删除某项回调 */
  onRemoveItem: (id: string) => void
  /** 空状态提示文案 */
  emptyText?: string
  /** 空状态图标 */
  emptyIcon?: React.ComponentType<{ className?: string }>
  /** 空状态点击回调（点击整个区域触发上传） */
  onEmptyClick?: () => void
  /** 空状态容器额外样式 */
  emptyClassName?: string
}

/**
 * 缩略图网格容器
 * 自适应 2~4 列网格，内含图片灯箱和视频全屏播放预览
 */
export function MediaThumbnailGrid({
  items,
  showAddButton,
  onAddClick,
  addButtonDisabled = false,
  onRemoveItem,
  emptyText = '点击或拖拽上传素材',
  emptyIcon: EmptyIcon,
  onEmptyClick,
  emptyClassName,
}: MediaThumbnailGridProps): React.ReactElement {
  const [preview, setPreview] = useState<MediaPreviewState | null>(null)

  /** 图片预览：带前后导航 */
  const handleImagePreview = useCallback((item: MediaGridItem) => {
    // 收集所有图片类型的条目用于导航
    const imageItems = items.filter((i) => i.kind === 'image')
    const idx = imageItems.findIndex((i) => i.id === item.id)
    setPreview({
      type: 'image',
      url: item.previewUrl,
      name: item.label,
      index: idx >= 0 ? idx : 0,
      total: imageItems.length,
    })
  }, [items])

  /** 视频预览：全屏播放 */
  const handleVideoPreview = useCallback((item: MediaGridItem) => {
    setPreview({
      type: 'video',
      url: item.previewUrl,
      name: item.name ?? item.label,
    })
  }, [])

  /** 图片导航：上一张 */
  const handlePrevImage = useCallback(() => {
    if (!preview || preview.type !== 'image' || preview.index == null) return
    const imageItems = items.filter((i) => i.kind === 'image')
    const prevIdx = preview.index - 1
    if (prevIdx < 0) return
    const prev = imageItems[prevIdx]
    setPreview({ ...preview, url: prev.previewUrl, name: prev.label, index: prevIdx })
  }, [preview, items])

  /** 图片导航：下一张 */
  const handleNextImage = useCallback(() => {
    if (!preview || preview.type !== 'image' || preview.index == null || preview.total == null) return
    const imageItems = items.filter((i) => i.kind === 'image')
    const nextIdx = preview.index + 1
    if (nextIdx >= preview.total) return
    const next = imageItems[nextIdx]
    setPreview({ ...preview, url: next.previewUrl, name: next.label, index: nextIdx })
  }, [preview, items])

  const isEmpty = items.length === 0

  return (
    <>
      {/* 空状态 */}
      {isEmpty ? (
        <div
          onClick={onEmptyClick ?? onAddClick}
          className={cn(
            'rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all cursor-pointer flex items-center gap-2.5 px-3 py-3',
            emptyClassName,
          )}
        >
          {EmptyIcon ? <EmptyIcon className="h-5 w-5 text-primary shrink-0" /> : <Plus className="h-5 w-5 text-primary shrink-0" />}
          <span className="text-xs font-medium text-primary">{emptyText}</span>
        </div>
      ) : (
        /* 缩略图网格 */
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
          {items.map((item) => {
            if (item.kind === 'audio') {
              return (
                <AudioThumbnail
                  key={item.id}
                  name={item.name ?? item.label}
                  duration={item.duration ?? 0}
                  label={item.label}
                  onRemove={() => onRemoveItem(item.id)}
                />
              )
            }
            return (
              <MediaThumbnail
                key={item.id}
                kind={item.kind}
                previewUrl={item.previewUrl}
                label={item.label}
                name={item.name}
                duration={item.duration}
                onPreview={() => {
                  if (item.kind === 'video') handleVideoPreview(item)
                  else handleImagePreview(item)
                }}
                onRemove={() => onRemoveItem(item.id)}
              />
            )
          })}

          {/* 添加按钮 */}
          {showAddButton && (
            <button
              type="button"
              onClick={onAddClick}
              disabled={addButtonDisabled}
              className={cn(
                'aspect-square rounded-lg border-2 border-dashed',
                'flex flex-col items-center justify-center gap-1',
                'transition-all',
                addButtonDisabled
                  ? 'border-muted-foreground/15 opacity-50 cursor-not-allowed'
                  : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 cursor-pointer',
              )}
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">添加</span>
            </button>
          )}
        </div>
      )}

      {/* 图片灯箱预览 */}
      {preview?.type === 'image' && (
        <ImageLightbox
          url={preview.url}
          alt={preview.name}
          onClose={() => setPreview(null)}
          onPrev={preview.index != null && preview.index > 0 ? handlePrevImage : undefined}
          onNext={preview.index != null && preview.total != null && preview.index < preview.total - 1 ? handleNextImage : undefined}
          footer={<p className="text-sm text-white/80">{preview.name}</p>}
        />
      )}

      {/* 视频全屏播放 */}
      {preview?.type === 'video' && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-black/80"
          onClick={() => setPreview(null)}
        >
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-sm text-white/80 truncate">{preview.name}</p>
              <button
                onClick={() => setPreview(null)}
                className="h-7 w-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>
            <video src={preview.url} controls autoPlay className="w-full rounded-xl max-h-[70vh] bg-black" />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
