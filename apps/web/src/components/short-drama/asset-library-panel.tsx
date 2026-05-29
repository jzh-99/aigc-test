'use client'

import type { ShortDramaAsset } from '@aigc/types'

interface AssetLibraryPanelProps {
  assets: ShortDramaAsset[]
  episodeNumber: number
}

export function AssetLibraryPanel({ assets, episodeNumber }: AssetLibraryPanelProps) {
  const globalAssets = assets.filter(a => a.scope === 'global')
  const episodeAssets = assets.filter(a => a.scope === 'episode' && a.episodeNumber === episodeNumber)
  const allAssets = [...globalAssets, ...episodeAssets]

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">素材库</h3>
      {allAssets.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无素材</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {allAssets.map(asset => (
            <div key={asset.id} className="flex items-center gap-2 p-2 rounded border">
              <div className="w-10 h-10 rounded bg-muted flex-shrink-0 overflow-hidden">
                {asset.imageUrl && (
                  <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{asset.name}</div>
                <div className="text-xs text-muted-foreground">{asset.kind}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
