'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Loader2, Download, Trash2, ImageIcon, VideoIcon, CalendarSearch, X, RotateCcw } from 'lucide-react'
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
import { AssetTrashDrawer } from '@/components/assets/asset-trash-drawer'
import { AssetCard } from '@/components/assets/asset-card'

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

export default function AssetsPage() {
  const router = useRouter()
  const applyBatch = useGenerationStore((s) => s.applyBatch)
  const [assetType, setAssetType] = useState<'image' | 'video'>('image')
  const [dateFilter, setDateFilter] = useState('')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error, mutate } = useAssets(assetType, dateFilter || undefined)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [videoDialogAsset, setVideoDialogAsset] = useState<AssetItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reusingId, setReusingId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
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
    setReusingId(asset.id)
    try {
      // Fetch full batch details to get all parameters
      const batch = await apiGet<BatchResponse>(`/batches/${asset.batch.id}`)

      // Apply batch parameters to generation store
      applyBatch(batch)

      // Navigate to appropriate generation page
      const batchModule = (batch as any).module as string
      if (batchModule === 'avatar') {
        router.push('/generation?mode=avatar')
      } else if (batchModule === 'action_imitation') {
        router.push('/generation?mode=action_imitation')
      } else if (asset.type === 'video') {
        router.push('/generation?mode=video')
      } else {
        router.push('/generation')
      }

      toast.success('已复用提示词和参数')
    } catch (err) {
      toast.error('获取参数失败')
    } finally {
      setReusingId(null)
    }
  }

  const grouped = groupByDate(assets)
  const lightboxAsset = lightboxIndex !== null ? viewableAssets[lightboxIndex] : null

  return (
    <main className="assets-page relative min-h-full bg-[#060918] text-white px-10 py-8">
      {/* 大气层 */}
      <div className="assets-page-atmosphere" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="toby-orb toby-orb--violet absolute -left-[8%] -top-[8%] h-[36rem] w-[36rem] rounded-full" />
        <div className="toby-orb toby-orb--sky absolute -right-[5%] top-[20%] h-[28rem] w-[28rem] rounded-full" />
      </div>
      {/* 噪点纹理 */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.018]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat' }} />

      <div className="relative z-10 space-y-8">
        {/* 页面标题区 */}
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-serif text-2xl font-normal tracking-wide text-white/90" style={{ textShadow: '0 0 40px rgba(169,156,255,0.15)' }}>资产库</h2>
            <p className="mt-1 text-xs text-white/40 tracking-wide">管理你的创作作品与灵感收藏</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 日期筛选 — 同源搜索框样式 */}
            <div className="relative flex items-center">
              <CalendarSearch className="pointer-events-none absolute left-3 h-4 w-4 text-violet-100/40" />
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="h-9 w-[152px] rounded-full border border-violet-200/10 bg-[#151a3f]/35 pl-9 pr-3 text-xs text-violet-100/55 shadow-[inset_0_1px_0_rgba(226,214,255,0.1)] backdrop-blur focus:border-violet-400/30 focus:ring-violet-400/15"
              />
              {dateFilter && (
                <button
                  type="button"
                  className="absolute right-2 grid h-5 w-5 place-items-center rounded-full text-violet-100/40 hover:text-white/70 hover:bg-white/10 transition"
                  onClick={() => setDateFilter('')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {/* 类型切换 — 同源标签 pill 样式 */}
            {showVideoTab && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition flex items-center gap-1.5 ${
                    assetType === 'image'
                      ? 'bg-violet-200/10 text-white shadow-[inset_0_1px_0_rgba(226,214,255,0.24),0_0_28px_rgba(116,87,255,0.14)]'
                      : 'text-white/50 hover:bg-violet-200/10 hover:text-violet-50'
                  }`}
                  onClick={() => setAssetType('image')}
                >
                  <ImageIcon className="h-4 w-4" />
                  图片
                </button>
                <button
                  type="button"
                  className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition flex items-center gap-1.5 ${
                    assetType === 'video'
                      ? 'bg-violet-200/10 text-white shadow-[inset_0_1px_0_rgba(226,214,255,0.24),0_0_28px_rgba(116,87,255,0.14)]'
                      : 'text-white/50 hover:bg-violet-200/10 hover:text-violet-50'
                  }`}
                  onClick={() => setAssetType('video')}
                >
                  <VideoIcon className="h-4 w-4" />
                  视频
                </button>
              </div>
            )}
            {/* 回收站 — 同源搜索框样式 */}
            <button
              type="button"
              className="flex h-9 items-center gap-2 rounded-full border border-violet-200/10 bg-[#151a3f]/35 px-4 text-sm text-violet-100/55 shadow-[inset_0_1px_0_rgba(226,214,255,0.1)] backdrop-blur transition hover:text-white/80 hover:border-violet-200/20"
              onClick={() => setTrashOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              回收站
            </button>
          </div>
        </header>

      {isLoadingInitial && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="py-16 text-center">
          <p className="text-sm text-red-300/60">加载失败: {error.message}</p>
        </div>
      )}

      {!isLoadingInitial && !error && assets.length === 0 && (
        <div className="py-24 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
            {assetType === 'video' ? (
              <VideoIcon className="h-7 w-7 text-white/15" />
            ) : (
              <ImageIcon className="h-7 w-7 text-white/15" />
            )}
          </div>
          {dateFilter ? (
            <>
              <p className="text-sm text-white/35">该日期暂无资产</p>
              <p className="mt-1 text-xs text-white/20">{new Date(dateFilter + 'T12:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-white/35">暂无{assetType === 'video' ? '视频' : '图片'}资产</p>
              <p className="mt-1 text-xs text-white/20">前往{assetType === 'video' ? '视频' : '图片'}生成开始创作</p>
            </>
          )}
        </div>
      )}

      {grouped.map(({ date, items }) => (
        <section key={date}>
          <div className="asset-date-heading">
            <h3 className="text-[13px] font-medium tracking-wide text-white/35 whitespace-nowrap">{date}</h3>
            <span className="text-[11px] text-white/18">{items.length} 个</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onClick={handleEnlarge}
                onDelete={() => handleDelete(asset.id)}
                onReuse={() => handleReuse(asset)}
                isReusing={reusingId === asset.id}
                deleting={deletingId === asset.id}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Skeleton placeholders shown while next page loads */}
      {isLoadingMore && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} />
      </div>

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
                    disabled={reusingId === lightboxAsset.id}
                  >
                    {reusingId === lightboxAsset.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
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
                    disabled={reusingId === videoDialogAsset.id}
                  >
                    {reusingId === videoDialogAsset.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
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

      <AssetTrashDrawer
        open={trashOpen}
        onOpenChange={setTrashOpen}
        onRestored={() => mutate()}
      />
    </main>
  )
}
