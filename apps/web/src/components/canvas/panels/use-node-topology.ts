import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { type AppNode, type HandleType, isAssetConfig, isTextInputConfig } from '@/lib/canvas/types'
import type { CanvasReferenceMentionResource, ReferenceMentionType } from './resource-mentions'

export interface OrderedReferenceItem extends CanvasReferenceMentionResource {}

export interface KeyframeImageItem {
  url: string
  edgeId: string
}

/** 将执行层输出类型转换为 MIME 类型前缀 */
function handleTypeToMimeType(type: HandleType): string | undefined {
  switch (type) {
    case 'video': return 'video/mp4'
    case 'image': return 'image/jpeg'
    case 'audio': return 'audio/mpeg'
    case 'text': return 'text/plain'
    default: return undefined
  }
}

/** 从 URL 路径扩展名推断媒体类型 */
function inferMediaTypeFromUrl(url: string): 'image' | 'video' | 'audio' | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(mp4|mov|webm|avi|mkv)$/.test(pathname)) return 'video'
    if (/\.(mp3|wav|ogg|aac|flac|m4a)$/.test(pathname)) return 'audio'
    if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(pathname)) return 'image'
  } catch { /* URL 解析失败，忽略 */ }
  return undefined
}

/** 统一解析参考素材类型，避免不同模式对同一条连线产生不一致判断 */
function resolveReferenceMimeType(
  sourceNode: AppNode,
  url: string,
  outputType?: HandleType,
): string | undefined {
  if (sourceNode.type === 'asset' && isAssetConfig(sourceNode.data.config)) {
    return sourceNode.data.config.mimeType
  }
  if (outputType) return handleTypeToMimeType(outputType)
  // 未执行时按节点类型推断
  if (sourceNode.type === 'image_gen') return 'image/jpeg'
  if (sourceNode.type === 'video_gen' || sourceNode.type === 'video_stitch') return 'video/mp4'
  if (sourceNode.type === 'audio_gen') return 'audio/mpeg'
  const inferred = inferMediaTypeFromUrl(url)
  return inferred ? `${inferred}/x` : undefined
}

function resolveReferenceType(mimeType?: string): ReferenceMentionType {
  if (mimeType?.startsWith('video')) return 'video'
  if (mimeType?.startsWith('audio')) return 'audio'
  return 'image'
}

