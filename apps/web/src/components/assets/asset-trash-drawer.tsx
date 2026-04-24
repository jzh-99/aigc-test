'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useTrashAssets, restoreAsset, permanentDeleteAsset, type TrashAssetItem } from '@/hooks/use-assets'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'

interface AssetTrashDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestored: () => void
}

function daysLeft(deletedAt: string): number {
  const diff = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, 7 - Math.floor(diff / (24 * 60 * 60 * 1000)))
}

export function AssetTrashDrawer({ open, onOpenChange, onRestored }: AssetTrashDrawerProps) {
  const { assets, isLoading, mutate } = useTrashAssets(open)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleRestore(asset: TrashAssetItem) {
    setLoadingId(asset.id)
    try {
      await restoreAsset(asset.id)
      toast.success('已恢复')
      mutate()
      onRestored()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '恢复失败')
    } finally {
      setLoadingId(null)
    }
  }

  async function handlePermanentDelete(asset: TrashAssetItem) {
    if (!confirm(`确定要永久删除这个${asset.type === 'video' ? '视频' : '图片'}吗？\n此操作不可恢复。`)) return
    setLoadingId(asset.id)
    try {
      await permanentDeleteAsset(asset.id)
      toast.success('已永久删除')
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>回收站</SheetTitle>
        </SheetHeader>
        <p className="text-xs text-muted-foreground mt-1">已删除的资产将在 7 天后自动永久删除</p>

        <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-1">
          {isLoading && (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          )}

          {!isLoading && assets.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">回收站为空</p>
          )}

          {assets.map((asset) => {
            const url = asset.storage_url ?? asset.original_url
            const remaining = daysLeft(asset.deleted_at)
            return (
              <div key={asset.id} className="border rounded-lg p-3 flex items-center gap-3">
                <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0">
                  {url ? (
                    <Image src={url} alt={asset.prompt} width={48} height={48} className="w-full h-full object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{asset.prompt || '(无提示词)'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    剩余 <span className={remaining <= 1 ? 'text-destructive font-medium' : 'text-orange-500 font-medium'}>{remaining} 天</span>
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => handleRestore(asset)}
                    disabled={loadingId === asset.id}
                  >
                    {loadingId === asset.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handlePermanentDelete(asset)}
                    disabled={loadingId === asset.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
