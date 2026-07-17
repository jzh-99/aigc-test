'use client'

import { Music, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioThumbnailProps {
  /** 音频名称 */
  name: string
  /** 时长秒数 */
  duration: number
  /** 显示标签，如 "音频1" */
  label: string
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
 * 音频图标卡片缩略图
 * 与图片/视频缩略图同尺寸，显示音乐图标 + 文件名 + 时长
 */
export function AudioThumbnail({
  name,
  duration,
  label,
  onRemove,
}: AudioThumbnailProps): React.ReactElement {
  return (
    <div className="relative aspect-square rounded-lg border bg-muted/50 group">
      {/* 音乐图标 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1.5">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Music className="h-4 w-4 text-primary" />
        </div>
        <p className="text-[10px] font-medium truncate w-full text-center leading-tight">{name}</p>
        <p className="text-[9px] text-muted-foreground leading-none">{formatDuration(duration)}</p>
      </div>

      {/* 左下角标签 */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-gradient-to-t from-black/40 to-transparent rounded-b-lg">
        <span className="text-[10px] text-white font-medium leading-none">{label}</span>
      </div>

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
