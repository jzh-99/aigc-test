'use client'

import Image from 'next/image'
import { Loader2, ImageIcon, Play, ChevronDown, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAssets, type AssetItem } from '@/hooks/use-assets'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useState } from 'react'

type AssetType = 'image' | 'video'

export function AssetsLibraryTab() {
  const [assetType, setAssetType] = useState<AssetType>('image')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error } = useAssets(assetType)
  const { showVideoTab } = useTeamFeatures()

  return (
    <div className="space-y-3">
      {showVideoTab && (
        <div className="flex rounded-lg border p-1 w-fit">
          <Button
            variant={assetType === 'image' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setAssetType('image')}
          >
            图片
          </Button>
          <Button
            variant={assetType === 'video' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setAssetType('video')}
          >
            视频
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        将图片或视频资产拖拽到左侧支持的参考区域，可直接作为参考继续生成。
      </p>

      {isLoadingInitial ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">资产加载失败</div>
      ) : assets.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          暂无{assetType === 'video' ? '视频' : '图片'}资产
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <AssetLibraryCard key={asset.id} asset={asset} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
                加载更多
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AssetLibraryCard({ asset }: { asset: AssetItem }) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null
  const thumbUrl = asset.thumbnail_url ?? url
  const isVideo = asset.type === 'video'

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-aigc-asset-url', url)
        e.dataTransfer.setData('application/x-aigc-asset-type', asset.type)
        e.dataTransfer.setData('text/uri-list', url)
        e.dataTransfer.setData('text/plain', url)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-grab active:cursor-grabbing"
      title="拖拽到左侧支持的参考区域"
    >
      {isVideo ? (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <video src={url} className="absolute inset-0 w-full h-full object-cover opacity-60" muted preload="metadata" />
          <Play className="relative z-10 h-8 w-8 text-white drop-shadow-lg" />
        </div>
      ) : (
        <Image src={thumbUrl} alt={asset.batch.prompt} fill className="object-cover" sizes="160px" unoptimized />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
          <p className="text-[11px] text-white line-clamp-2 leading-snug drop-shadow">
            {asset.batch.prompt || (isVideo ? '视频资产' : '图片资产')}
          </p>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-white/70">
            {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
            <span>拖拽作为参考</span>
          </div>
        </div>
      </div>
    </div>
  )
}
