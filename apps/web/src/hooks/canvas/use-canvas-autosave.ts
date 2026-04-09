import { useEffect, useRef, useCallback, useState } from 'react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useAuthStore } from '@/stores/auth-store'

const DEBOUNCE_MS = 2500

export function useCanvasAutosave(canvasId: string | null) {
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)
  const localVersion = useCanvasStructureStore((s) => s.localVersion)
  const setLocalVersion = useCanvasStructureStore((s) => s.setLocalVersion)
  const token = useAuthStore((s) => s.accessToken)

  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const isFirstRender = useRef(true)
  const isSaving = useRef(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const save = useCallback(async () => {
    if (!canvasId || isSaving.current) return
    isSaving.current = true
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          version: localVersion,
          structure_data: { nodes, edges },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        // Update local version so next save uses the incremented version
        if (data.version != null) setLocalVersion(data.version)
        setLastSaved(new Date())
      } else {
        console.warn('[Autosave] 保存失败:', res.status)
      }
    } catch (e) {
      console.warn('[Autosave] 保存失败:', e)
    } finally {
      isSaving.current = false
      setSaving(false)
    }
  }, [canvasId, nodes, edges, localVersion, token, setLocalVersion])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, DEBOUNCE_MS)
    return () => clearTimeout(timerRef.current)
  }, [nodes, edges, save])

  // beforeunload: force-save any pending changes when navigating away
  useEffect(() => {
    if (!canvasId || !token) return
    const handler = () => {
      clearTimeout(timerRef.current)
      const state = useCanvasStructureStore.getState()
      fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version: state.localVersion,
          structure_data: { nodes: state.nodes, edges: state.edges },
        }),
      })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [canvasId, token])

  return { save, saving, lastSaved }
}
