'use client'

import { Loader2, ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAssets, type AssetItem } from '@/hooks/use-assets'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useState } from 'react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { downloadImage } from '@/lib/download'
import { AssetCard } from '@/components/assets/asset-card'

type AssetType = 'image' | 'video'

interface AssetsLibraryTabProps {
  onSelectBatch?: (batchId: string) => void
}

export function AssetsLibraryTab({ onSelectBatch }: AssetsLibraryTabProps) {
  const [assetType, setAssetType] = useState<AssetType>('image')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error } = useAssets(assetType)
  const { showVideoTab } = useTeamFeatures()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [videoDialogAsset, setVideoDialogAsset] = useState<AssetItem | null>(null)
  const viewableAssets = assets.filter((a) => a.storage_url ?? a.original_url)
  const lightboxAsset = lightboxIndex !== null ? viewableAssets[lightboxIndex] : null

  const handleOpenPreview = (asset: AssetItem) => {
    if (onSelectBatch) {
      onSelectBatch(asset.batch.id)
      return
    }
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
        <div className="generation-dream-segmented flex w-fit rounded-full border p-1">
          <Button
            variant={assetType === 'image' ? 'default' : 'ghost'}
            size="sm"
            className="generation-dream-pill h-8 rounded-full px-4 text-xs"
            onClick={() => setAssetType('image')}
          >
            图片
          </Button>
          <Button
            variant={assetType === 'video' ? 'default' : 'ghost'}
            size="sm"
            className="generation-dream-pill h-8 rounded-full px-4 text-xs"
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
              <AssetCard
                key={asset.id}
                asset={asset}
                draggable
                onClick={handleOpenPreview}
              />
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