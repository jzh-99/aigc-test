import { ImageIcon } from 'lucide-react'
import type { AssetConfig } from '@/lib/canvas/types'

interface AssetPanelProps {
  config: AssetConfig
}

export function AssetPanel({ config }: AssetPanelProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ImageIcon className="w-3.5 h-3.5" />
        <span>素材节点 · {config.mimeType?.startsWith('video') ? '视频' : config.mimeType?.startsWith('audio') ? '音频' : '图片'}</span>
      </div>

      {config.url && config.mimeType?.startsWith('video') && (
        <video src={config.url} controls className="w-full rounded-lg max-h-48" />
      )}
      {config.url && config.mimeType?.startsWith('audio') && (
        <audio src={config.url} controls className="w-full" />
      )}
      {config.url && !config.mimeType?.startsWith('video') && !config.mimeType?.startsWith('audio') && (
        <img src={config.url} alt={config.name} className="w-full rounded-lg object-contain max-h-48" />
      )}
      {config.name && <p className="text-[10px] text-muted-foreground truncate">{config.name}</p>}
    </div>
  )
}
