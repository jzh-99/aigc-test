'use client'

import Image from 'next/image'
import { Loader2, ImageIcon, Play, ChevronDown, Film, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAssets, type AssetItem } from '@/hooks/use-assets'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useState } from 'react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { downloadImage } from '@/lib/download'

type AssetType = 'image' | 'video'

export function AssetsLibraryTab() {
  const [assetType, setAssetType] = useState<AssetType>('image')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error } = useAssets(assetType)
  const { showVideoTab } = useTeamFeatures()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [videoDialogAsset, setVideoDialogAsset] = useState<AssetItem | null>(null)
  const viewableAssets = assets.filter((a) => a.storage_url ?? a.original_url)
  const lightboxAsset = lightboxIndex !== null ? viewableAssets[lightboxIndex] : null

  const handleOpenPreview = (asset: AssetItem) => {
    if (asset.type === 'video') {
      setVideoDialogAsset(asset)
      return
    }
    const idx = viewableAssets.findIndex((a) => a.id === asset.id)
    if (idx !== -1) setLightboxIndex(idx)
  }

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
              <AssetLibraryCard key={asset.id} asset={asset} onOpenPreview={handleOpenPreview} />
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

      {lightboxAsset && (() => {
        const url = lightboxAsset.storage_url ?? lightboxAsset.original_url
        return (
          <ImageLightbox
            url={url!}
            alt={lightboxAsset.batch.prompt}
            onClose={() => setLightboxIndex(null)}
            onPrev={lightboxIndex! > 0 ? () => setLightboxIndex((i) => i! - 1) : undefined}
            onNext={lightboxIndex! < viewableAssets.length - 1 ? () => setLightboxIndex((i) => i! + 1) : undefined}
            footer={
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{lightboxAsset.batch.prompt}</p>
                  <p className="text-xs opacity-60 mt-0.5">
                    {new Date(lightboxAsset.created_at).toLocaleString('zh-CN')}
                    {viewableAssets.length > 1 && ` · ${lightboxIndex! + 1} / ${viewableAssets.length}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-white hover:bg-white/10 hover:text-white shrink-0"
                  onClick={() => downloadImage(url!)}
                >
                  <Download className="h-3.5 w-3.5" />
                  下载
                </Button>
              </div>
            }
          />
        )
      })()}

      {videoDialogAsset && (() => {
        const url = videoDialogAsset.storage_url ?? videoDialogAsset.original_url
        return (
          <Dialog open onOpenChange={() => setVideoDialogAsset(null)}>
            <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0">
              <video src={url!} controls autoPlay className="w-full max-h-[80vh] object-contain" preload="auto" />
              <div className="p-3 bg-black/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 truncate">{videoDialogAsset.batch.prompt}</p>
                  <p className="text-xs text-white/50 mt-0.5">{new Date(videoDialogAsset.created_at).toLocaleString('zh-CN')}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-white hover:bg-white/10 hover:text-white shrink-0"
                  onClick={() => downloadImage(url!, 'video')}
                >
                  <Download className="h-3.5 w-3.5" />
                  下载
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}
    </div>
  )
}

function AssetLibraryCard({ asset, onOpenPreview }: { asset: AssetItem; onOpenPreview: (asset: AssetItem) => void }) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null
  const thumbUrl = asset.thumbnail_url ?? url
  const isVideo = asset.type === 'video'

  return (
    <div
      draggable
      onClick={() => onOpenPreview(asset)}
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
          <p className="text-[11px] text-white line-clamp-2 leading-snug drop-shadow pr-8">
            {asset.batch.prompt || (isVideo ? '视频资产' : '图片资产')}
          </p>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-white/70 pr-8">
            {isVideo ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
            <span>拖拽作为参考</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="absolute bottom-2 right-2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
            onClick={(e) => {
              e.stopPropagation()
              downloadImage(url, isVideo ? 'video' : 'image')
            }}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
