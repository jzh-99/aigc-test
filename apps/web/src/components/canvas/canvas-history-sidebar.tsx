'use client'

import { useMemo, useState, useEffect } from 'react'
import { X, Loader2, ChevronDown, ImageIcon } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { BatchDetail } from '@/components/history/batch-detail'
import { cn } from '@/lib/utils'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import type { CanvasAssetItem, CanvasHistoryItem } from '@/lib/canvas/canvas-api'

type Tab = 'history' | 'assets'

interface Props {
  canvasId: string
  onClose: () => void
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  completed: { label: '完成', cls: 'bg-green-100 text-green-700' },
  processing: { label: '生成中', cls: 'bg-blue-100 text-blue-700' },
  pending: { label: '排队中', cls: 'bg-yellow-100 text-yellow-700' },
  failed: { label: '失败', cls: 'bg-red-100 text-red-600' },
}

export function CanvasHistorySidebar({ canvasId, onClose }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const [tab, setTab] = useState<Tab>('history')
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null)

  const byCanvas = useCanvasSidebarDataStore((s) => s.byCanvas)
  const refreshHistory = useCanvasSidebarDataStore((s) => s.refreshHistory)
  const refreshAssets = useCanvasSidebarDataStore((s) => s.refreshAssets)
  const loadMoreHistory = useCanvasSidebarDataStore((s) => s.loadMoreHistory)
  const loadMoreAssets = useCanvasSidebarDataStore((s) => s.loadMoreAssets)

  const bucket = byCanvas[canvasId]

  useEffect(() => {
    if (!token) return
    if (tab === 'history' && !bucket?.history.loaded && !bucket?.history.loading) {
      refreshHistory(canvasId, token)
      return
    }
    if (tab === 'assets' && !bucket?.assets.loaded && !bucket?.assets.loading) {
      refreshAssets(canvasId, token)
    }
  }, [tab, token, canvasId, bucket?.history.loaded, bucket?.history.loading, bucket?.assets.loaded, bucket?.assets.loading, refreshHistory, refreshAssets])

  const historyData = useMemo(() => {
    const fallback = { items: [] as CanvasHistoryItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = bucket?.history ?? fallback
    return {
      items: section.items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && loadMoreHistory(canvasId, token),
    }
  }, [bucket?.history, token, loadMoreHistory, canvasId])

  const assetsData = useMemo(() => {
    const fallback = { items: [] as CanvasAssetItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = bucket?.assets ?? fallback
    return {
      items: section.items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && loadMoreAssets(canvasId, token),
    }
  }, [bucket?.assets, token, loadMoreAssets, canvasId])

  return (
    <>
      <div className="flex flex-col h-full w-72 border-l bg-white shadow-xl shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-semibold text-zinc-800">画布记录</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors p-0.5 rounded">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {(['history', 'assets'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors',
                tab === t ? 'border-b-2 border-zinc-800 text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
              )}
            >
              {t === 'history' ? '任务记录' : '资产库'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'history' && (
            <HistoryTab data={historyData} onOpenDetail={setDetailBatchId} />
          )}
          {tab === 'assets' && (
            <AssetsTab data={assetsData} onOpenDetail={setDetailBatchId} />
          )}
        </div>
      </div>

      {/* Batch detail sheet — reuses existing component */}
      <BatchDetail
        batchId={detailBatchId}
        open={!!detailBatchId}
        onOpenChange={(open) => {
          if (!open) setDetailBatchId(null)
        }}
      />
    </>
  )
}

function HistoryTab({
  data,
  onOpenDetail,
}: {
  data: {
    items: CanvasHistoryItem[]
    loading: boolean
    loaded: boolean
    hasMore: boolean
    loadMore: () => void
  }
  onOpenDetail: (id: string) => void
}) {
  const { items, loading, loaded, hasMore, loadMore } = data

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    )
  }
  if (loaded && !loading && items.length === 0) {
    return <div className="text-center py-10 text-xs text-zinc-400">暂无任务记录</div>
  }

  return (
    <div className="divide-y">
      {items.map((batch) => {
        const st = STATUS_MAP[batch.status] ?? { label: batch.status, cls: 'bg-zinc-100 text-zinc-500' }
        return (
          <button
            key={batch.id}
            onClick={() => onOpenDetail(batch.id)}
            className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-zinc-400 font-mono">
                {batch.canvas_node_id ? `节点 …${batch.canvas_node_id.slice(-6)}` : '—'}
              </span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
            </div>
            <p className="text-xs text-zinc-700 line-clamp-2 mb-1.5">{batch.prompt || '(无提示词)'}</p>
            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
              <span>{batch.completed_count}/{batch.quantity} 张</span>
              {batch.actual_credits != null && (
                <>
                  <span>·</span>
                  <span>{batch.actual_credits} 积分</span>
                </>
              )}
              <span className="ml-auto">
                {new Date(batch.created_at).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </button>
        )
      })}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full py-3 text-xs text-zinc-500 hover:text-zinc-700 flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
          加载更多
        </button>
      )}
    </div>
  )
}

function AssetsTab({
  data,
  onOpenDetail,
}: {
  data: {
    items: CanvasAssetItem[]
    loading: boolean
    loaded: boolean
    hasMore: boolean
    loadMore: () => void
  }
  onOpenDetail: (id: string) => void
}) {
  const { items, loading, loaded, hasMore, loadMore } = data

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    )
  }
  if (loaded && !loading && items.length === 0) {
    return <div className="text-center py-10 text-xs text-zinc-400">暂无资产</div>
  }

  return (
    <div className="p-3">
      <div className="grid grid-cols-2 gap-2">
        {items.map((asset) => {
          const url = asset.storage_url || asset.original_url
          return (
            <button
              key={asset.id}
              onClick={() => onOpenDetail(asset.batch_id)}
              className="group relative rounded-lg overflow-hidden bg-zinc-100 aspect-square focus:outline-none"
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-zinc-300" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                <p className="text-[9px] text-white line-clamp-2 text-left">{asset.prompt || '—'}</p>
                <p className="text-[9px] text-white/60 mt-0.5 text-left">
                  {new Date(asset.created_at).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </button>
          )
        })}
      </div>
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="w-full mt-3 py-2 text-xs text-zinc-500 hover:text-zinc-700 flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
          加载更多
        </button>
      )}
    </div>
  )
}
