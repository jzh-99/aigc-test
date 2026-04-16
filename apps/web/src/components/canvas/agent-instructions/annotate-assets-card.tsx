'use client'

import { useState } from 'react'
import type { UploadedFile, AnnotationOptions } from '@/lib/canvas/agent-types'

const ASSET_TYPE_OPTIONS = [
  { value: 'character', label: '角色设计' },
  { value: 'scene', label: '场景设计' },
  { value: 'bgm', label: '配乐' },
  { value: 'voice', label: '配音' },
  { value: 'reference', label: '参考素材' },
] as const

type AssetType = typeof ASSET_TYPE_OPTIONS[number]['value']

interface AnnotatedFile {
  nodeId: string
  name: string
  mimeType: string
  url: string
  assetType: AssetType
  role: string
}

interface Props {
  assets: UploadedFile[]
  options: AnnotationOptions
  onConfirm: (annotated: AnnotatedFile[]) => void
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('video')) return '🎬'
  if (mimeType.startsWith('audio')) return '🎵'
  return '🖼'
}

export function AnnotateAssetsCard({ assets, options, onConfirm }: Props) {
  const [rows, setRows] = useState<AnnotatedFile[]>(() =>
    assets.map((a) => ({
      ...a,
      assetType: 'reference' as AssetType,
      role: '',
    })),
  )

  const update = (index: number, patch: Partial<AnnotatedFile>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const roleOptions = (assetType: AssetType): string[] => {
    if (assetType === 'character') return options.roles
    if (assetType === 'scene') return options.scenes
    if (assetType === 'voice' || assetType === 'bgm') return options.segments
    return []
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      <p className="text-foreground font-medium">已上传 {assets.length} 个文件，请告诉我它们的用途：</p>

      <div className="space-y-2">
        {rows.map((row, i) => {
          const opts = roleOptions(row.assetType)
          return (
            <div key={row.nodeId} className="flex items-center gap-2">
              <span className="text-base shrink-0">{fileIcon(row.mimeType)}</span>
              <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{row.name}</span>
              <select
                value={row.assetType}
                onChange={(e) => update(i, { assetType: e.target.value as AssetType, role: '' })}
                className="text-xs bg-background border border-border rounded px-1.5 py-0.5 shrink-0"
              >
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {opts.length > 0 ? (
                <select
                  value={row.role}
                  onChange={(e) => update(i, { role: e.target.value })}
                  className="text-xs bg-background border border-border rounded px-1.5 py-0.5 shrink-0"
                >
                  <option value="">选择...</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={row.role}
                  onChange={(e) => update(i, { role: e.target.value })}
                  placeholder="备注"
                  className="text-xs bg-background border border-border rounded px-1.5 py-0.5 w-16 shrink-0"
                />
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => onConfirm(rows)}
        className="w-full text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors"
      >
        确认，开始搭建 →
      </button>
    </div>
  )
}
