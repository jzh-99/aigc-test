'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Play, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { executeCanvasNode } from '@/lib/canvas/canvas-api'
import type { AppNode } from '@/lib/canvas/types'

interface Props {
  node: AppNode | null
  canvasId: string
  onClose: () => void
  onExecuted: () => void
}

export function InspectorPanel({ node, canvasId, onClose, onExecuted }: Props) {
  const token = useAuthStore((s) => s.accessToken)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const setNodeProgress = useCanvasExecutionStore((s) => s.setNodeProgress)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)

  // Local editable config state, synced from node
  const [config, setConfig] = useState<Record<string, any>>({})
  const [executing, setExecuting] = useState(false)
  const prevNodeId = useRef<string | null>(null)

  useEffect(() => {
    if (node && node.id !== prevNodeId.current) {
      setConfig({ ...(node.data.config ?? {}) })
      prevNodeId.current = node.id
    }
  }, [node])

  if (!node) return null

  const isImageGen = node.type === 'image_gen'
  const isTextInput = node.type === 'text_input'

  function handleConfigChange(key: string, value: string) {
    const next = { ...config, [key]: value }
    setConfig(next)
    updateNodeData(node!.id, { config: next })
  }

  async function handleExecute() {
    if (!canvasId || !node) return
    setExecuting(true)
    setNodeProgress(node.id, 0, true)
    try {
      await executeCanvasNode(
        {
          canvasId,
          canvasNodeId: node.id,
          type: node.type!,
          config,
          workspaceId: workspaceId ?? undefined,
        },
        token ?? undefined
      )
      toast.success('已提交生成任务')
      onExecuted()
    } catch (err: any) {
      toast.error(err.message ?? '执行失败')
      setNodeError(node.id, err.message ?? '执行失败')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div
      className={`absolute top-0 right-0 h-full w-80 bg-background border-l shadow-xl z-20 flex flex-col transition-transform duration-200 ${
        node ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <span className="font-semibold text-sm">{node.data.label}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isTextInput && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">文本内容</label>
            <textarea
              className="w-full h-32 p-2 text-sm bg-muted rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="输入提示词内容..."
              value={config.text ?? ''}
              onChange={(e) => handleConfigChange('text', e.target.value)}
            />
          </div>
        )}

        {isImageGen && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">提示词 (Prompt)</label>
              <textarea
                className="w-full h-28 p-2 text-sm bg-muted rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="描述你想生成的图片..."
                value={config.prompt ?? ''}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">模型</label>
              <select
                className="w-full p-2 text-sm bg-muted rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                value={config.model ?? 'flux'}
                onChange={(e) => handleConfigChange('model', e.target.value)}
              >
                <option value="flux">Flux</option>
                <option value="seedream">Seedream 2.0</option>
                <option value="stable-diffusion">Stable Diffusion</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">宽高比</label>
              <select
                className="w-full p-2 text-sm bg-muted rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                value={config.aspectRatio ?? '1:1'}
                onChange={(e) => handleConfigChange('aspectRatio', e.target.value)}
              >
                <option value="1:1">1:1 方形</option>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Footer — execute button for image_gen */}
      {isImageGen && (
        <div className="p-4 border-t shrink-0">
          <button
            onClick={handleExecute}
            disabled={executing || !config.prompt?.trim()}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-lg font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {executing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                执行生成
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
