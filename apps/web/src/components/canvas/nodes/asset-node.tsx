'use client'

import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { Image as ImageIcon, X, FileVideo } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNodeData } from '@/lib/canvas/types'

export interface AssetNodeConfig {
  url: string        // S3 / proxy URL
  name?: string
  mimeType?: string  // 'image/*' | 'video/*'
}

export function AssetNode({ id, data }: { id: string; data: CanvasNodeData<AssetNodeConfig> }) {
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const cfg = data.config as AssetNodeConfig
  const isVideo = cfg.mimeType?.startsWith('video')

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-all duration-200',
        'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
      )}
      style={{ width: 160 }}
    >
      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-white text-zinc-400 hover:text-red-500 border-zinc-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      {/* Header */}
      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-zinc-50 flex items-center gap-1.5">
        {isVideo
          ? <FileVideo className="w-3 h-3 text-zinc-400 shrink-0" />
          : <ImageIcon className="w-3 h-3 text-zinc-400 shrink-0" />}
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase truncate">
          {data.label}
        </span>
      </div>

      {/* Preview */}
      <div className="p-2 bg-white rounded-b-xl">
        {cfg.url ? (
          isVideo ? (
            <video
              src={cfg.url}
              className="w-full h-auto rounded-lg block"
              muted
              preload="metadata"
            />
          ) : (
            <img
              src={cfg.url}
              alt={cfg.name ?? 'asset'}
              className="w-full h-auto rounded-lg block"
              loading="lazy"
            />
          )
        ) : (
          <div className="flex items-center justify-center rounded-lg bg-zinc-50" style={{ aspectRatio: '4/3' }}>
            <ImageIcon className="w-6 h-6 text-zinc-300" />
          </div>
        )}
        {cfg.name && (
          <p className="mt-1 text-[10px] text-zinc-400 truncate text-center">{cfg.name}</p>
        )}
      </div>

      {/* Output handle only — asset nodes have no input */}
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
}
