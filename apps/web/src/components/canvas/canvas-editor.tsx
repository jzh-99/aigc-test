'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactFlow, {
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { nodeRegistry } from '@/lib/canvas/registry'
import { useCanvasPoller } from '@/hooks/canvas/use-canvas-poller'
import { useCanvasAutosave } from '@/hooks/canvas/use-canvas-autosave'
import { useAuthStore } from '@/stores/auth-store'
import { uploadAssetFile } from '@/lib/canvas/canvas-api'
import { toast } from 'sonner'
import { NodeParamPanel } from './node-param-panel'
import type { AppNode } from '@/lib/canvas/types'

const nodeTypes = nodeRegistry.getReactFlowTypesMapping()

const NODE_CANVAS_H: Record<string, number> = {
  image_gen: 260,
  text_input: 130,
  asset: 200,
}

function FloatingParamPanel({
  node,
  canvasId,
  wrapperRef,
  onClose,
  onExecuted,
}: {
  node: AppNode
  canvasId: string
  wrapperRef: React.RefObject<HTMLDivElement>
  onClose: () => void
  onExecuted: () => void
}) {
  const transform = useStore((s) => s.transform)
  const rect = wrapperRef.current?.getBoundingClientRect()
  if (!rect) return null

  const [tx, ty, zoom] = transform
  const PANEL_W = 640
  const NODE_W = 280

  const sx = rect.left + node.position.x * zoom + tx
  const sy = rect.top + node.position.y * zoom + ty

  const nodeScreenH = (NODE_CANVAS_H[node.type ?? ''] ?? 200) * zoom
  const rawTop = sy + nodeScreenH + 8

  const nodeScreenW = NODE_W * zoom
  let left = sx + nodeScreenW / 2 - PANEL_W / 2
  left = Math.max(rect.left + 8, Math.min(left, window.innerWidth - PANEL_W - 8))

  const top = Math.min(rawTop, window.innerHeight - 200)

  return createPortal(
    <div className="fixed z-50 drop-shadow-2xl" style={{ top, left, width: PANEL_W }}>
      <NodeParamPanel
        node={node}
        canvasId={canvasId}
        onClose={onClose}
        onExecuted={onExecuted}
      />
    </div>,
    document.body
  )
}

function Flow({
  canvasId,
  onSave,
  saving,
  lastSaved,
}: {
  canvasId: string
  onSave: () => void
  saving: boolean
  lastSaved: Date | null
}) {
  const store = useCanvasStructureStore()
  const { project } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const token = useAuthStore((s) => s.accessToken)
  const [uploading, setUploading] = useState(false)

  const { kickPoll } = useCanvasPoller(canvasId)

  const handleAddNode = useCallback((type: string) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = project({ x: rect.width / 2, y: rect.height / 2 })
    store.addNode(type, position)
  }, [store, project])

  // Delete key: remove selected node
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNodeId) return
      // Don't fire when typing in input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeNodes([selectedNodeId])
        setSelectedNodeId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, store])

  // Drop file onto canvas → create asset node
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    )
    if (!files.length) return
    if (!token) { toast.error('请先登录'); return }

    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return

    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const position = project({
          x: e.clientX - rect.left + i * 180,
          y: e.clientY - rect.top,
        })
        try {
          const url = await uploadAssetFile(file, token)
          const nodeId = `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`
          store.addNodeWithConfig('asset', position, {
            url,
            name: file.name,
            mimeType: file.type,
          }, nodeId)
        } catch (err: any) {
          toast.error(`上传 ${file.name} 失败: ${err.message}`)
        }
      }
    } finally {
      setUploading(false)
    }
  }, [token, project, store])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const selectedNode = store.nodes.find((n) => n.id === selectedNodeId) ?? null

  const saveLabel = saving
    ? '保存中…'
    : lastSaved
    ? `已保存 ${lastSaved.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '保存'

  return (
    <div
      className="w-full h-full relative"
      ref={wrapperRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{
        background: '#fafafa',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
    >
      {uploading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="bg-white rounded-xl px-4 py-2 shadow-lg text-sm font-medium text-zinc-700">上传中…</div>
        </div>
      )}

      <ReactFlow
        nodes={store.nodes}
        edges={store.edges}
        onNodesChange={store.onNodesChange}
        onEdgesChange={store.onEdgesChange}
        onConnect={store.onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) =>
          setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
        }
        onPaneClick={() => setSelectedNodeId(null)}
        fitView
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#fafafa' }}
        deleteKeyCode={null} // we handle delete ourselves
      >
        <Controls
          className="!bg-white !border-zinc-200 [&>button]:!bg-white [&>button]:!border-zinc-200 [&>button]:!text-zinc-500 [&>button:hover]:!bg-zinc-100 [&>button:hover]:!text-zinc-800"
        />
        <MiniMap
          nodeColor={(n) => (n.type === 'text_input' ? '#eab308' : n.type === 'asset' ? '#22c55e' : '#3b82f6')}
          maskColor="rgba(250,250,250,0.7)"
          className="!bg-white !border !border-zinc-200 rounded-lg shadow-md"
        />
        <Panel
          position="top-left"
          className="bg-white/90 backdrop-blur-md p-2 rounded-xl border border-zinc-200 shadow-md flex gap-2"
        >
          <button
            onClick={() => handleAddNode('text_input')}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900 rounded-lg border border-zinc-200 transition-colors"
          >
            + 纯文本
          </button>
          <button
            onClick={() => handleAddNode('image_gen')}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow transition-colors"
          >
            + AI生图
          </button>
        </Panel>
        <Panel position="top-right">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-zinc-50 text-zinc-500 rounded-lg border border-zinc-200 shadow-sm transition-colors disabled:opacity-60 min-w-[80px] justify-center"
          >
            {saving && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />}
            {saveLabel}
          </button>
        </Panel>
      </ReactFlow>

      {selectedNode && (
        <FloatingParamPanel
          node={selectedNode}
          canvasId={canvasId}
          wrapperRef={wrapperRef}
          onClose={() => setSelectedNodeId(null)}
          onExecuted={kickPoll}
        />
      )}
    </div>
  )
}

export function CanvasEditor({ canvasId }: { canvasId: string }) {
  const { save, saving, lastSaved } = useCanvasAutosave(canvasId)
  return (
    <ReactFlowProvider>
      <Flow canvasId={canvasId} onSave={save} saving={saving} lastSaved={lastSaved} />
    </ReactFlowProvider>
  )
}
