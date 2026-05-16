'use client'

import { useRef, useEffect } from 'react'
import { Play } from 'lucide-react'
import { AssetCardActions } from './asset-card-actions'
import { downloadImage } from '@/lib/download'
import type { AssetItem } from '@/hooks/use-assets'

interface VideoCardProps {
  asset: AssetItem
  onPlay: (asset: AssetItem) => void
  onDelete: (id: string) => void
  onReuse: (asset: AssetItem) => void
  isReusing?: boolean
}

/** 视频卡片：16:9 比例，进入视野自动静音播放，点击打开弹窗播放器 */
export function VideoCard({ asset, onPlay, onDelete, onReuse, isReusing }: VideoCardProps) {
  const url = asset.storage_url ?? asset.original_url
  const videoRef = useRef<HTMLVideoElement>(null)

  // 视野内自动播放，离开视野暂停
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.4 },
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  if (!url) return null

  return (
    <div
      className="group relative w-full aspect-video rounded-[10px] overflow-hidden border border-border bg-black cursor-pointer"
      onClick={() => onPlay(asset)}
    >
      <video
        ref={videoRef}
        src={url}
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* 播放图标，hover 时隐藏（操作层接管） */}
      <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
        <Play className="h-8 w-8 text-white drop-shadow-lg" />
      </div>

      {/* hover 操作层 */}
      <AssetCardActions
        prompt={asset.batch.prompt}
        url={url}
        isVideo
        isReusing={isReusing}
        onReuse={() => onReuse(asset)}
        onDownload={() => downloadImage(url, 'video')}
        onDelete={() => onDelete(asset.id)}
      />
    </div>
  )
}
