'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactFlow, {
  Controls,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useShallow } from 'zustand/react/shallow'
import { nodeRegistry } from '@/lib/canvas/registry'
import { useCanvasPoller } from '@/hooks/canvas/use-canvas-poller'
import { useCanvasAutosave } from '@/hooks/canvas/use-canvas-autosave'
import { useCanvasThumbnail } from '@/hooks/canvas/use-canvas-thumbnail'
import { useAuthStore } from '@/stores/auth-store'
import { uploadAssetFile } from '@/lib/canvas/canvas-api'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import { toast } from 'sonner'
import { NodeParamPanel } from './node-param-panel'
import type { AppNode, AppEdge } from '@/lib/canvas/types'
import { getAllUpstreamNodeIds } from '@/lib/canvas/dag'

const nodeTypes = nodeRegistry.getReactFlowTypesMapping()

const NODE_CANVAS_H: Record<string, number> = {
  image_gen: 260,
  text_input: 130,
  asset: 200,
  video_gen: 220,
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
  onSavedRef,
}: {
  canvasId: string
  onSave: () => void
  saving: boolean
  lastSaved: Date | null
  onSavedRef: React.MutableRefObject<(() => void) | null>
}) {
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)
  const onNodesChange = useCanvasStructureStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStructureStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStructureStore((s) => s.onConnect)
  const addNode = useCanvasStructureStore((s) => s.addNode)
  const addNodeWithConfig = useCanvasStructureStore((s) => s.addNodeWithConfig)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const executionNodes = useCanvasExecutionStore(useShallow((s) => s.nodes))
  const setHighlightedNodes = useCanvasExecutionStore((s) => s.setHighlightedNodes)
  const { project } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const token = useAuthStore((s) => s.accessToken)
  const [uploading, setUploading] = useState(false)

  const { kickPoll } = useCanvasPoller(canvasId)
  const { captureWhenIdle } = useCanvasThumbnail(canvasId)

  // Wire thumbnail capture to fire after each successful save
  useEffect(() => {
    onSavedRef.current = captureWhenIdle
  }, [onSavedRef, captureWhenIdle])

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null)

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const canvasPos = project({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setContextMenu({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y })
  }, [project])

  const handleContextMenuAdd = useCallback((type: string) => {
    if (!contextMenu) return
    addNode(type, { x: contextMenu.canvasX, y: contextMenu.canvasY })
    setContextMenu(null)
  }, [contextMenu, addNode])

  // Ctrl+C / Ctrl+V copy-paste
  const copiedNodeRef = useRef<AppNode | null>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    const trackMouse = (e: MouseEvent) => { mousePosRef.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('mousemove', trackMouse)
    return () => window.removeEventListener('mousemove', trackMouse)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return

      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 'c' && selectedNodeId) {
        const node = nodes.find((n) => n.id === selectedNodeId)
        if (node) copiedNodeRef.current = node
        return
      }

      if (isMod && e.key === 'v' && copiedNodeRef.current) {
        const rect = wrapperRef.current?.getBoundingClientRect()
        if (!rect) return
        const pos = project({
          x: mousePosRef.current.x - rect.left,
          y: mousePosRef.current.y - rect.top,
        })
        const newId = `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`
        addNodeWithConfig(
          copiedNodeRef.current.type!,
          { x: pos.x + 20, y: pos.y + 20 },
          { ...copiedNodeRef.current.data.config },
          newId,
        )
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, nodes, addNodeWithConfig, project])

  const handleAddNode = useCallback((type: string) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = project({ x: rect.width / 2, y: rect.height / 2 })
    addNode(type, position)
  }, [addNode, project])

  // Delete key: remove selected node
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNodeId) return
      // Don't fire when typing in input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeNodes([selectedNodeId])
        setSelectedNodeId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, removeNodes])

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
          addNodeWithConfig('asset', position, {
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
  }, [token, project, addNodeWithConfig])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  // Compute upstream node IDs for lineage highlighting
  const upstreamIds = useMemo(
    () => selectedNodeId ? getAllUpstreamNodeIds(selectedNodeId, edges) : new Set<string>(),
    [selectedNodeId, edges]
  )

  // Style edges — only recompute when edges, selection, or generating state changes
  const styledEdges = useMemo<AppEdge[]>(() => edges.map((edge) => {
    const isUpstream = selectedNodeId
      ? (edge.target === selectedNodeId || upstreamIds.has(edge.source))
      : false
    const isActive = executionNodes[edge.target]?.isGenerating || executionNodes[edge.source]?.isGenerating

    if (isActive) return { ...edge, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } }
    if (isUpstream) return { ...edge, animated: false, style: { stroke: '#a78bfa', strokeWidth: 2 } }
    return { ...edge, animated: false, style: { stroke: '#d4d4d8', strokeWidth: 1.5 } }
  }), [edges, selectedNodeId, upstreamIds, executionNodes])

  // Push upstream highlight set into execution store so nodes read it directly
  // (avoids recreating all node data objects on selection change)
  useEffect(() => {
    setHighlightedNodes(upstreamIds)
  }, [upstreamIds, setHighlightedNodes])

  // nodes passed to ReactFlow are stable — no data mutation needed
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
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) =>
          setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
        }
        onPaneClick={() => { setSelectedNodeId(null); setContextMenu(null) }}
        onPaneContextMenu={handlePaneContextMenu as any}
        fitView
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#fafafa' }}
        deleteKeyCode={null}
      >
        <Controls
          className="!bg-white !border-zinc-200 [&>button]:!bg-white [&>button]:!border-zinc-200 [&>button]:!text-zinc-500 [&>button:hover]:!bg-zinc-100 [&>button:hover]:!text-zinc-800"
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
          <button
            onClick={() => handleAddNode('video_gen')}
            className="px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg shadow transition-colors"
          >
            + AI视频
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

      {/* Right-click context menu */}
      {contextMenu && createPortal(
        <div
          className="fixed z-50 bg-white border border-zinc-200 rounded-xl shadow-xl py-1 min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            onClick={() => handleContextMenuAdd('text_input')}
            className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            + 纯文本节点
          </button>
          <button
            onClick={() => handleContextMenuAdd('image_gen')}
            className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            + AI 生图节点
          </button>
          <button
            onClick={() => handleContextMenuAdd('asset')}
            className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            + 素材节点
          </button>
          <button
            onClick={() => handleContextMenuAdd('video_gen')}
            className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            + AI 视频节点
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

export function CanvasEditor({ canvasId }: { canvasId: string }) {
  const token = useAuthStore((s) => s.accessToken)
  const prefetchSidebar = useCanvasSidebarDataStore((s) => s.prefetch)

  // onSaved callback is set inside Flow (needs useReactFlow), so we use a ref to pass it up
  const onSavedRef = useRef<(() => void) | null>(null)
  const { save, saving, lastSaved } = useCanvasAutosave(canvasId, () => onSavedRef.current?.())

  useEffect(() => {
    if (!canvasId || !token) return
    prefetchSidebar(canvasId, token)
  }, [canvasId, token, prefetchSidebar])

  return (
    <ReactFlowProvider>
      <Flow canvasId={canvasId} onSave={save} saving={saving} lastSaved={lastSaved} onSavedRef={onSavedRef} />
    </ReactFlowProvider>
  )
}
