import { useEffect, useRef, useCallback, useState } from 'react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useAuthStore } from '@/stores/auth-store'

const DEBOUNCE_MS = 180000 // 3 minutes

async function doSave(canvasId: string, token: string) {
  // Always read latest state from store — avoids stale closure version bug
  const { nodes, edges, localVersion, setLocalVersion } = useCanvasStructureStore.getState()
  const res = await fetch(`/api/v1/canvases/${canvasId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ version: localVersion, structure_data: { nodes, edges } }),
  })
  if (res.ok) {
    const data = await res.json()
    if (data.version != null) setLocalVersion(data.version)
    return true
  }
  if (res.status === 409) {
    // Conflict: remote is newer — reload remote version to unblock future saves
    console.warn('[Autosave] 409 conflict — reloading remote version')
    const canvas = await fetch(`/api/v1/canvases/${canvasId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()).catch(() => null)
    if (canvas?.version != null) setLocalVersion(canvas.version)
  }
  return false
}

export function useCanvasAutosave(canvasId: string | null) {
  const token = useAuthStore((s) => s.accessToken)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const isFirstRender = useRef(true)
  const isSaving = useRef(false)
  const dirtyRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // Subscribe to nodes/edges changes only to trigger debounce
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)

  const save = useCallback(async () => {
    if (!canvasId || !token || isSaving.current) return
    isSaving.current = true
    setSaving(true)
    try {
      const ok = await doSave(canvasId, token)
      if (ok) {
        dirtyRef.current = false
        setLastSaved(new Date())
      }
    } catch (e) {
      console.warn('[Autosave] 保存失败:', e)
    } finally {
      isSaving.current = false
      setSaving(false)
    }
  }, [canvasId, token])

  // Debounce on any nodes/edges change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    dirtyRef.current = true
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, DEBOUNCE_MS)
    return () => clearTimeout(timerRef.current)
  }, [nodes, edges, save])

  // beforeunload: fire-and-forget with keepalive (only if dirty)
  useEffect(() => {
    if (!canvasId || !token) return
    const handler = () => {
      if (!dirtyRef.current) return
      clearTimeout(timerRef.current)
      const { nodes: n, edges: e, localVersion } = useCanvasStructureStore.getState()
      fetch(`/api/v1/canvases/${canvasId}`, {
        method: 'PATCH',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: localVersion, structure_data: { nodes: n, edges: e } }),
      })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [canvasId, token])

  return { save, saving, lastSaved }
}
