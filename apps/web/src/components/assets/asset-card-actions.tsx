'use client'

import { Loader2, Download, Trash2, RotateCcw } from 'lucide-react'

interface AssetCardActionsProps {
  prompt: string
  url: string
  isVideo?: boolean
  isReusing?: boolean
  onReuse: () => void
  onDownload: () => void
  onDelete: () => void
}

/** 卡片悬停时显示的操作层（复用 / 下载 / 删除） */
export function AssetCardActions({
  prompt,
  isReusing,
  onReuse,
  onDownload,
  onDelete,
}: AssetCardActionsProps) {
  return (
    <div className="asset-hover-layer">
      <div className="absolute inset-0 flex flex-col justify-between p-3">
        {/* 顶部 prompt 预览 */}
        <p className="text-[11px] leading-relaxed text-white/80 line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
          {prompt}
        </p>
        {/* 底部操作按钮 */}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            className="asset-action-btn"
            onClick={(e) => { e.stopPropagation(); onReuse() }}
            title="复用"
            disabled={isReusing}
          >
            {isReusing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="asset-action-btn"
            onClick={(e) => { e.stopPropagation(); onDownload() }}
            title="下载"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="asset-action-btn danger"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
