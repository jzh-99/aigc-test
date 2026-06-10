'use client'

import Image from 'next/image'
import { Play, Film, ImageIcon, Download, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { downloadImage } from '@/lib/download'
import type { AssetItem } from '@/hooks/use-assets'

export interface AssetCardProps {
  /** 资产数据 */
  asset: AssetItem
  /** 点击卡片主体回调 */
  onClick?: (asset: AssetItem) => void
  /** 是否可拖拽（创作模块使用） */
  draggable?: boolean
  /** 下载回调，不传则使用内置下载 */
  onDownload?: () => void
  /** 复用回调（资产页使用） */
  onReuse?: () => void
  /** 删除回调（资产页使用） */
  onDelete?: () => void
  /** 是否正在复用中 */
  isReusing?: boolean
  /** 是否正在删除中 */
  deleting?: boolean
}

/** 统一资产卡片 — 图片/视频共用，支持拖拽、复用、删除等可选操作 */
export function AssetCard({
  asset,
  onClick,
  draggable,
  onDownload,
  onReuse,
  onDelete,
  isReusing,
  deleting,
}: AssetCardProps) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null

  const thumbUrl = asset.thumbnail_url ?? url
  const isVideo = asset.type === 'video'

  // 删除中状态：显示旋转占位
  if (deleting) {
    return (
      <div className="aspect-square rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-white/20" />
      </div>
    )
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDownload) {
      onDownload()
    } else {
      downloadImage(url, isVideo ? 'video' : 'image')
    }
  }

  return (
    <div
      draggable={draggable}
      onClick={() => onClick?.(asset)}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData('application/x-aigc-asset-url', url)
              e.dataTransfer.setData('application/x-aigc-asset-type', asset.type)
              e.dataTransfer.setData('text/uri-list', url)
              e.dataTransfer.setData('text/plain', url)
              e.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
      className="group relative aspect-square rounded-2xl overflow-hidden border border-white/[0.06] bg-muted cursor-pointer active:cursor-grabbing"
      title={draggable ? '拖拽到左侧支持的参考区域' : undefined}
    >
      {/* 内容区域 */}
      {isVideo ? (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <video
            src={url}
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            muted
            preload="metadata"
          />
          <Play className="relative z-10 h-8 w-8 text-white drop-shadow-lg" />
        </div>
      ) : (
        <Image
          src={thumbUrl}
          alt={asset.batch.prompt || '图片资产'}
          fill
          className="object-cover"
          sizes="200px"
          unoptimized
        />
      )}

      {/* 悬停遮罩 + 内容 */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
          {/* prompt 预览 */}
          <p className="text-[11px] text-white line-clamp-2 leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            {asset.batch.prompt || (isVideo ? '视频资产' : '图片资产')}
          </p>

          {/* 类型标签 — 仅创作模块卡片显示 */}
          {draggable && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-white/70">
              {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              <span>拖拽作为参考</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="absolute bottom-2 right-2 flex gap-1">
            {/* 复用 */}
            {onReuse && (
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-black/70 text-white border-0 transition disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation()
                  onReuse()
                }}
                disabled={isReusing}
                title="复用"
              >
                {isReusing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {/* 删除 */}
            {onDelete && (
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-red-600/70 text-white border-0 transition"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {/* 下载 */}
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-full bg-black/50 hover:bg-black/70 text-white border-0 transition"
              onClick={handleDownload}
              title="下载"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
