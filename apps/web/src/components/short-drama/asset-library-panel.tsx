'use client'

import { useState } from 'react'
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
  const filteredAssets = allAssets.filter(asset => asset.kind === activeKind)
  const characterCount = allAssets.filter(asset => asset.kind === 'character').length
  const sceneCount = allAssets.filter(asset => asset.kind === 'scene').length

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
        <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto pr-1">
          {filteredAssets.map(asset => (
            <div key={asset.id} className="flex items-center gap-2 rounded-xl border bg-background/50 p-2">
              <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                {asset.imageUrl && (
                  <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{asset.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {asset.imageUrl ? '已出图' : '未出图'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
