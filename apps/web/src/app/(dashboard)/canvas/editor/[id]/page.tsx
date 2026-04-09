'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, History } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useLayoutStore } from '@/stores/layout-store'
import { CanvasEditor } from '@/components/canvas/canvas-editor'
import { CanvasHistorySidebar } from '@/components/canvas/canvas-history-sidebar'
import type { AppNode, AppEdge } from '@/lib/canvas/types'

export default function CanvasEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const initCanvas = useCanvasStructureStore((s) => s.initCanvas)
  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed)
  const [canvasName, setCanvasName] = useState('未命名画布')
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/canvases/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not found')
        return res.json()
      })
      .then((canvas) => {
        setCanvasName(canvas.name)
        const sd = canvas.structure_data ?? { nodes: [], edges: [] }
        initCanvas(id, sd.nodes as AppNode[], sd.edges as AppEdge[], canvas.version ?? 1, canvas.workspace_id)
      })
      .catch(() => {
        toast.error('画布加载失败')
        router.push('/canvas')
      })
      .finally(() => setLoading(false))
  }, [id, token, initCanvas, router])

  const sidebarW = sidebarCollapsed ? '4rem' : '15rem'

  if (loading) {
    return (
      <div
        className="fixed flex items-center justify-center bg-background z-10"
        style={{ top: '3.5rem', left: sidebarW, right: 0, bottom: 0 }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="fixed flex flex-col overflow-hidden bg-background z-10"
      style={{ top: '3.5rem', left: sidebarW, right: 0, bottom: 0 }}
    >
      {/* Canvas sub-header */}
      <header className="h-10 border-b flex items-center justify-between px-4 shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/canvas')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← 返回大厅
          </button>
          <div className="h-3.5 w-px bg-border mx-1" />
          <span className="text-sm font-medium">{canvasName}</span>
        </div>
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
        >
          <History className="w-3.5 h-3.5" />
          记录
        </button>
      </header>

      {/* Canvas + optional history sidebar */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative overflow-hidden">
          <CanvasEditor canvasId={id} />
        </div>
        {historyOpen && (
          <CanvasHistorySidebar
            canvasId={id}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
