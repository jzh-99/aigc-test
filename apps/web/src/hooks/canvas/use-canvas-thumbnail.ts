import { useCallback, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import { toPng } from 'html-to-image'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { uploadCanvasThumbnail, updateCanvasThumbnail } from '@/lib/canvas/canvas-api'

export function useCanvasThumbnail(canvasId: string) {
  const { getViewport } = useReactFlow()
  const token = useAuthStore((s) => s.accessToken)
  const inProgress = useRef(false)

  const capture = useCallback(async () => {
    if (inProgress.current || !canvasId || !token) return
    inProgress.current = true

    try {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
      if (!viewport) return

      const dataUrl = await toPng(viewport, {
        width: 800,
        height: 450,
        quality: 0.8,
        style: { transform: `scale(${getViewport().zoom})` },
      })

      const blob = await (await fetch(dataUrl)).blob()
      const storageUrl = await uploadCanvasThumbnail(blob, token)
      const { localVersion } = useCanvasStructureStore.getState()
      await updateCanvasThumbnail(canvasId, storageUrl, localVersion, token)
    } catch (e) {
      // thumbnail is non-critical — swallow silently
      console.warn('[Thumbnail] capture failed:', e)
    } finally {
      inProgress.current = false
    }
  }, [canvasId, token, getViewport])

  // Wrap in requestIdleCallback so it never blocks user interaction
  const captureWhenIdle = useCallback(() => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => capture(), { timeout: 5000 })
    } else {
      setTimeout(capture, 200)
    }
  }, [capture])

  return { captureWhenIdle }
}
