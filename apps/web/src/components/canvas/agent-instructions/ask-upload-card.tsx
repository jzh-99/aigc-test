'use client'

import { useState, useEffect, MutableRefObject } from 'react'
import { Upload, X, MousePointerClick } from 'lucide-react'
import type { AssetTypeHint } from '@/lib/canvas/agent-types'
import { uploadAssetFile } from '@/lib/canvas/canvas-api'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { isAssetConfig } from '@/lib/canvas/types'
import { toast } from 'sonner'

interface ReferencedNode {
  nodeId: string
  name: string
  mimeType: string
  url: string
}

interface Props {
  assetTypes: AssetTypeHint[]
  canvasId: string
  onUploaded: (files: ReferencedNode[]) => void
  onSkip: () => void
  onNodeSelectedRef?: MutableRefObject<((nodeId: string) => boolean) | null>
}

function mimeIcon(mimeType: string) {
  if (mimeType.startsWith('video')) return '🎬'
  if (mimeType.startsWith('audio')) return '🎵'
  return '🖼'
}

export function AskUploadCard({ assetTypes, canvasId, onUploaded, onSkip, onNodeSelectedRef }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const addNodeWithConfig = useCanvasStructureStore((s) => s.addNodeWithConfig)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [picking, setPicking] = useState(false)
  const [referenced, setReferenced] = useState<ReferencedNode[]>([])

  // While picking mode is active, intercept canvas node clicks
  useEffect(() => {
    if (!onNodeSelectedRef || !picking) return

    const prev = onNodeSelectedRef.current
    onNodeSelectedRef.current = (nodeId: string): boolean => {
      const nodes = useCanvasStructureStore.getState().nodes
      const execNodes = useCanvasExecutionStore.getState().nodes
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return false

      let url: string | undefined
      let name: string = node.data.label
      let mimeType = 'image/png'

      if (node.type === 'asset' && isAssetConfig(node.data.config)) {
        url = node.data.config.url ?? undefined
        name = node.data.config.name ?? node.data.label
        mimeType = node.data.config.mimeType ?? 'image/png'
      } else if (node.type === 'image_gen' || node.type === 'video_gen') {
        const execState = execNodes[nodeId]
        const output = execState?.outputs.find((o) => o.id === execState.selectedOutputId)
        url = output?.url
        mimeType = node.type === 'video_gen' ? 'video/mp4' : 'image/png'
      }

      if (!url) {
        toast.error('该节点暂无可用输出')
        return true  // still consumed — don't open param panel
      }

      setReferenced((prev) => {
        if (prev.some((r) => r.nodeId === nodeId)) return prev
        return [...prev, { nodeId, name, mimeType, url: url! }]
      })
      return true
    }

    return () => { onNodeSelectedRef.current = prev }
  }, [onNodeSelectedRef, picking])

  const removeRef = (nodeId: string) =>
    setReferenced((prev) => prev.filter((r) => r.nodeId !== nodeId))

  const handleConfirm = () => {
    if (referenced.length > 0) onUploaded(referenced)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const results: ReferencedNode[] = []
    try {
      for (const file of Array.from(files)) {
        const url = await uploadAssetFile(file, token ?? undefined)
        const nodeId = `agent_asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        addNodeWithConfig('asset', { x: 100, y: 100 }, { url, name: file.name, mimeType: file.type }, nodeId)
        results.push({ nodeId, name: file.name, mimeType: file.type, url })
      }
      onUploaded(results)
    } catch {
      toast.error('上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      <p className="text-foreground font-medium">在开始之前，你是否已有以下素材？</p>
      <div className="space-y-1">
        {assetTypes.map((a) => (
          <div key={a.key} className="flex items-center gap-2 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
            {a.label}{a.optional ? '（可选）' : ''}
          </div>
        ))}
      </div>

      {/* Click-to-reference from canvas */}
      {onNodeSelectedRef && (
        <div className="space-y-2">
          <button
            onClick={() => setPicking((v) => !v)}
            className={`w-full flex items-center justify-center gap-1.5 text-xs rounded-md py-1.5 border transition-colors ${
              picking
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
            }`}
          >
            <MousePointerClick className="w-3.5 h-3.5" />
            {picking ? '点击画布节点以引用（再次点击结束）' : '从画布中点选素材'}
          </button>

          {referenced.length > 0 && (
            <div className="space-y-1">
              {referenced.map((r) => (
                <div key={r.nodeId} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-md px-2 py-1">
                  <span className="text-sm">{mimeIcon(r.mimeType)}</span>
                  <span className="text-xs truncate flex-1 text-primary">{r.name}</span>
                  <button onClick={() => removeRef(r.nodeId)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={handleConfirm}
                className="w-full text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors"
              >
                使用已选 {referenced.length} 个素材 →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Upload new */}
      <label
        className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      >
        <input type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} disabled={uploading} />
        <Upload className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {uploading ? '上传中...' : '拖拽或点击上传新素材'}
        </span>
      </label>

      <button
        onClick={onSkip}
        className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        没有，直接开始 →
      </button>
    </div>
  )
}
