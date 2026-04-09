'use client'

import { useCallback, useRef, useState } from 'react'
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
import { NodeParamPanel } from './node-param-panel'
import type { AppNode } from '@/lib/canvas/types'

const nodeTypes = nodeRegistry.getReactFlowTypesMapping()

// Approximate canvas-space heights for each node type (used to position panel below)
const NODE_CANVAS_H: Record<string, number> = {
  image_gen: 260,   // header ~32 + aspect 4:3 preview of 280px wide ≈ 210 + pager ~18
  text_input: 130,  // header + textarea
}

// ── Floating param panel ───────────────────────────────────────────────────
// Renders as a fixed-position portal so it's immune to canvas zoom.
// Subscribes to ReactFlow viewport store to track node screen position live.
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
  // Subscribe to viewport — re-renders on every pan/zoom automatically
  const transform = useStore((s) => s.transform) // [tx, ty, zoom]

  const rect = wrapperRef.current?.getBoundingClientRect()
  if (!rect) return null

  const [tx, ty, zoom] = transform
  const PANEL_W = 640
  const NODE_W = 280

  // Node top-left in screen coords
  const sx = rect.left + node.position.x * zoom + tx
  const sy = rect.top + node.position.y * zoom + ty

  // Bottom of node in screen coords
  const nodeScreenH = (NODE_CANVAS_H[node.type ?? ''] ?? 200) * zoom
  const rawTop = sy + nodeScreenH + 8

  // Center panel horizontally under node
  const nodeScreenW = NODE_W * zoom
  let left = sx + nodeScreenW / 2 - PANEL_W / 2
  left = Math.max(rect.left + 8, Math.min(left, window.innerWidth - PANEL_W - 8))

  // Clamp so panel doesn't go below viewport
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

// ── Flow ───────────────────────────────────────────────────────────────────
function Flow({ canvasId, onSave, saving }: { canvasId: string; onSave: () => void; saving: boolean }) {
  const store = useCanvasStructureStore()
  const { project } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { kickPoll } = useCanvasPoller(canvasId)

  const handleAddNode = useCallback((type: string) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    // Project the visual center of the canvas viewport to flow coordinates
    const position = project({ x: rect.width / 2, y: rect.height / 2 })
    store.addNode(type, position)
  }, [store, project])

  const selectedNode = store.nodes.find((n) => n.id === selectedNodeId) ?? null

  return (
    <div
      className="w-full h-full relative"
      ref={wrapperRef}
      style={{
        background: '#fafafa',
        // Tapnow canvas perf
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
    >
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
      >
        <Controls
          className="!bg-white !border-zinc-200 [&>button]:!bg-white [&>button]:!border-zinc-200 [&>button]:!text-zinc-500 [&>button:hover]:!bg-zinc-100 [&>button:hover]:!text-zinc-800"
        />
        <MiniMap
          nodeColor={(n) => (n.type === 'text_input' ? '#eab308' : '#3b82f6')}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-zinc-50 text-zinc-600 rounded-lg border border-zinc-200 shadow-sm transition-colors disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </Panel>
      </ReactFlow>

      {/* Floating param panel — fixed size, tracks node position */}
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
  const { save, saving } = useCanvasAutosave(canvasId)
  return (
    <ReactFlowProvider>
      <Flow canvasId={canvasId} onSave={save} saving={saving} />
    </ReactFlowProvider>
  )
}
