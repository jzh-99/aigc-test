'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Loader2, Download, Trash2, ImageIcon, VideoIcon, CalendarSearch, X, Play, RotateCcw } from 'lucide-react'
import { useAssets, deleteAsset } from '@/hooks/use-assets'
import type { AssetItem } from '@/hooks/use-assets'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useGenerationStore } from '@/stores/generation-store'
import { apiGet } from '@/lib/api-client'
import type { BatchResponse } from '@aigc/types'
import { downloadImage } from '@/lib/download'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.1-flash-image-preview':    '全能图片2 1K',
  'gemini-3.1-flash-image-preview-2k': '全能图片2 2K',
  'gemini-3.1-flash-image-preview-4k': '全能图片2 4K',
  'nano-banana-2':                     '全能图片Pro 1K',
  'nano-banana-2-2k':                  '全能图片Pro 2K',
  'nano-banana-2-4k':                  '全能图片Pro 4K',
  'veo3.1-fast':                       '全能视频3.1 Fast',
}

function groupByDate(assets: AssetItem[]): { date: string; items: AssetItem[] }[] {
  const map = new Map<string, AssetItem[]>()
  for (const asset of assets) {
    const date = new Date(asset.created_at).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (!map.has(date)) map.set(date, [])
    map.get(date)!.push(asset)
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }))
}

interface AssetCardProps {
  asset: AssetItem
  onEnlarge: (asset: AssetItem) => void
  onDelete: (id: string) => void
  onReuse: (asset: AssetItem) => void
}

