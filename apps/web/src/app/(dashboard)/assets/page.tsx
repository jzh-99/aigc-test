'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, Download, Maximize2, Trash2, ImageIcon, VideoIcon, CalendarSearch, X } from 'lucide-react'
import { useAssets, deleteAsset } from '@/hooks/use-assets'
import type { AssetItem } from '@/hooks/use-assets'
import { downloadImage } from '@/lib/download'
import { toast } from 'sonner'

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-3.1-flash-image-preview':    '全能图片2 1K',
  'gemini-3.1-flash-image-preview-2k': '全能图片2 2K',
  'gemini-3.1-flash-image-preview-4k': '全能图片2 4K',
  'nano-banana-2':                     '全能图片Pro 1K',
  'nano-banana-2-2k':                  '全能图片Pro 2K',
  'nano-banana-2-4k':                  '全能图片Pro 4K',
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
}

function AssetCard({ asset, onEnlarge, onDelete }: AssetCardProps) {
  const url = asset.storage_url ?? asset.original_url
  if (!url) return null

  return (
    <div className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer">
      <Image
        src={url}
        alt={asset.batch.prompt}
        fill
        className="object-cover transition-transform group-hover:scale-105"
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
        unoptimized
      />
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
              onClick={(e) => { e.stopPropagation(); onEnlarge(asset) }}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
              onClick={(e) => { e.stopPropagation(); downloadImage(url) }}
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
  const [assetType] = useState<'image'>('image') // video TBD
  const [dateFilter, setDateFilter] = useState('')
  const { assets, isLoadingInitial, isLoadingMore, hasMore, loadMore, error, mutate } = useAssets(assetType, dateFilter || undefined)
  const [lightbox, setLightbox] = useState<AssetItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  const grouped = groupByDate(assets)

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
          {/* Type toggle — video disabled for now */}
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Button size="sm" variant="default" className="h-7 gap-1.5 text-xs">
              <ImageIcon className="h-3.5 w-3.5" />
              图片
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs opacity-40 cursor-not-allowed" disabled>
              <VideoIcon className="h-3.5 w-3.5" />
              视频
            </Button>
          </div>
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
          <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
          {dateFilter ? (
            <>
              <p>该日期暂无资产</p>
              <p className="text-xs mt-1">{new Date(dateFilter + 'T12:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </>
          ) : (
            <>
              <p>暂无资产</p>
              <p className="text-xs mt-1">前往图片生成开始创作</p>
            </>
          )}
        </div>
      )}

      {grouped.map(({ date, items }) => (
        <section key={date}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <span>{date}</span>
            <span className="text-xs opacity-60">({items.length} 张)</span>
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
                  onEnlarge={setLightbox}
                  onDelete={handleDelete}
                />
              )
            )}
          </div>
        </section>
      ))}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            加载更多
          </Button>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {lightbox && (() => {
            const url = lightbox.storage_url ?? lightbox.original_url
            return (
              <div className="space-y-2">
                <div className="relative aspect-square w-full">
                  <Image
                    src={url!}
                    alt={lightbox.batch.prompt}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
                <div className="px-2 pb-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm truncate text-muted-foreground">{lightbox.batch.prompt}</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      {MODEL_DISPLAY_NAMES[lightbox.batch.model] ?? lightbox.batch.model}
                      {' · '}
                      {new Date(lightbox.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => downloadImage(url!)}>
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
