'use client'

import Image from 'next/image'
import { Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaThumbnailProps {
  /** 媒体类型 */
  kind: 'image' | 'video'
  /** 预览 URL */
  previewUrl: string
  /** 显示标签，如 "图片1"、"首帧图"、"视频1" */
  label: string
  /** 文件名（视频用） */
  name?: string
  /** 时长秒数（视频用） */
  duration?: number
  /** 点击预览回调 */
  onPreview: () => void
  /** 删除回调 */
  onRemove: () => void
}

/** 格式化时长为 mm:ss */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
}

/**
 * 单个媒体缩略图组件
 * 支持图片和视频两种类型，悬浮显示删除按钮，点击预览
 */
export function MediaThumbnail({
  kind,
  previewUrl,
  label,
  duration,
  onPreview,
  onRemove,
}: MediaThumbnailProps): React.ReactElement {
  return (
    <div
      className="relative aspect-square rounded-lg overflow-hidden border bg-muted group cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onPreview() }}
    >
      {/* 图片缩略图 */}
      {kind === 'image' && (
        <Image
          src={previewUrl}
          alt={label}
          fill
          className="object-cover"
          sizes="72px"
          unoptimized
        />
      )}

      {/* 视频缩略图 */}
      {kind === 'video' && (
        <>
          <video
            src={previewUrl}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.001 }}
          />
          {/* Play 图标指示器 */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
            <div className="h-6 w-6 rounded-full bg-white/70 group-hover:bg-white flex items-center justify-center transition-colors shadow-sm">
              <Play className="h-3 w-3 text-black ml-0.5" />
            </div>
          </div>
        </>
      )}

      {/* 左下角标签 */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-gradient-to-t from-black/60 to-transparent">
        <span className="text-[10px] text-white font-medium leading-none">{label}</span>
      </div>

      {/* 视频时长标签 */}
      {kind === 'video' && duration != null && duration > 0 && (
        <div className="absolute bottom-0 right-0 px-1 py-0.5">
          <span className="text-[9px] text-white/80 leading-none">{formatDuration(duration)}</span>
        </div>
      )}

      {/* 悬浮删除按钮 */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className={cn(
          'absolute top-1 right-1 h-4 w-4 rounded-full',
          'bg-foreground/60 hover:bg-foreground/80',
          'flex items-center justify-center',
          'opacity-0 group-hover:opacity-100 transition-opacity z-10',
        )}
      >
        <X className="h-2.5 w-2.5 text-background" />
      </button>
    </div>
  )
}
