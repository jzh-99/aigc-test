'use client'

import { Loader2, Download, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AssetCardActionsProps {
  prompt: string
  url: string
  isVideo?: boolean
  isReusing?: boolean
  onReuse: () => void
  onDownload: () => void
  onDelete: () => void
}

/** 卡片 hover 时显示的操作按钮层（复用/下载/删除） */
export function AssetCardActions({
  prompt,
  isReusing,
  onReuse,
  onDownload,
  onDelete,
}: AssetCardActionsProps) {
  return (
    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2 pointer-events-auto">
        {/* 顶部 prompt 预览 */}
        <p className="text-[11px] text-white/90 line-clamp-2 leading-snug drop-shadow">
          {prompt}
        </p>
        {/* 底部操作按钮 */}
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
            onClick={(e) => { e.stopPropagation(); onReuse() }}
            title="复用"
            disabled={isReusing}
          >
            {isReusing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white border-0"
            onClick={(e) => { e.stopPropagation(); onDownload() }}
            title="下载"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 bg-black/50 hover:bg-red-600/80 text-white border-0"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
