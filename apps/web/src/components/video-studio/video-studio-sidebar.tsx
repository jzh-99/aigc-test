'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, ChevronDown, ImageIcon, Film } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { BatchDetail } from '@/components/history/batch-detail'
import { cn } from '@/lib/utils'
import { useVideoStudioSidebarDataStore } from '@/stores/video-studio/sidebar-data-store'
import type { VideoStudioAssetItem, VideoStudioHistoryItem } from '@/lib/video-studio-api'

type Tab = 'history' | 'assets'

interface Props {
  projectId: string
  onClose: () => void
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  completed: { label: '完成', cls: 'bg-green-100 text-green-700' },
  processing: { label: '生成中', cls: 'bg-blue-100 text-blue-700' },
  pending: { label: '排队中', cls: 'bg-yellow-100 text-yellow-700' },
  failed: { label: '失败', cls: 'bg-red-100 text-red-600' },
}

export function VideoStudioSidebar({ projectId, onClose }: Props) {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const [tab, setTab] = useState<Tab>('history')
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; type: 'image' | 'video' } | null>(null)

  const byProject = useVideoStudioSidebarDataStore((s) => s.byProject)
  const refreshHistory = useVideoStudioSidebarDataStore((s) => s.refreshHistory)
  const refreshAssets = useVideoStudioSidebarDataStore((s) => s.refreshAssets)
  const refreshVideoAssets = useVideoStudioSidebarDataStore((s) => s.refreshVideoAssets)
  const loadMoreHistory = useVideoStudioSidebarDataStore((s) => s.loadMoreHistory)
  const loadMoreAssets = useVideoStudioSidebarDataStore((s) => s.loadMoreAssets)
  const loadMoreVideoAssets = useVideoStudioSidebarDataStore((s) => s.loadMoreVideoAssets)
  const setAssetSubTab = useVideoStudioSidebarDataStore((s) => s.setAssetSubTab)

  const bucket = byProject[projectId]
  const assetSubTab = bucket?.assetSubTab ?? 'image'

  useEffect(() => {
    if (!token) return
    if (tab === 'history' && !bucket?.history.loaded && !bucket?.history.loading) {
      refreshHistory(projectId, token)
      return
    }
    if (tab === 'assets' && assetSubTab === 'image' && !bucket?.assets.loaded && !bucket?.assets.loading) {
      refreshAssets(projectId, token)
      return
    }
    if (tab === 'assets' && assetSubTab === 'video' && !bucket?.videoAssets.loaded && !bucket?.videoAssets.loading) {
      refreshVideoAssets(projectId, token)
    }
  }, [
    tab,
    token,
    projectId,
    assetSubTab,
    bucket?.history.loaded,
    bucket?.history.loading,
    bucket?.assets.loaded,
    bucket?.assets.loading,
    bucket?.videoAssets.loaded,
    bucket?.videoAssets.loading,
    refreshHistory,
    refreshAssets,
    refreshVideoAssets,
  ])

  const historyData = useMemo(() => {
    const fallback = { items: [] as VideoStudioHistoryItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = bucket?.history ?? fallback
    return {
      items: section.items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && loadMoreHistory(projectId, token),
    }
  }, [bucket?.history, token, loadMoreHistory, projectId])

  const assetsData = useMemo(() => {
    const fallback = { items: [] as VideoStudioAssetItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = assetSubTab === 'video' ? (bucket?.videoAssets ?? fallback) : (bucket?.assets ?? fallback)
    return {
      subTab: assetSubTab,
      items: section.items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && (assetSubTab === 'video' ? loadMoreVideoAssets(projectId, token) : loadMoreAssets(projectId, token)),
    }
  }, [bucket?.assets, bucket?.videoAssets, assetSubTab, token, loadMoreAssets, loadMoreVideoAssets, projectId])


  return (
    <>
      <div className="flex flex-col h-full w-72 border-l bg-white shadow-xl shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-semibold text-zinc-800">项目记录</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors p-0.5 rounded">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {(['history', 'assets'] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={t === 'history' ? 'video-studio-sidebar-tab-history' : 'video-studio-sidebar-tab-assets'}
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
            <AssetsTab
              data={assetsData}
              onSubTabChange={(next) => setAssetSubTab(projectId, next)}
              onOpenDetail={setDetailBatchId}
              onOpenLightbox={(url, type) => setLightbox({ url, type })}
            />
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
        onApplied={() => router.push('/generation')}
        onReferenceAdded={() => router.push('/generation')}
      />

      {/* Lightbox for asset preview */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white p-1"
            onClick={() => setLightbox(null)}
          >
            <X size={24} />
          </button>
          {lightbox.type === 'video' ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[90vh] rounded shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.url}
              alt=""
              className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  )
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`
}

function HistoryTab({
  data,
  onOpenDetail,
}: {
  data: {
    items: VideoStudioHistoryItem[]
    loading: boolean
    loaded: boolean
    hasMore: boolean
    loadMore: () => void
  }
  onOpenDetail: (id: string) => void
}) {
  const { items, loading, loaded, hasMore, loadMore } = data
  const hasProcessing = items.some((item) => item.status === 'processing')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasProcessing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasProcessing])

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
        const statusHint = batch.status === 'pending'
          ? typeof batch.queue_position === 'number'
            ? `前方还有 ${batch.queue_position} 个任务`
            : '等待调度'
          : batch.status === 'processing' && batch.processing_started_at
            ? `已用时 ${formatElapsed(now - new Date(batch.processing_started_at).getTime())}`
            : null
        return (
          <button
            key={batch.id}
            data-testid={`video-studio-history-item-${batch.id}`}
            onClick={() => onOpenDetail(batch.id)}
            className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-zinc-400 font-mono">
                项目任务
              </span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
            </div>
            <p className="text-xs text-zinc-700 line-clamp-2 mb-1.5">{batch.prompt || '(无提示词)'}</p>
            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
              <span>{batch.completed_count}/{batch.quantity} {(batch.module === 'video' || /^(seedance-|veo)/i.test(batch.model || '')) ? '条' : '张'}</span>
              {statusHint && (
                <>
                  <span>·</span>
                  <span>{statusHint}</span>
                </>
              )}
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
  onSubTabChange,
  onOpenDetail,
  onOpenLightbox,
}: {
  data: {
    subTab: 'image' | 'video'
    items: VideoStudioAssetItem[]
    loading: boolean
    loaded: boolean
    hasMore: boolean
    loadMore: () => void
  }
  onSubTabChange: (subTab: 'image' | 'video') => void
  onOpenDetail: (id: string) => void
  onOpenLightbox: (url: string, type: 'image' | 'video') => void
}) {
  const { subTab, items, loading, loaded, hasMore, loadMore } = data

  return (
    <div className="p-3">
      <div className="mb-3 flex rounded-lg border border-zinc-200 overflow-hidden">
        <button
          data-testid="canvas-assets-subtab-image"
          onClick={() => onSubTabChange('image')}
          className={cn(
            'flex-1 py-1.5 text-[11px] font-medium transition-colors',
            subTab === 'image' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
          )}
        >
          图片
        </button>
        <button
          data-testid="canvas-assets-subtab-video"
          onClick={() => onSubTabChange('video')}
          className={cn(
            'flex-1 py-1.5 text-[11px] font-medium transition-colors',
            subTab === 'video' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
          )}
        >
          视频
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      ) : loaded && !loading && items.length === 0 ? (
        <div className="text-center py-10 text-xs text-zinc-400">{subTab === 'video' ? '暂无视频资产' : '暂无图片资产'}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {items.map((asset) => {
              const url = asset.storage_url || asset.original_url
              const isVideo = subTab === 'video' || asset.type?.startsWith('video')
              return (
                <button
                  key={asset.id}
                  data-testid={`canvas-asset-item-${asset.id}`}
                  onClick={() => (url ? onOpenLightbox(url, isVideo ? 'video' : 'image') : onOpenDetail(asset.batch_id))}
                  className="group relative rounded-lg overflow-hidden bg-zinc-100 aspect-square focus:outline-none"
                >
                  {url ? (
                    isVideo ? (
                      <video src={url} muted preload="metadata" playsInline className="w-full h-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {isVideo ? <Film className="w-5 h-5 text-zinc-300" /> : <ImageIcon className="w-5 h-5 text-zinc-300" />}
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
        </>
      )}
    </div>
  )
}
