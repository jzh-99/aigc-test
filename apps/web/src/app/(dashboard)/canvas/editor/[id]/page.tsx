'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, History, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { CanvasEditor } from '@/components/canvas/canvas-editor'
import { CanvasHistorySidebar } from '@/components/canvas/canvas-history-sidebar'
import { CanvasAgentPanel } from '@/components/canvas/canvas-agent-panel'
import type { AppNode, AppEdge } from '@/lib/canvas/types'

type SidePanel = 'agent' | 'history' | null

function normalizeCanvasStructure(raw: unknown): { nodes: AppNode[]; edges: AppEdge[] } {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { nodes: [], edges: [] }
    }
  }

  if (!value || typeof value !== 'object') return { nodes: [], edges: [] }

  const structure = value as { nodes?: unknown; edges?: unknown }
  return {
    nodes: Array.isArray(structure.nodes) ? structure.nodes as AppNode[] : [],
    edges: Array.isArray(structure.edges) ? structure.edges as AppEdge[] : [],
  }
}

function CanvasNameEditor({
  name,
  canvasId,
  token,
}: {
  name: string
  canvasId: string
  token: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(name) }, [name])

  const commit = useCallback(async () => {
    setEditing(false)
    const trimmed = value.trim() || name
    setValue(trimmed)
    if (trimmed === name || !token) return
    try {
      await fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: trimmed, version: useCanvasStructureStore.getState().localVersion }),
      })
    } catch {
      toast.error('重命名失败')
    }
  }, [value, name, canvasId, token])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-sm font-medium bg-transparent border-b border-primary outline-none w-48 px-0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.blur()
          if (e.key === 'Escape') { setValue(name); setEditing(false) }
        }}
        autoFocus
      />
    )
  }

  return (
    <button
      className="text-sm font-medium hover:text-primary transition-colors truncate max-w-[200px]"
      onClick={() => setEditing(true)}
      title="点击重命名"
    >
      {value}
    </button>
  )
}

export default function CanvasEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const initCanvas = useCanvasStructureStore((s) => s.initCanvas)
  const [canvasName, setCanvasName] = useState('未命名画布')
  const [loading, setLoading] = useState(true)
  const [sidePanel, setSidePanel] = useState<SidePanel>(null)
  const kickPollRef = useRef<(() => void) | null>(null)
  const onNodeSelectedRef = useRef<((nodeId: string) => boolean) | null>(null)
  const onStoryboardExpandedRef = useRef<((shotNodeIds: string[]) => void) | null>(null)

  useEffect(() => {
    if (!isInitialized) return
    if (!user || !token) router.replace('/login')
  }, [isInitialized, user, token, router])

  useEffect(() => {
    if (!id || !token) return
    const controller = new AbortController()
    fetch(`/api/v1/canvases/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const error = new Error('Canvas load failed') as Error & { status?: number }
          error.status = res.status
          throw error
        }
        return res.json()
      })
      .then((canvas) => {
        setCanvasName(canvas.name)
        const sd = normalizeCanvasStructure(canvas.structure_data)
        initCanvas(id, sd.nodes, sd.edges, canvas.version ?? 1, canvas.workspace_id)
      })
      .catch((err: Error & { status?: number; name?: string }) => {
        if (err.name === 'AbortError') return
        if (err.status === 401) { router.replace('/login'); return }
        toast.error(err.status === 403 ? '无权限访问该画布' : '画布加载失败')
        router.push('/canvas/gallery')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [id, token, initCanvas, router])

  const togglePanel = (panel: SidePanel) =>
    setSidePanel((prev) => (prev === panel ? null : panel))

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background -m-4 md:-m-6">
      {/* Sub-header */}
      <header className="h-10 border-b flex items-center justify-between px-4 shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/canvas/gallery')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← 全部画布
          </button>
          <div className="h-3.5 w-px bg-border mx-1" />
          <CanvasNameEditor name={canvasName} canvasId={id} token={token} />
        </div>

        <div className="w-24" />

        {/* Right controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => togglePanel('agent')}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
              sidePanel === 'agent'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            助手
          </button>
          <button
            data-testid="canvas-toggle-history"
            onClick={() => togglePanel('history')}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
              sidePanel === 'history'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            记录
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 relative overflow-hidden">
          <CanvasEditor
            canvasId={id}
            onKickPollReady={(fn) => { kickPollRef.current = fn }}
            onNodeSelected={(nodeId) => onNodeSelectedRef.current?.(nodeId) ?? false}
            onStoryboardExpandedRef={onStoryboardExpandedRef}
          />
        </div>
        <CanvasAgentPanel
          canvasId={id}
          kickPoll={() => kickPollRef.current?.()}
          onClose={() => setSidePanel(null)}
          onNodeSelectedRef={onNodeSelectedRef}
          onStoryboardExpandedRef={onStoryboardExpandedRef}
          hidden={sidePanel !== 'agent'}
        />
        {sidePanel === 'history' && (
          <CanvasHistorySidebar canvasId={id} onClose={() => setSidePanel(null)} />
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm pointer-events-none z-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
