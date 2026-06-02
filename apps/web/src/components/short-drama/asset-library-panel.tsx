'use client'

import { useState } from 'react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import type { ShortDramaAsset } from '@aigc/types'

interface AssetLibraryPanelProps {
  assets: ShortDramaAsset[]
  episodeNumber: number
}

export function AssetLibraryPanel({ assets, episodeNumber }: AssetLibraryPanelProps) {
  const globalAssets = assets.filter(a => a.scope === 'global')
  const episodeAssets = assets.filter(a => a.scope === 'episode' && a.episodeNumber === episodeNumber)
  const allAssets = [...globalAssets, ...episodeAssets].filter(asset => asset.kind === 'character' || asset.kind === 'scene')
  const [activeKind, setActiveKind] = useState<'character' | 'scene'>('character')
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const filteredAssets = allAssets.filter(asset => asset.kind === activeKind)
  const characterCount = allAssets.filter(asset => asset.kind === 'character').length
  const sceneCount = allAssets.filter(asset => asset.kind === 'scene').length
  const previewAsset = previewAssetId ? allAssets.find(asset => asset.id === previewAssetId) : null
  const imageFrameClass = activeKind === 'character' ? 'aspect-[9/16]' : 'aspect-video'
  const imageFitClass = activeKind === 'character' ? 'object-contain' : 'object-cover'

  return (
    <aside className="rounded-2xl border bg-card/80 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">素材库</h3>
        <span className="text-[11px] text-muted-foreground">本集</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {[
          { id: 'character' as const, label: '角色', count: characterCount },
          { id: 'scene' as const, label: '场景', count: sceneCount },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveKind(tab.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              activeKind === tab.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>
      {allAssets.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无素材</p>
      ) : (
        <div className="grid max-h-[calc(100vh-18rem)] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {filteredAssets.map(asset => (
            <button
              key={asset.id}
              type="button"
              onClick={() => asset.imageUrl && setPreviewAssetId(asset.id)}
              disabled={!asset.imageUrl}
              className="overflow-hidden rounded-xl border bg-background/60 text-left shadow-sm transition-colors hover:border-primary/30 disabled:cursor-default disabled:hover:border-border"
              aria-label={asset.imageUrl ? `放大查看${asset.name}` : asset.name}
            >
              <div className={`group relative block w-full overflow-hidden bg-muted/40 text-left dark:bg-slate-900/70 ${imageFrameClass}`}>
                <span className={`absolute left-1.5 top-1.5 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm ${
                  asset.imageUrl
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                    : 'bg-muted text-muted-foreground dark:bg-slate-800 dark:text-slate-300'
                }`}>
                  {asset.imageUrl ? '已出图' : '未出图'}
                </span>
                {asset.imageUrl ? (
                  <>
                    <img src={asset.imageUrl} alt={asset.name} className={`h-full w-full transition-transform duration-300 group-hover:scale-105 ${imageFitClass}`} />
                    <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                  </>
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                    暂无图片
                  </span>
                )}
              </div>
              <div className="space-y-1.5 p-2">
                <div className="text-xs font-semibold leading-4 text-foreground">{asset.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {previewAsset?.imageUrl && (
        <ImageLightbox
          url={previewAsset.imageUrl}
          alt={previewAsset.name}
          onClose={() => setPreviewAssetId(null)}
          footer={
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{previewAsset.name}</div>
            </div>
          }
        />
      )}
    </aside>
  )
}