function getReferenceTypeLabel(type: ReferenceMentionType): string {
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  return '图片'
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function resolveReferenceThumbnailUrl(sourceNode: AppNode, outputThumbnailUrl?: unknown): string | undefined {
  if (sourceNode.type === 'asset' && isAssetConfig(sourceNode.data.config)) {
    return getStringValue(sourceNode.data.config.thumbnailUrl) ?? getStringValue(sourceNode.data.config.thumbnail_url)
  }

  const outputThumbnail = getStringValue(outputThumbnailUrl)
  if (outputThumbnail) return outputThumbnail

  const config = sourceNode.data.config as {
    thumbnailUrl?: unknown
    thumbnail_url?: unknown
  }
  return getStringValue(config.thumbnailUrl) ?? getStringValue(config.thumbnail_url)
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
      .filter((n) => n.type === 'image_gen' || n.type === 'video_gen' || n.type === 'audio_gen')
      .map((n) => n.id),
    [upstreamNodes]
  )

  const upstreamSelectedOutputs = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const output = st?.outputs.find((o) => o.id === st.selectedOutputId)
        return [id, output?.url]
      })
    ))
  )

  // 获取上游生成节点的输出类型，用于分类参考素材
  const upstreamSelectedOutputTypes = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const output = st?.outputs.find((o) => o.id === st.selectedOutputId)
        return [id, output?.type]
      })
    ))
  )

  const upstreamSelectedOutputSnapshots = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const output = st?.outputs.find((o) => o.id === st.selectedOutputId)
        return [id, output?.paramsSnapshot]
      })
    ))
  )

  const upstreamSelectedOutputThumbnails = useCanvasExecutionStore(
    useShallow((s) => Object.fromEntries(
      upstreamGenIds.map((id) => {
        const st = s.nodes[id]
        const output = st?.outputs.find((o) => o.id === st.selectedOutputId)
        return [id, output?.thumbnailUrl]
      })
    ))
  )

  const resolveReferenceDuration = useCallback((sourceNode: AppNode): number | undefined => {
    if (sourceNode.type === 'asset' && isAssetConfig(sourceNode.data.config)) {
      const duration = sourceNode.data.config.duration
      return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined
    }

    const snapshot = upstreamSelectedOutputSnapshots[sourceNode.id] as {
      duration?: unknown
      params?: { duration?: unknown }
      segments?: Array<{ outPoint?: unknown; inPoint?: unknown }>
    } | undefined

    if (typeof snapshot?.duration === 'number' && Number.isFinite(snapshot.duration) && snapshot.duration > 0) {
      return snapshot.duration
    }
    if (typeof snapshot?.params?.duration === 'number' && Number.isFinite(snapshot.params.duration) && snapshot.params.duration > 0) {
      return snapshot.params.duration
    }
    if (Array.isArray(snapshot?.segments)) {
      const total = snapshot.segments.reduce((sum, segment) => {
        const outPoint = typeof segment.outPoint === 'number' ? segment.outPoint : 0
        const inPoint = typeof segment.inPoint === 'number' ? segment.inPoint : 0
        return sum + Math.max(0, outPoint - inPoint)
      }, 0)
      return total > 0 ? total : undefined
    }

    const config = sourceNode.data.config as { duration?: unknown }
    return typeof config.duration === 'number' && Number.isFinite(config.duration) && config.duration > 0 ? config.duration : undefined
  }, [upstreamSelectedOutputSnapshots])

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
    const typeCounts: Record<ReferenceMentionType, number> = { image: 0, video: 0, audio: 0 }

    for (const edge of incomingEdges) {
      if (edge.targetHandle && edge.targetHandle !== 'any-in') continue

      const sourceNode = upstreamNodes.find((u) => u.id === edge.source)
      if (!sourceNode || sourceNode.type === 'text_input') continue

      const url = resolveSourceUrl(edge.source)
      if (!url) continue

      const mimeType = resolveReferenceMimeType(sourceNode, url, upstreamSelectedOutputTypes[sourceNode.id])
      const type = resolveReferenceType(mimeType)
      typeCounts[type] += 1

      result.push({
        id: edge.id,
        url,
        type,
        mimeType,
        thumbnailUrl: resolveReferenceThumbnailUrl(sourceNode, upstreamSelectedOutputThumbnails[sourceNode.id]),
        duration: type === 'video' ? resolveReferenceDuration(sourceNode) : undefined,
        mentionLabel: `${getReferenceTypeLabel(type)}${typeCounts[type]}`,
        sourceLabel: sourceNode.data.label ?? getReferenceTypeLabel(type),
      })
    }

    return result
  }, [incomingEdges, upstreamNodes, resolveSourceUrl, upstreamSelectedOutputTypes, upstreamSelectedOutputThumbnails, resolveReferenceDuration])

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

  const multirefVideoDurations = useMemo(
    () => orderedImageRefs
      .filter((r) => r.mimeType != null && r.mimeType.startsWith('video'))
      .map((r) => r.duration)
      .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration) && duration > 0),
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
      const mimeType = resolveReferenceMimeType(sourceNode, url, upstreamSelectedOutputTypes[sourceNode.id])
      if (mimeType && !mimeType.startsWith('image')) continue

      result.push({ url, edgeId: edge.id })
      if (result.length >= 2) break
    }

    return result
  }, [incomingEdges, upstreamNodes, resolveSourceUrl, upstreamSelectedOutputTypes])

  return {
    incomingEdges,
    upstreamNodes,
    upstreamTexts,
    upstreamTextNodeLabels,
    orderedImageRefs,
    multirefImages,
    multirefVideos,
    multirefVideoDurations,
    multirefAudios,
    keyframeImages,
  }
}
