'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, ChevronDown, ImageIcon, Film, Music, Download } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { BatchDetail } from '@/components/history/batch-detail'
import { cn } from '@/lib/utils'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import type { CanvasAssetItem, CanvasHistoryItem } from '@/lib/canvas/canvas-api'

type Tab = 'history' | 'assets'
type AssetSubTab = 'image' | 'video' | 'audio'
type PreviewType = 'image' | 'video' | 'audio'
type HistoryMediaType = 'image' | 'video' | 'audio'

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

const AUDIO_HISTORY_MODULES = new Set(['tts', 'music', 'music_voice_clone'])
const MEDIA_HISTORY_MODULES = new Set(['image', 'video', ...AUDIO_HISTORY_MODULES])

function getHistoryMediaType(batch: CanvasHistoryItem): HistoryMediaType | null {
  if (!batch.module) return 'image'
  if (AUDIO_HISTORY_MODULES.has(batch.module)) return 'audio'
  if (batch.module === 'video') return 'video'
  if (batch.module === 'image') return 'image'
  return null
}

function getHistoryUnit(type: HistoryMediaType): string {
  return type === 'image' ? '张' : '条'
}

export function CanvasHistorySidebar({ canvasId, onClose }: Props) {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const [tab, setTab] = useState<Tab>('history')
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; type: PreviewType } | null>(null)

  const byCanvas = useCanvasSidebarDataStore((s) => s.byCanvas)
  const refreshHistory = useCanvasSidebarDataStore((s) => s.refreshHistory)
  const refreshAssets = useCanvasSidebarDataStore((s) => s.refreshAssets)
  const refreshVideoAssets = useCanvasSidebarDataStore((s) => s.refreshVideoAssets)
  const refreshAudioAssets = useCanvasSidebarDataStore((s) => s.refreshAudioAssets)
  const loadMoreHistory = useCanvasSidebarDataStore((s) => s.loadMoreHistory)
  const loadMoreAssets = useCanvasSidebarDataStore((s) => s.loadMoreAssets)
  const loadMoreVideoAssets = useCanvasSidebarDataStore((s) => s.loadMoreVideoAssets)
  const loadMoreAudioAssets = useCanvasSidebarDataStore((s) => s.loadMoreAudioAssets)
  const setAssetSubTab = useCanvasSidebarDataStore((s) => s.setAssetSubTab)

  const bucket = byCanvas[canvasId]
  const assetSubTab = bucket?.assetSubTab ?? 'image'

  useEffect(() => {
    if (!token) return
    if (tab === 'history' && !bucket?.history.loaded && !bucket?.history.loading) {
      refreshHistory(canvasId, token)
      return
    }
    if (tab === 'assets' && assetSubTab === 'image' && !bucket?.assets.loaded && !bucket?.assets.loading) {
      refreshAssets(canvasId, token)
      return
    }
    if (tab === 'assets' && assetSubTab === 'video' && !bucket?.videoAssets.loaded && !bucket?.videoAssets.loading) {
      refreshVideoAssets(canvasId, token)
      return
    }
    if (tab === 'assets' && assetSubTab === 'audio' && !bucket?.audioAssets.loaded && !bucket?.audioAssets.loading) {
      refreshAudioAssets(canvasId, token)
    }
  }, [
    tab,
    token,
    canvasId,
    assetSubTab,
    bucket?.history.loaded,
    bucket?.history.loading,
    bucket?.assets.loaded,
    bucket?.assets.loading,
    bucket?.videoAssets.loaded,
    bucket?.videoAssets.loading,
    bucket?.audioAssets.loaded,
    bucket?.audioAssets.loading,
    refreshHistory,
    refreshAssets,
    refreshVideoAssets,
    refreshAudioAssets,
  ])

  const historyData = useMemo(() => {
    const fallback = { items: [] as CanvasHistoryItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = bucket?.history ?? fallback
    const items = section.items.filter((item) => !item.module || MEDIA_HISTORY_MODULES.has(item.module))
    return {
      items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && loadMoreHistory(canvasId, token),
    }
  }, [bucket?.history, token, loadMoreHistory, canvasId])

  const assetsData = useMemo(() => {
    const fallback = { items: [] as CanvasAssetItem[], loading: true, loaded: false, nextCursor: null as string | null }
    const section = assetSubTab === 'video'
      ? (bucket?.videoAssets ?? fallback)
      : assetSubTab === 'audio'
        ? (bucket?.audioAssets ?? fallback)
        : (bucket?.assets ?? fallback)
    return {
      subTab: assetSubTab,
      items: section.items,
      loading: token ? section.loading : true,
      loaded: section.loaded,
      hasMore: !!section.nextCursor,
      loadMore: () => token && (
        assetSubTab === 'video'
          ? loadMoreVideoAssets(canvasId, token)
          : assetSubTab === 'audio'
            ? loadMoreAudioAssets(canvasId, token)
            : loadMoreAssets(canvasId, token)
      ),
    }
  }, [bucket?.assets, bucket?.videoAssets, bucket?.audioAssets, assetSubTab, token, loadMoreAssets, loadMoreVideoAssets, loadMoreAudioAssets, canvasId])


  return (
    <>
      <div className="flex flex-col h-full w-72 border-l bg-background shadow-xl shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-semibold text-foreground">画布记录</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {(['history', 'assets'] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={t === 'history' ? 'canvas-sidebar-tab-history' : 'canvas-sidebar-tab-assets'}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors',
                tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
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
              onSubTabChange={(next) => setAssetSubTab(canvasId, next)}
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
          ) : lightbox.type === 'audio' ? (
            <div className="w-[90vw] max-w-[420px] rounded-lg bg-background p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <audio src={lightbox.url} controls autoPlay className="w-full" />
            </div>
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
    items: CanvasHistoryItem[]
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
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (loaded && !loading && items.length === 0) {
    return <div className="text-center py-10 text-xs text-muted-foreground">暂无任务记录</div>
  }

  return (
    <div className="divide-y">
      {items.map((batch) => {
        const st = STATUS_MAP[batch.status] ?? { label: batch.status, cls: 'bg-muted text-muted-foreground' }
        const mediaType = getHistoryMediaType(batch)
        if (!mediaType) return null
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
            data-testid={`canvas-history-item-${batch.id}`}
            onClick={() => onOpenDetail(batch.id)}
            className="w-full text-left px-4 py-3 hover:bg-muted transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground font-mono">
                {batch.canvas_node_id ? `节点 …${batch.canvas_node_id.slice(-6)}` : '—'}
              </span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
            </div>
            <p className="text-xs text-foreground line-clamp-2 mb-1.5">{batch.prompt || '(无提示词)'}</p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{batch.completed_count}/{batch.quantity} {getHistoryUnit(mediaType)}</span>
              {statusHint && (
                <>
                  <span>·</span>
                  <span>{statusHint}</span>
                </>
              )}
              {batch.actual_credits != null && (
                <>
                  <span>·</span>
                  <span>{batch.actual_credits} A豆</span>
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
          className="w-full py-3 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 disabled:opacity-50"
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
    subTab: AssetSubTab
    items: CanvasAssetItem[]
    loading: boolean
    loaded: boolean
    hasMore: boolean
    loadMore: () => void
  }
  onSubTabChange: (subTab: AssetSubTab) => void
  onOpenDetail: (id: string) => void
  onOpenLightbox: (url: string, type: PreviewType) => void
}) {
  const { subTab, items, loading, loaded, hasMore, loadMore } = data

  return (
    <div className="p-3">
      <div className="mb-3 flex rounded-lg border border-border overflow-hidden">
        <button
          data-testid="canvas-assets-subtab-image"
          onClick={() => onSubTabChange('image')}
          className={cn(
            'flex-1 py-1.5 text-[11px] font-medium transition-colors',
            subTab === 'image' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
          )}
        >
          图片
        </button>
        <button
          data-testid="canvas-assets-subtab-video"
          onClick={() => onSubTabChange('video')}
          className={cn(
            'flex-1 py-1.5 text-[11px] font-medium transition-colors',
            subTab === 'video' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
          )}
        >
          视频
        </button>
        <button
          data-testid="canvas-assets-subtab-audio"
          onClick={() => onSubTabChange('audio')}
          className={cn(
            'flex-1 py-1.5 text-[11px] font-medium transition-colors',
            subTab === 'audio' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
          )}
        >
          音频
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : loaded && !loading && items.length === 0 ? (
        <div className="text-center py-10 text-xs text-muted-foreground">
          {subTab === 'video' ? '暂无视频资产' : subTab === 'audio' ? '暂无音频资产' : '暂无图片资产'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {items.map((asset) => {
              const url = asset.storage_url || asset.original_url
              const thumbnailUrl = asset.thumbnail_url || null
              const isVideo = subTab === 'video' || asset.type?.startsWith('video')
              const isAudio = subTab === 'audio' || asset.type?.startsWith('audio')
              return (
                <button
                  key={asset.id}
                  data-testid={`canvas-asset-item-${asset.id}`}
                  draggable
                  onDragStart={(e) => {
                    const dragUrl = url || ''
                    const dragType = isAudio ? 'audio' : isVideo ? 'video' : 'image'
                    e.dataTransfer.setData('application/x-canvas-asset', JSON.stringify({ url: dragUrl, type: dragType }))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => (url ? onOpenLightbox(url, isAudio ? 'audio' : isVideo ? 'video' : 'image') : onOpenDetail(asset.batch_id))}
                  className="group relative rounded-lg overflow-hidden bg-muted aspect-square focus:outline-none cursor-grab active:cursor-grabbing"
                >
                  {url ? (
                    isAudio ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-emerald-50 text-emerald-700">
                        <Music className="w-6 h-6" />
                        <span className="text-[10px] font-medium">音频资产</span>
                      </div>
                    ) : isVideo && !thumbnailUrl ? (
                      <video src={url} muted preload="metadata" playsInline className="w-full h-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnailUrl ?? url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {isAudio ? <Music className="w-5 h-5 text-muted-foreground/50" /> : isVideo ? <Film className="w-5 h-5 text-muted-foreground/50" /> : <ImageIcon className="w-5 h-5 text-muted-foreground/50" />}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                    {url && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const a = document.createElement('a')
                          a.href = url
                          a.download = asset.prompt || 'asset'
                          a.target = '_blank'
                          a.rel = 'noopener noreferrer'
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                        }}
                        className="absolute top-1.5 right-1.5 p-1 rounded bg-black/40 hover:bg-black/70 transition-colors"
                        title="下载"
                      >
                        <Download className="w-3 h-3 text-white" />
                      </button>
                    )}
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
              className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 disabled:opacity-50"
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
