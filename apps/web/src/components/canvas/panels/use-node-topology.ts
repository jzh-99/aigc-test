import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { isAssetConfig, isTextInputConfig } from '@/lib/canvas/types'

export interface OrderedReferenceItem {
  url: string
  mimeType?: string
}

export interface KeyframeImageItem {
  url: string
  edgeId: string
}

export function useNodeTopology(nodeId: string) {
  const incomingEdges = useCanvasStructureStore(
    useShallow((s) => s.edges.filter((e) => e.target === nodeId))
  )

  const allUpstreamNodeIds = useCanvasStructureStore(
    useShallow((s) => s.edges.filter((e) => e.target === nodeId).map((e) => e.source).sort())
  )

  const upstreamNodes = useCanvasStructureStore(
    useShallow((s) => s.nodes.filter((n) => allUpstreamNodeIds.includes(n.id)))
  )

  const upstreamTexts = useMemo(
    () => upstreamNodes
      .filter((n) => n.type === 'text_input')
      .map((n) => (isTextInputConfig(n.data.config) ? n.data.config.text : ''))
      .filter(Boolean),
    [upstreamNodes]
  )

  const upstreamTextNodeLabels = useMemo(
    () => upstreamNodes
      .filter((n) => n.type === 'text_input')
      .map((n) => n.data.label ?? '文本'),
    [upstreamNodes]
  )

  const upstreamGenIds = useMemo(
    () => upstreamNodes
      .filter((n) => n.type === 'image_gen' || n.type === 'video_gen')
      .map((n) => n.id),
    [upstreamNodes]
  )

  const upstreamSelectedOutputs = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const url = st?.outputs.find((o) => o.id === st.selectedOutputId)?.url
        return [id, url]
      })
    ))
  )

  const resolveSourceUrl = useCallback((sourceId: string): string | undefined => {
    const sourceNode = upstreamNodes.find((u) => u.id === sourceId)
    if (!sourceNode) return undefined

    if (sourceNode.type === 'asset') {
      return isAssetConfig(sourceNode.data.config) ? sourceNode.data.config.url : undefined
    }

    return upstreamSelectedOutputs[sourceId]
  }, [upstreamNodes, upstreamSelectedOutputs])

  const orderedImageRefs = useMemo(() => {
    const result: OrderedReferenceItem[] = []

    for (const edge of incomingEdges) {
      if (edge.targetHandle && edge.targetHandle !== 'any-in') continue

      const sourceNode = upstreamNodes.find((u) => u.id === edge.source)
      if (!sourceNode || sourceNode.type === 'text_input') continue

      const url = resolveSourceUrl(edge.source)
      if (!url) continue

      const mimeType = sourceNode.type === 'asset' && isAssetConfig(sourceNode.data.config)
        ? sourceNode.data.config.mimeType
        : undefined

      result.push({ url, mimeType })
    }

    return result
  }, [incomingEdges, upstreamNodes, resolveSourceUrl])

  const multirefImages = useMemo(
    () => orderedImageRefs
      .filter((r) => !r.mimeType || r.mimeType.startsWith('image'))
      .map((r) => r.url),
    [orderedImageRefs]
  )

  const multirefVideos = useMemo(
    () => orderedImageRefs
      .filter((r) => r.mimeType != null && r.mimeType.startsWith('video'))
      .map((r) => r.url),
    [orderedImageRefs]
  )

  const multirefAudios = useMemo(
    () => orderedImageRefs
      .filter((r) => r.mimeType != null && r.mimeType.startsWith('audio'))
      .map((r) => r.url),
    [orderedImageRefs]
  )

  const keyframeImages = useMemo(() => {
    const result: KeyframeImageItem[] = []

    for (const edge of incomingEdges) {
      if (edge.targetHandle && edge.targetHandle !== 'any-in') continue

      const sourceNode = upstreamNodes.find((u) => u.id === edge.source)
      if (!sourceNode || sourceNode.type === 'text_input') continue

      const url = resolveSourceUrl(edge.source)
      if (!url) continue

      result.push({ url, edgeId: edge.id })
      if (result.length >= 2) break
    }

    return result
  }, [incomingEdges, upstreamNodes, resolveSourceUrl])

  return {
    incomingEdges,
    upstreamNodes,
    upstreamTexts,
    upstreamTextNodeLabels,
    orderedImageRefs,
    multirefImages,
    multirefVideos,
    multirefAudios,
    keyframeImages,
  }
}