function AssetCard({ asset, onEnlarge, onDelete, onReuse }: AssetCardProps) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null
  const thumbUrl = asset.thumbnail_url ?? url
  const isVideo = asset.type === 'video'

  return (
    <div
      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer"
      onClick={() => onEnlarge(asset)}
    >
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
          alt={asset.batch.prompt}
          fill
          className="object-cover transition-transform group-hover:scale-105"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          unoptimized
        />
      )}
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
          {/* Prompt tooltip at top */}
          <p className="text-[11px] text-white/90 line-clamp-2 leading-snug drop-shadow">
            {asset.batch.prompt}
          </p>
          {/* Action buttons at bottom */}
          <div className="flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
              onClick={(e) => { e.stopPropagation(); onReuse(asset) }}
              title="复用"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
              onClick={(e) => { e.stopPropagation(); downloadImage(url, isVideo ? 'video' : 'image') }}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 bg-black/50 hover:bg-red-600/80 text-white border-0"
              onClick={(e) => { e.stopPropagation(); onDelete(asset.id) }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AssetsPage() {
  const router = useRouter()
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const [assetType, setAssetType] = useState<'image' | 'video'>('image')
  const [dateFilter, setDateFilter] = useState('')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error, mutate } = useAssets(assetType, dateFilter || undefined)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [videoDialogAsset, setVideoDialogAsset] = useState<AssetItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { showVideoTab } = useTeamFeatures()

  // Auto-load more when the sentinel div enters the viewport
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, loadMore])

  // Flat list of assets with URLs (for lightbox navigation)
  const viewableAssets = assets.filter((a) => a.storage_url ?? a.original_url)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteAsset(id)
      mutate()
      toast.success('已删除')
    } catch {
      toast.error('删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleEnlarge = (asset: AssetItem) => {
    if (asset.type === 'video') {
      setVideoDialogAsset(asset)
      return
    }
    const idx = viewableAssets.findIndex((a) => a.id === asset.id)
    if (idx !== -1) setLightboxIndex(idx)
  }

  const handleReuse = async (asset: AssetItem) => {
    try {
      // Fetch full batch details to get all parameters
      const batch = await apiGet<BatchResponse>(`/batches/${asset.batch.id}`)

      // Apply batch parameters to generation store
      applyBatch(batch)

      // Navigate to appropriate generation page
      if (asset.type === 'video') {
        router.push('/image?mode=video')
      } else {
        router.push('/image')
      }

      toast.success('已复用提示词和参数')
    } catch (err) {
      toast.error('获取参数失败')
    }
  }

  const grouped = groupByDate(assets)
  const lightboxAsset = lightboxIndex !== null ? viewableAssets[lightboxIndex] : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">资产库</h2>
        <div className="flex items-center gap-2">
          {/* Date filter */}
          <div className="relative flex items-center">
            <CalendarSearch className="absolute left-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="pl-8 w-[160px] h-8 text-sm"
            />
            {dateFilter && (
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-0 h-8 w-8"
                onClick={() => setDateFilter('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {/* Type toggle — hidden for company_a teams */}
          {showVideoTab && (
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Button
              size="sm"
              variant={assetType === 'image' ? 'default' : 'ghost'}
              className="h-7 gap-1.5 text-xs"
              onClick={() => setAssetType('image')}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              图片
            </Button>
            <Button
              size="sm"
              variant={assetType === 'video' ? 'default' : 'ghost'}
              className="h-7 gap-1.5 text-xs"
              onClick={() => setAssetType('video')}
            >
              <VideoIcon className="h-3.5 w-3.5" />
              视频
            </Button>
          </div>
          )}
        </div>
      </div>

      {isLoadingInitial && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="py-12 text-center text-sm text-destructive">加载失败: {error.message}</div>
      )}

      {!isLoadingInitial && !error && assets.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">
          {assetType === 'video' ? (
            <VideoIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
          ) : (
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
          )}
          {dateFilter ? (
            <>
              <p>该日期暂无资产</p>
              <p className="text-xs mt-1">{new Date(dateFilter + 'T12:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </>
          ) : (
            <>
              <p>暂无{assetType === 'video' ? '视频' : '图片'}资产</p>
              <p className="text-xs mt-1">前往{assetType === 'video' ? '视频' : '图片'}生成开始创作</p>
            </>
          )}
        </div>
      )}

      {grouped.map(({ date, items }) => (
        <section key={date}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <span>{date}</span>
            <span className="text-xs opacity-60">({items.length} 个)</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map((asset) =>
              deletingId === asset.id ? (
                <div key={asset.id} className="aspect-square rounded-lg border bg-muted flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEnlarge={handleEnlarge}
                  onDelete={handleDelete}
                  onReuse={handleReuse}
                />
              )
            )}
          </div>
        </section>
      ))}

      {/* Skeleton placeholders shown while next page loads */}
      {isLoadingMore && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} />

      {/* Image Lightbox */}
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
                    {MODEL_DISPLAY_NAMES[lightboxAsset.batch.model] ?? lightboxAsset.batch.model}
                    {' · '}
                    {new Date(lightboxAsset.created_at).toLocaleString('zh-CN')}
                    {viewableAssets.length > 1 && ` · ${lightboxIndex! + 1} / ${viewableAssets.length}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      handleReuse(lightboxAsset)
                      setLightboxIndex(null)
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    复用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => downloadImage(url!)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </Button>
                </div>
              </div>
            }
          />
        )
      })()}

      {/* Video Dialog */}
      {videoDialogAsset && (() => {
        const url = videoDialogAsset.storage_url ?? videoDialogAsset.original_url
        return (
          <Dialog open onOpenChange={() => setVideoDialogAsset(null)}>
            <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0">
              <video
                src={url!}
                controls
                autoPlay
                className="w-full max-h-[80vh] object-contain"
                preload="auto"
              />
              <div className="p-3 bg-black/80 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 truncate">{videoDialogAsset.batch.prompt}</p>
                  <p className="text-xs text-white/50 mt-0.5">
                    {MODEL_DISPLAY_NAMES[videoDialogAsset.batch.model] ?? videoDialogAsset.batch.model}
                    {' · '}
                    {new Date(videoDialogAsset.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      handleReuse(videoDialogAsset)
                      setVideoDialogAsset(null)
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    复用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => downloadImage(url!, 'video')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}
    </div>
  )
}
