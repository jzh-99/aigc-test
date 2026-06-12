import { create } from 'zustand'
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow'
import type { AppNode, AppEdge, CanvasNodeConfig, VideoMode } from '@/lib/canvas/types'
import type { AgentWorkflow } from '@/lib/canvas/agent-types'
import { DEFAULT_IMAGE_CATEGORY_LIMITS, DEFAULT_TEXT_CATEGORY_LIMITS, DEFAULT_VIDEO_CATEGORY_LIMITS, isAssetConfig, isImageGenConfig, isTextInputConfig, isVideoGenConfig } from '@/lib/canvas/types'
import { ACTIVE_IMAGE_CATEGORY, ACTIVE_TEXT_CATEGORY, parseCategoryReferences } from '@aigc/types'
import { hasCycle } from '@/lib/canvas/dag'
import { nodeRegistry } from '@/lib/canvas/registry'
import { validateReferenceKindLimit } from '@/lib/canvas/reference-limits'
import {
  type UndoSnapshot,
  loadUndoHistory,
  saveUndoHistory,
  MAX_UNDO,
} from '@/lib/canvas/canvas-undo-history'

interface OrganizeViewport {
  x: number
  y: number
  width: number
  height: number
}

interface OrganizeLayout {
  positionById: Map<string, { x: number; y: number }>
  width: number
  height: number
}

interface PackedOrganizeLayout {
  layout: OrganizeLayout
  x: number
  y: number
}

interface PackedOrganizeResult {
  placed: PackedOrganizeLayout[]
  width: number
  height: number
  rowWaste?: number
}

interface CanvasStructureState {
  canvasId: string | null
  workspaceId: string | null
  nodes: AppNode[]
  edges: AppEdge[]
  localVersion: number
  _past: UndoSnapshot[]
  _future: UndoSnapshot[]

  initCanvas: (canvasId: string, nodes: AppNode[], edges: AppEdge[], version: number, workspaceId?: string) => void
  setLocalVersion: (version: number) => void
  flushHistory: () => void
  undo: () => void
  redo: () => void

  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => string | null

  addNode: (type: string, position: { x: number; y: number }) => void
  addNodeWithConfig: (type: string, position: { x: number; y: number }, config: Record<string, unknown>, id?: string) => void
  addNodeAndConnect: (sourceNodeIds: string[], type: string, position: { x: number; y: number }) => string[]
  addNodesWithEdges: (newNodes: AppNode[], newEdges: AppEdge[]) => string[]
  removeNodes: (nodeIds: string[]) => void
  removeEdgeById: (edgeId: string) => void
  removeEdgesByTarget: (nodeId: string, handleIds: string[]) => void
  updateNodeData: (nodeId: string, partialData: Partial<AppNode['data']>) => void
  organizeNodes: (viewport?: OrganizeViewport) => number
  applyAgentWorkflow: (workflow: AgentWorkflow) => void
}

// Throttle state for drag operations
let dragTimer: ReturnType<typeof setTimeout> | undefined
let pendingSnapshot: UndoSnapshot | null = null

function commitSnapshot(canvasId: string, snapshot: UndoSnapshot, past: UndoSnapshot[]): UndoSnapshot[] {
  const next = [...past, snapshot].slice(-MAX_UNDO)
  saveUndoHistory(canvasId, { past: next, future: [] })
  return next
}

// Push a snapshot into history.
// immediate=true: flush any pending drag snapshot first, then push immediately.
// immediate=false: throttle 500ms to merge rapid drag changes into one entry.
function pushSnapshot(
  getState: () => CanvasStructureState,
  setState: (fn: (s: CanvasStructureState) => Partial<CanvasStructureState>) => void,
  snapshot: UndoSnapshot,
  immediate: boolean,
) {
  if (immediate) {
    clearTimeout(dragTimer)
    const { canvasId, _past } = getState()
    if (!canvasId) return
    // Flush pending drag snapshot first so it lands before this discrete op
    let base = _past
    if (pendingSnapshot) {
      base = commitSnapshot(canvasId, pendingSnapshot, _past)
      pendingSnapshot = null
    }
    const next = commitSnapshot(canvasId, snapshot, base)
    setState(() => ({ _past: next, _future: [] }))
    return
  }

  // Throttled path for drag
  clearTimeout(dragTimer)
  pendingSnapshot = snapshot
  dragTimer = setTimeout(() => {
    const { canvasId, _past } = getState()
    if (!canvasId || !pendingSnapshot) return
    const next = commitSnapshot(canvasId, pendingSnapshot, _past)
    pendingSnapshot = null
    setState(() => ({ _past: next, _future: [] }))
  }, 500)
}

function createNodeFromAgentNode(agentNode: AppNode): AppNode {
  try {
    const baseNode = nodeRegistry.createNodeInstance(
      agentNode.type ?? '',
      agentNode.position ?? { x: 0, y: 0 },
      agentNode.id,
    )

    return {
      ...agentNode,
      id: baseNode.id,
      type: baseNode.type,
      position: agentNode.position ?? baseNode.position,
      data: {
        ...baseNode.data,
        ...agentNode.data,
        label: agentNode.data?.label ?? baseNode.data.label,
        config: {
          ...baseNode.data.config,
          ...((agentNode.data?.config ?? {}) as unknown as Record<string, unknown>),
        } as CanvasNodeConfig,
      },
    }
  } catch {
    return agentNode
  }
}

function createEdgeWithId(connection: Connection): AppEdge {
  return {
    id: `edge_${connection.source}_${connection.sourceHandle ?? 'source'}_${connection.target}_${connection.targetHandle ?? 'target'}_${crypto.randomUUID()}`,
    source: connection.source!,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target!,
    targetHandle: connection.targetHandle ?? null,
  }
}

function getVideoCategoryLimits(node: AppNode | undefined) {
  if (!node || node.type !== 'video_gen' || !isVideoGenConfig(node.data.config)) {
    return DEFAULT_VIDEO_CATEGORY_LIMITS
  }
  // 使用 parseCategoryReferences 确保数据格式正确
  const parsed = parseCategoryReferences(node.data.config.categoryReferences)
  // 如果解析结果为空对象，返回默认值
  if (Object.keys(parsed).length === 0) {
    return DEFAULT_VIDEO_CATEGORY_LIMITS
  }
  return parsed
}

function getImageCategoryLimits(node: AppNode | undefined) {
  if (!node || node.type !== 'image_gen' || !isImageGenConfig(node.data.config)) {
    return DEFAULT_IMAGE_CATEGORY_LIMITS
  }
  const parsed = parseCategoryReferences(node.data.config.categoryReferences)
  if (Object.keys(parsed).length === 0) {
    return DEFAULT_IMAGE_CATEGORY_LIMITS
  }
  return parsed
}

function getTextCategoryLimits(node: AppNode | undefined) {
  if (!node || node.type !== 'text_input' || !isTextInputConfig(node.data.config)) {
    return DEFAULT_TEXT_CATEGORY_LIMITS
  }
  const parsed = parseCategoryReferences(node.data.config.categoryReferences)
  if (Object.keys(parsed).length === 0) {
    return DEFAULT_TEXT_CATEGORY_LIMITS
  }
  return parsed
}

function getReferenceKind(node: AppNode | undefined, options: { includeText?: boolean } = {}): 'image' | 'video' | 'audio' | 'text' | null {
  if (!node) return null
  if (node.type === 'text_input') return options.includeText ? 'text' : null
  if (node.type === 'image_gen') return 'image'
  if (node.type === 'video_gen' || node.type === 'video_stitch') return 'video'
  if (node.type === 'audio_gen') return 'audio'
  if (!isAssetConfig(node.data.config)) return null

  const mimeType = node.data.config.mimeType ?? ''
  if (mimeType.startsWith('image')) return 'image'
  if (mimeType.startsWith('video')) return 'video'
  if (mimeType.startsWith('audio')) return 'audio'
  return null
}

const ORGANIZE_NODE_SIZE: Record<string, { width: number; height: number }> = {
  image_gen: { width: 360, height: 340 },
  text_input: { width: 280, height: 190 },
  asset: { width: 220, height: 260 },
  video_gen: { width: 420, height: 300 },
  audio_gen: { width: 280, height: 210 },
  script_writer: { width: 280, height: 170 },
  storyboard_splitter: { width: 320, height: 220 },
  video_stitch: { width: 420, height: 300 },
}
const ORGANIZE_GRID_SIZE = 24
const ORGANIZE_LAYER_GAP = 144
const ORGANIZE_NODE_GAP = 96
const ORGANIZE_COMPONENT_GAP = 144
const ORGANIZE_ROW_GAP = 120
const ORGANIZE_COLUMN_ALIGN_TOLERANCE = ORGANIZE_GRID_SIZE * 4

function getOrganizeNodeSize(node: AppNode) {
  return ORGANIZE_NODE_SIZE[node.type ?? ''] ?? { width: 280, height: 220 }
}

function snapToOrganizeGrid(value: number) {
  return Math.round(value / ORGANIZE_GRID_SIZE) * ORGANIZE_GRID_SIZE
}

function ceilToOrganizeGrid(value: number) {
  return Math.ceil(value / ORGANIZE_GRID_SIZE) * ORGANIZE_GRID_SIZE
}

function compareByPosition(a: AppNode, b: AppNode) {
  return a.position.y - b.position.y || a.position.x - b.position.x
}

function getGraphBounds(nodes: AppNode[]) {
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const maxX = Math.max(...nodes.map((node) => {
    const size = getOrganizeNodeSize(node)
    return node.position.x + size.width
  }))
  const maxY = Math.max(...nodes.map((node) => {
    const size = getOrganizeNodeSize(node)
    return node.position.y + size.height
  }))

  return {
    x: snapToOrganizeGrid(minX),
    y: snapToOrganizeGrid(minY),
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function splitConnectedComponents(nodes: AppNode[], incoming: Map<string, string[]>, outgoing: Map<string, string[]>) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  const components: AppNode[][] = []

  nodes
    .slice()
    .sort(compareByPosition)
    .forEach((node) => {
      if (visited.has(node.id)) return

      const queue = [node.id]
      const component: AppNode[] = []
      visited.add(node.id)

      while (queue.length > 0) {
        const nodeId = queue.shift()!
        const current = nodeById.get(nodeId)
        if (current) component.push(current)

        for (const nextId of [...(incoming.get(nodeId) ?? []), ...(outgoing.get(nodeId) ?? [])]) {
          if (visited.has(nextId)) continue
          visited.add(nextId)
          queue.push(nextId)
        }
      }

      components.push(component.sort(compareByPosition))
    })

  return components.sort((a, b) => compareByPosition(a[0], b[0]))
}

function buildComponentLayers(componentNodes: AppNode[], incoming: Map<string, string[]>, outgoing: Map<string, string[]>) {
  const componentIds = new Set(componentNodes.map((node) => node.id))
  const indegree = new Map(componentNodes.map((node) => [
    node.id,
    (incoming.get(node.id) ?? []).filter((sourceId) => componentIds.has(sourceId)).length,
  ]))
  const queue = componentNodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort(compareByPosition)
    .map((node) => node.id)
  const layerById = new Map<string, number>()
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    visited.add(nodeId)

    const upstreamLayer = Math.max(
      -1,
      ...(incoming.get(nodeId) ?? [])
        .filter((sourceId) => componentIds.has(sourceId))
        .map((sourceId) => layerById.get(sourceId) ?? -1),
    )
    layerById.set(nodeId, Math.max(layerById.get(nodeId) ?? 0, upstreamLayer + 1))

    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!componentIds.has(targetId)) continue
      layerById.set(targetId, Math.max(layerById.get(targetId) ?? 0, (layerById.get(nodeId) ?? 0) + 1))
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, nextIndegree)
      if (nextIndegree === 0) queue.push(targetId)
    }
  }

  componentNodes
    .filter((node) => !visited.has(node.id))
    .forEach((node) => {
      const upstreamLayer = Math.max(
        -1,
        ...(incoming.get(node.id) ?? [])
          .filter((sourceId) => componentIds.has(sourceId))
          .map((sourceId) => layerById.get(sourceId) ?? 0),
      )
      layerById.set(node.id, upstreamLayer + 1)
    })

  const minLayer = Math.min(...Array.from(layerById.values()), 0)
  const layers = new Map<number, AppNode[]>()
  componentNodes.forEach((node) => {
    const layer = (layerById.get(node.id) ?? 0) - minLayer
    layers.set(layer, [...(layers.get(layer) ?? []), node])
  })

  return Array.from(layers.entries())
    .sort(([a], [b]) => a - b)
    .map(([, layerNodes]) => layerNodes.sort(compareByPosition))
}

function orderLayersByNeighbors(layers: AppNode[][], incoming: Map<string, string[]>, outgoing: Map<string, string[]>) {
  const ordered = layers.map((layer) => layer.slice())
  let rankById = new Map<string, number>()
  const refreshRanks = () => {
    rankById = new Map()
    ordered.forEach((layer, layerIndex) => {
      layer.forEach((node, nodeIndex) => {
        rankById.set(node.id, layerIndex * 1000 + nodeIndex)
      })
    })
  }
  const sortLayer = (layerIndex: number, neighborIds: (nodeId: string) => string[]) => {
    ordered[layerIndex] = ordered[layerIndex]
      .map((node, index) => {
        const ranks = neighborIds(node.id)
          .map((nodeId) => rankById.get(nodeId))
          .filter((rank): rank is number => typeof rank === 'number')
        const barycenter = ranks.length > 0
          ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
          : Number.POSITIVE_INFINITY
        return { node, index, barycenter }
      })
      .sort((a, b) => {
        if (a.barycenter !== b.barycenter) return a.barycenter - b.barycenter
        return a.index - b.index
      })
      .map((item) => item.node)
  }

  refreshRanks()
  for (let pass = 0; pass < 6; pass += 1) {
    for (let layerIndex = 1; layerIndex < ordered.length; layerIndex += 1) {
      sortLayer(layerIndex, (nodeId) => incoming.get(nodeId) ?? [])
    }
    refreshRanks()
    for (let layerIndex = ordered.length - 2; layerIndex >= 0; layerIndex -= 1) {
      sortLayer(layerIndex, (nodeId) => outgoing.get(nodeId) ?? [])
    }
    refreshRanks()
  }

  return ordered
}

function createLayeredLayout(
  layers: AppNode[][],
  orientation: 'horizontal' | 'vertical',
  incoming: Map<string, string[]> = new Map(),
  _outgoing: Map<string, string[]> = new Map(),
) {
  const positionById = new Map<string, { x: number; y: number }>()

  if (orientation === 'horizontal') {
    const layerWidths = layers.map((layer) => Math.max(...layer.map((node) => getOrganizeNodeSize(node).width)))
    const layerHeights = layers.map((layer) => (
      layer.reduce((sum, node) => sum + getOrganizeNodeSize(node).height, 0)
        + Math.max(0, layer.length - 1) * ORGANIZE_NODE_GAP
    ))
    const width = layerWidths.reduce((sum, layerWidth) => sum + layerWidth, 0)
      + Math.max(0, layers.length - 1) * ORGANIZE_LAYER_GAP
    let height = 1
    let currentX = 0

    layers.forEach((layer, layerIndex) => {
      let currentY = 0
      layer.forEach((node) => {
        const nodeSize = getOrganizeNodeSize(node)
        const upstreamCenters = (incoming.get(node.id) ?? [])
          .map((sourceId) => {
            const sourcePosition = positionById.get(sourceId)
            const sourceNode = layers
              .flat()
              .find((item) => item.id === sourceId)
            if (!sourcePosition || !sourceNode) return null
            return sourcePosition.y + getOrganizeNodeSize(sourceNode).height / 2
          })
          .filter((center): center is number => typeof center === 'number')
        const desiredY = upstreamCenters.length > 0
          ? upstreamCenters.reduce((sum, center) => sum + center, 0) / upstreamCenters.length - nodeSize.height / 2
          : currentY
        currentY = Math.max(currentY, ceilToOrganizeGrid(desiredY))
        positionById.set(node.id, {
          x: snapToOrganizeGrid(currentX),
          y: snapToOrganizeGrid(currentY),
        })
        currentY += nodeSize.height + ORGANIZE_NODE_GAP
      })
      height = Math.max(height, currentY - ORGANIZE_NODE_GAP)
      currentX += layerWidths[layerIndex] + ORGANIZE_LAYER_GAP
    })

    return { positionById, width: ceilToOrganizeGrid(width), height: ceilToOrganizeGrid(height) }
  }

  const layerWidths = layers.map((layer) => (
    layer.reduce((sum, node) => sum + getOrganizeNodeSize(node).width, 0)
      + Math.max(0, layer.length - 1) * ORGANIZE_NODE_GAP
  ))
  const layerHeights = layers.map((layer) => Math.max(...layer.map((node) => getOrganizeNodeSize(node).height)))
  const width = Math.max(...layerWidths, 1)
  const height = layerHeights.reduce((sum, layerHeight) => sum + layerHeight, 0)
    + Math.max(0, layers.length - 1) * ORGANIZE_LAYER_GAP
  let currentY = 0

  layers.forEach((layer, layerIndex) => {
    let currentX = 0
    layer.forEach((node) => {
      const nodeSize = getOrganizeNodeSize(node)
      const upstreamCenters = (incoming.get(node.id) ?? [])
        .map((sourceId) => {
          const sourcePosition = positionById.get(sourceId)
          const sourceNode = layers
            .flat()
            .find((item) => item.id === sourceId)
          if (!sourcePosition || !sourceNode) return null
          return sourcePosition.x + getOrganizeNodeSize(sourceNode).width / 2
        })
        .filter((center): center is number => typeof center === 'number')
      const desiredX = upstreamCenters.length > 0
        ? upstreamCenters.reduce((sum, center) => sum + center, 0) / upstreamCenters.length - nodeSize.width / 2
        : currentX
      currentX = Math.max(currentX, ceilToOrganizeGrid(desiredX))
      positionById.set(node.id, {
        x: snapToOrganizeGrid(currentX),
        y: snapToOrganizeGrid(currentY),
      })
      currentX += nodeSize.width + ORGANIZE_NODE_GAP
    })
    currentY += layerHeights[layerIndex] + ORGANIZE_LAYER_GAP
  })

  return { positionById, width: ceilToOrganizeGrid(width), height: ceilToOrganizeGrid(height) }
}

function pickCompactLayout(
  layers: AppNode[][],
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
  targetBounds: OrganizeViewport,
) {
  const orderedLayers = orderLayersByNeighbors(layers, incoming, outgoing)
  const horizontal = createLayeredLayout(orderedLayers, 'horizontal', incoming, outgoing)
  const maxLayerSize = Math.max(...orderedLayers.map((layer) => layer.length), 1)
  const isLongLinearFlow = orderedLayers.length >= 4 && maxLayerSize <= 2
  const isStrictChain = orderedLayers.length >= 3 && orderedLayers.every((layer) => layer.length === 1)

  if (isStrictChain || isLongLinearFlow) {
    return horizontal
  }

  const vertical = createLayeredLayout(orderedLayers, 'vertical', incoming, outgoing)
  const targetAspect = targetBounds.width / targetBounds.height
  const score = (layout: { width: number; height: number }, orientation: 'horizontal' | 'vertical') => {
    const overflowX = Math.max(0, layout.width - targetBounds.width)
    const overflowY = Math.max(0, layout.height - targetBounds.height)
    const aspectPenalty = Math.abs((layout.width / layout.height) - targetAspect) * 80
    const directionPenalty = orientation === 'vertical' ? orderedLayers.length * 28 : 0
    return overflowX * 3 + overflowY * 3 + aspectPenalty + directionPenalty
  }

  return score(vertical, 'vertical') + 120 < score(horizontal, 'horizontal') ? vertical : horizontal
}

function packLayoutsIntoRows(layouts: OrganizeLayout[], packWidth: number) {
  const rows: OrganizeLayout[][] = []
  let currentRow: OrganizeLayout[] = []
  let currentWidth = 0

  layouts.forEach((layout) => {
    if (currentRow.length > 0 && currentWidth + ORGANIZE_COMPONENT_GAP + layout.width > packWidth) {
      rows.push(currentRow)
      currentRow = []
      currentWidth = 0
    }

    currentRow.push(layout)
    currentWidth += (currentRow.length > 1 ? ORGANIZE_COMPONENT_GAP : 0) + layout.width
  })

  if (currentRow.length > 0) rows.push(currentRow)

  const columnWidths: number[] = []
  const rowHeights = rows.map((row) => Math.max(...row.map((layout) => layout.height), 1))
  const rowWidths = rows.map((row) => (
    row.reduce((sum, layout) => sum + layout.width, 0)
      + Math.max(0, row.length - 1) * ORGANIZE_COMPONENT_GAP
  ))

  rows.forEach((row) => {
    row.forEach((layout, columnIndex) => {
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, layout.width)
    })
  })

  const columnX = columnWidths.reduce<number[]>((positions, width, index) => {
    if (index === 0) return [0]
    const previousX = positions[index - 1]
    const previousWidth = columnWidths[index - 1]
    return [...positions, previousX + previousWidth + ORGANIZE_COMPONENT_GAP]
  }, [])

  const placed: PackedOrganizeLayout[] = []
  let currentY = 0

  rows.forEach((row, rowIndex) => {
    row.forEach((layout, columnIndex) => {
      const rowCenterOffset = Math.max(0, (rowHeights[rowIndex] - layout.height) / 2)
      placed.push({
        layout,
        x: snapToOrganizeGrid(columnX[columnIndex]),
        y: snapToOrganizeGrid(currentY + rowCenterOffset),
      })
    })
    currentY += rowHeights[rowIndex] + ORGANIZE_ROW_GAP
  })

  const width = Math.max(...placed.map((item) => item.x + item.layout.width), 1)
  const height = Math.max(...placed.map((item) => item.y + item.layout.height), 1)
  const rowWaste = rowWidths.reduce((sum, rowWidth, rowIndex) => {
    const weight = rowIndex === 0 ? 1.8 : 1
    return sum + Math.max(0, width - rowWidth) * weight
  }, 0)

  return {
    placed,
    width: ceilToOrganizeGrid(width),
    height: ceilToOrganizeGrid(height),
    rowWaste,
  }
}

function packLayoutsIntoStrictRow(layouts: OrganizeLayout[]) {
  const placed: PackedOrganizeLayout[] = []
  let currentX = 0
  const rowHeight = Math.max(...layouts.map((layout) => layout.height), 1)

  layouts.forEach((layout) => {
    placed.push({
      layout,
      x: snapToOrganizeGrid(currentX),
      y: snapToOrganizeGrid(Math.max(0, (rowHeight - layout.height) / 2)),
    })
    currentX += layout.width + ORGANIZE_COMPONENT_GAP
  })

  const width = Math.max(...placed.map((item) => item.x + item.layout.width), 1)
  const height = Math.max(...placed.map((item) => item.y + item.layout.height), 1)

  return {
    placed,
    width: ceilToOrganizeGrid(width),
    height: ceilToOrganizeGrid(height),
    rowWaste: 0,
  }
}

function packLayoutsIntoFixedColumns(layouts: OrganizeLayout[], columnCount: number) {
  const columns = Array.from({ length: columnCount }, () => ({
    width: 0,
    height: 0,
    items: [] as Array<{ layout: OrganizeLayout, y: number }>,
  }))
  const sortedLayouts = layouts
    .map((layout, index) => ({ layout, index }))
    .sort((a, b) => b.layout.height - a.layout.height || a.index - b.index)

  sortedLayouts.forEach(({ layout }) => {
    const targetColumn = columns
      .map((column, index) => ({ column, index }))
      .sort((a, b) => a.column.height - b.column.height || a.index - b.index)[0]
    const column = targetColumn.column
    column.items.push({
      layout,
      y: column.height > 0 ? column.height + ORGANIZE_ROW_GAP : 0,
    })
    column.width = Math.max(column.width, layout.width)
    column.height = column.items[column.items.length - 1].y + layout.height
  })

  const placed: PackedOrganizeLayout[] = []
  let currentX = 0

  columns.forEach((column) => {
    column.items.forEach((item) => {
      placed.push({
        layout: item.layout,
        x: snapToOrganizeGrid(currentX),
        y: snapToOrganizeGrid(item.y),
      })
    })
    currentX += column.width + ORGANIZE_COMPONENT_GAP
  })

  const width = Math.max(...placed.map((item) => item.x + item.layout.width), 1)
  const height = Math.max(...placed.map((item) => item.y + item.layout.height), 1)

  return {
    placed,
    width: ceilToOrganizeGrid(width),
    height: ceilToOrganizeGrid(height),
    rowWaste: 0,
  }
}

function packComponentLayouts(layouts: OrganizeLayout[], targetBounds: OrganizeViewport) {
  const maxComponentWidth = Math.max(...layouts.map((layout) => layout.width))
  const totalRowWidth = layouts.reduce((sum, layout) => sum + layout.width, 0)
    + Math.max(0, layouts.length - 1) * ORGANIZE_COMPONENT_GAP
  const totalArea = layouts.reduce((sum, layout) => (
    sum + (layout.width + ORGANIZE_COMPONENT_GAP) * (layout.height + ORGANIZE_ROW_GAP)
  ), 0)
  const targetAspect = targetBounds.width / targetBounds.height
  const aspectWidth = Math.sqrt(totalArea * targetAspect)
  const baseWidth = Math.max(maxComponentWidth, targetBounds.width - ORGANIZE_COMPONENT_GAP)
  const candidateWidths = Array.from(new Set([
    maxComponentWidth,
    baseWidth,
    targetBounds.width,
    targetBounds.width * 1.25,
    targetBounds.width * 1.5,
    targetBounds.width * 1.85,
    targetBounds.width * 2.25,
    aspectWidth,
    totalRowWidth,
  ].map((width) => ceilToOrganizeGrid(Math.max(maxComponentWidth, width)))))
    .filter((width) => width <= totalRowWidth)

  const scorePacked = (packed: PackedOrganizeResult) => {
    const aspectPenalty = Math.abs((packed.width / packed.height) - targetAspect) * 180
    const overflowX = Math.max(0, packed.width - targetBounds.width)
    const overflowY = Math.max(0, packed.height - targetBounds.height)
    const skinnyPenalty = packed.height > packed.width * 1.15 ? (packed.height - packed.width * 1.15) * 1.8 : 0
    const unusedTopRightPenalty = packed.width < targetBounds.width * 0.72 && packed.height > targetBounds.height * 0.72
      ? (targetBounds.width * 0.72 - packed.width) * 1.2
      : 0
    const rowWastePenalty = (packed.rowWaste ?? 0) * 0.9
    return overflowX * 0.75 + overflowY * 2.4 + aspectPenalty + skinnyPenalty + unusedTopRightPenalty + rowWastePenalty
  }

  const rowCandidates = candidateWidths.map((width) => packLayoutsIntoRows(layouts, width))
  const strictRowCandidate = packLayoutsIntoStrictRow(layouts)
  const columnCandidates = [2, 3, 4]
    .filter((columnCount) => columnCount <= layouts.length)
    .map((columnCount) => packLayoutsIntoFixedColumns(layouts, columnCount))
  const rowBest: PackedOrganizeResult = [...rowCandidates, strictRowCandidate]
    .sort((a, b) => scorePacked(a) - scorePacked(b))[0]
  const columnBest: PackedOrganizeResult | undefined = columnCandidates
    .sort((a, b) => scorePacked(a) - scorePacked(b))[0]

  if (columnBest && layouts.length >= 4 && (rowBest.rowWaste ?? 0) > targetBounds.width * 0.8) {
    return columnBest
  }

  return [rowBest, columnBest].filter((item): item is PackedOrganizeResult => Boolean(item))
    .sort((a, b) => scorePacked(a) - scorePacked(b))[0]
}

function normalizeOrganizeColumnAlignment(nodes: AppNode[], positionById: Map<string, { x: number; y: number }>) {
  const columns: Array<{
    anchorX: number
    items: Array<{ node: AppNode, x: number, y: number }>
  }> = []

  nodes
    .map((node) => ({
      node,
      position: positionById.get(node.id) ?? node.position,
    }))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .forEach(({ node, position }) => {
      const x = snapToOrganizeGrid(position.x)
      const targetColumn = columns
        .map((column) => ({ column, distance: Math.abs(column.anchorX - x) }))
        .filter((item) => item.distance <= ORGANIZE_COLUMN_ALIGN_TOLERANCE)
        .sort((a, b) => a.distance - b.distance)[0]?.column

      if (!targetColumn) {
        columns.push({ anchorX: x, items: [{ node, x, y: position.y }] })
        return
      }

      targetColumn.items.push({ node, x, y: position.y })
      targetColumn.anchorX = targetColumn.items.reduce((sum, item) => sum + item.x, 0) / targetColumn.items.length
    })

  columns.forEach((column) => {
    if (column.items.length < 2) return

    const sortedXs = column.items.map((item) => item.x).sort((a, b) => a - b)
    const minY = Math.min(...column.items.map((item) => item.y))
    const maxY = Math.max(...column.items.map((item) => item.y))
    const hasVerticalStack = maxY - minY >= ORGANIZE_NODE_GAP
    const hasVisibleDrift = sortedXs[sortedXs.length - 1] - sortedXs[0] >= ORGANIZE_GRID_SIZE

    if (!hasVerticalStack || !hasVisibleDrift) return

    const medianX = sortedXs[Math.floor(sortedXs.length / 2)]
    const targetX = snapToOrganizeGrid(medianX)

    column.items.forEach(({ node, y }) => {
      positionById.set(node.id, { x: targetX, y: snapToOrganizeGrid(y) })
    })
  })
}

function resolveOrganizeOverlaps(nodes: AppNode[], positionById: Map<string, { x: number; y: number }>) {
  const placed: Array<{ id: string, x: number, y: number, width: number, height: number }> = []

  nodes
    .slice()
    .sort((a, b) => {
      const positionA = positionById.get(a.id) ?? a.position
      const positionB = positionById.get(b.id) ?? b.position
      return positionA.y - positionB.y || positionA.x - positionB.x
    })
    .forEach((node) => {
      const size = getOrganizeNodeSize(node)
      const position = positionById.get(node.id) ?? node.position
      let nextY = snapToOrganizeGrid(position.y)
      let hasOverlap = true

      while (hasOverlap) {
        hasOverlap = false
        for (const rect of placed) {
          const overlapsX = position.x < rect.x + rect.width + ORGANIZE_NODE_GAP
            && position.x + size.width + ORGANIZE_NODE_GAP > rect.x
          const overlapsY = nextY < rect.y + rect.height + ORGANIZE_NODE_GAP
            && nextY + size.height + ORGANIZE_NODE_GAP > rect.y
          if (!overlapsX || !overlapsY) continue
          nextY = ceilToOrganizeGrid(rect.y + rect.height + ORGANIZE_NODE_GAP)
          hasOverlap = true
        }
      }

      const resolved = {
        id: node.id,
        x: snapToOrganizeGrid(position.x),
        y: nextY,
        width: size.width,
        height: size.height,
      }
      placed.push(resolved)
      positionById.set(node.id, { x: resolved.x, y: resolved.y })
    })
}

function organizeCanvasNodes(nodes: AppNode[], edges: AppEdge[], viewport?: OrganizeViewport): AppNode[] {
  if (nodes.length <= 1) return nodes

  const nodeIds = new Set(nodes.map((node) => node.id))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()

  nodes.forEach((node) => {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
  })

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return
    incoming.get(edge.target)?.push(edge.source)
    outgoing.get(edge.source)?.push(edge.target)
  })

  const originalBounds = getGraphBounds(nodes)
  const targetBounds = viewport ?? originalBounds
  const components = splitConnectedComponents(nodes, incoming, outgoing)
  const layouts = components.map((componentNodes) => {
    const layers = buildComponentLayers(componentNodes, incoming, outgoing)
    return pickCompactLayout(layers, incoming, outgoing, targetBounds)
  })
  const positionById = new Map<string, { x: number; y: number }>()
  const packed = packComponentLayouts(layouts, targetBounds)
  const packedWidth = packed.width
  const packedHeight = packed.height
  const originX = viewport
    ? targetBounds.x + Math.max(0, (targetBounds.width - packedWidth) / 2)
    : originalBounds.x
  const originY = viewport
    ? targetBounds.y + Math.max(0, (targetBounds.height - packedHeight) / 2)
    : originalBounds.y

  packed.placed.forEach(({ layout, x, y }) => {
    layout.positionById.forEach((position, nodeId) => {
      positionById.set(nodeId, {
        x: snapToOrganizeGrid(originX + x + position.x),
        y: snapToOrganizeGrid(originY + y + position.y),
      })
    })
  })
  normalizeOrganizeColumnAlignment(nodes, positionById)
  resolveOrganizeOverlaps(nodes, positionById)

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? node.position,
  }))
}

function validateConnection(nodes: AppNode[], edges: AppEdge[], connection: Connection): string | null {
  if (!connection.source || !connection.target || connection.source === connection.target) return null

  const sourceNode = nodes.find((n) => n.id === connection.source)
  const targetNode = nodes.find((n) => n.id === connection.target)

  const getNodeMimeType = (node: AppNode | undefined): string | undefined => {
    if (!node || node.type !== 'asset' || !isAssetConfig(node.data.config)) return undefined
    return node.data.config.mimeType
  }

  const sourceMime = getNodeMimeType(sourceNode)
  const sourceKind = getReferenceKind(sourceNode)

  if (targetNode?.type === 'text_input') {
    const textSourceKind = getReferenceKind(sourceNode, { includeText: true })
    if (textSourceKind) {
      const existingRefs = edges.filter((e) => {
        if (e.target !== connection.target) return false
        const src = nodes.find((n) => n.id === e.source)
        return getReferenceKind(src, { includeText: true }) === textSourceKind
      })
      const limitError = validateReferenceKindLimit({
        categoryReferences: getTextCategoryLimits(targetNode),
        categoryKey: ACTIVE_TEXT_CATEGORY,
        referenceKind: textSourceKind,
        existingCount: existingRefs.length,
      })
      if (limitError) return limitError
    }
  }

  if (targetNode?.type === 'storyboard_splitter') {
    if (sourceNode?.type !== 'text_input') return '脚本节点只能连接文本节点'
    const existingInput = edges.some((e) => e.target === connection.target)
    if (existingInput) return '脚本节点只能连接一个文本节点'
  }

  if (targetNode?.type === 'video_stitch') {
    const isVideoSource = sourceNode?.type === 'video_gen'
      || sourceNode?.type === 'video_stitch'
      || (sourceNode?.type === 'asset' && !!sourceMime?.startsWith('video'))
    if (!isVideoSource) return '视频拼接节点只能连接 AI 视频、拼接视频或视频素材'
  }

  if (targetNode?.type === 'image_gen' && sourceKind && sourceKind !== 'text') {
    const existingRefs = edges.filter((e) => {
      if (e.target !== connection.target) return false
      const src = nodes.find((n) => n.id === e.source)
      return getReferenceKind(src) === sourceKind
    })
    const limitError = validateReferenceKindLimit({
      categoryReferences: getImageCategoryLimits(targetNode),
      categoryKey: ACTIVE_IMAGE_CATEGORY,
      referenceKind: sourceKind,
      existingCount: existingRefs.length,
    })
    if (limitError) return limitError
  }

  if (connection.targetHandle === 'any-in' || !connection.targetHandle) {
    if (targetNode?.type === 'video_gen') {
      const videoMode: VideoMode = isVideoGenConfig(targetNode.data.config)
        ? targetNode.data.config.videoMode
        : 'multiref'
      const categoryKey = videoMode === 'keyframe' ? 'frames' : 'multimodal'
      const categoryLimits = getVideoCategoryLimits(targetNode)[categoryKey] ?? DEFAULT_VIDEO_CATEGORY_LIMITS[categoryKey]
      const existingAnyIn = edges.filter((e) => e.target === connection.target && (!e.targetHandle || e.targetHandle === 'any-in'))
      const countByKind = (kind: 'image' | 'video' | 'audio') => existingAnyIn.filter((e) => {
        const src = nodes.find((n) => n.id === e.source)
        return getReferenceKind(src) === kind
      }).length

      if (sourceKind && sourceKind !== 'text') {
        const limitError = validateReferenceKindLimit({
          categoryReferences: { [categoryKey]: categoryLimits },
          categoryKey,
          referenceKind: sourceKind,
          existingCount: countByKind(sourceKind),
        })
        if (limitError) return limitError
      }
    }
  }

  const simulatedEdges = addEdge(connection, edges) as AppEdge[]
  if (hasCycle(nodes, simulatedEdges)) {
    console.warn('[Canvas] 禁止产生循环依赖连线')
    return '禁止产生循环依赖连线'
  }

  return null
}

export const useCanvasStructureStore = create<CanvasStructureState>((set, get) => ({
  canvasId: null,
  workspaceId: null,
  nodes: [],
  edges: [],
  localVersion: 1,
  _past: [],
  _future: [],

  initCanvas: (canvasId, nodes, edges, version, workspaceId) => {
    clearTimeout(dragTimer)
    pendingSnapshot = null
    const { past, future } = loadUndoHistory(canvasId)
    set({ canvasId, nodes, edges, localVersion: version, workspaceId: workspaceId ?? null, _past: past, _future: future })
  },

  setLocalVersion: (version) => {
    set({ localVersion: version })
  },

  flushHistory: () => {
    if (!pendingSnapshot) return
    clearTimeout(dragTimer)
    const { canvasId, _past } = get()
    if (!canvasId) return
    const next = commitSnapshot(canvasId, pendingSnapshot, _past)
    pendingSnapshot = null
    set({ _past: next, _future: [] })
  },

  undo: () => {
    const { canvasId, nodes, edges, _past, _future } = get()
    if (!canvasId || _past.length === 0) return
    const prev = _past[_past.length - 1]
    const newPast = _past.slice(0, -1)
    const newFuture = [{ nodes, edges }, ..._future]
    saveUndoHistory(canvasId, { past: newPast, future: newFuture })
    set({ nodes: prev.nodes, edges: prev.edges, _past: newPast, _future: newFuture })
  },

  redo: () => {
    const { canvasId, nodes, edges, _past, _future } = get()
    if (!canvasId || _future.length === 0) return
    const next = _future[0]
    const newFuture = _future.slice(1)
    const newPast = [..._past, { nodes, edges }].slice(-MAX_UNDO)
    saveUndoHistory(canvasId, { past: newPast, future: newFuture })
    set({ nodes: next.nodes, edges: next.edges, _past: newPast, _future: newFuture })
  },

  onNodesChange: (changes) => {
    const { nodes, edges } = get()
    // Record snapshot of state BEFORE the drag starts (throttled)
    const hasDrag = changes.some((c) => c.type === 'position')
    if (hasDrag) {
      pushSnapshot(get, set, { nodes, edges }, false)
    }
    set({ nodes: applyNodeChanges(changes, nodes) as AppNode[] })
  },

  onEdgesChange: (changes) => {
    const { nodes, edges } = get()
    const hasRemove = changes.some((c) => c.type === 'remove')
    if (hasRemove) {
      pushSnapshot(get, set, { nodes, edges }, true)
    }
    const next = applyEdgeChanges(changes, edges) as AppEdge[]
    set({ edges: next })
  },

  onConnect: (connection) => {
    const { nodes, edges } = get()
    const err = validateConnection(nodes, edges, connection)
    if (err) return err
    if (!connection.source || !connection.target || connection.source === connection.target) return null

    const simulatedEdges = addEdge(connection, edges) as AppEdge[]
    if (simulatedEdges === edges) return null

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ edges: simulatedEdges })
    return null
  },

  addNode: (type, position) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position)
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode) })
  },

  addNodeWithConfig: (type, position, config, id) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position, id)
    newNode.data.config = { ...newNode.data.config, ...config } as CanvasNodeConfig
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode) })
  },

  addNodeAndConnect: (sourceNodeIds, type, position) => {
    const { nodes, edges } = get()
    const newNode = nodeRegistry.createNodeInstance(type, position)
    let nextEdges = edges
    const errors: string[] = []

    for (const sourceNodeId of sourceNodeIds) {
      const connection: Connection = {
        source: sourceNodeId,
        sourceHandle: null,
        target: newNode.id,
        targetHandle: type === 'video_stitch' ? 'video-in' : 'any-in',
      }
      const err = validateConnection([...nodes, newNode], nextEdges, connection)
      if (err) {
        errors.push(err)
        continue
      }
      if (!connection.source || !connection.target || connection.source === connection.target) continue
      const edge = createEdgeWithId(connection)
      if (hasCycle([...nodes, newNode], [...nextEdges, edge])) continue
      nextEdges = nextEdges.concat(edge)
    }

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: nodes.concat(newNode), edges: nextEdges })
    return errors
  },

  addNodesWithEdges: (newNodes, newEdges) => {
    const { nodes, edges } = get()
    let nextEdges = edges
    const allNodes = [...nodes, ...newNodes]
    const errors: string[] = []

    for (const edge of newEdges) {
      const connection: Connection = {
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      }
      const err = validateConnection(allNodes, nextEdges, connection)
      if (err) {
        errors.push(err)
        continue
      }
      if (!connection.source || !connection.target || connection.source === connection.target) continue
      const nextEdge = { ...edge, id: edge.id || `edge_${crypto.randomUUID()}` }
      if (hasCycle(allNodes, [...nextEdges, nextEdge])) continue
      nextEdges = nextEdges.concat(nextEdge)
    }

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: [...nodes, ...newNodes], edges: nextEdges })
    return errors
  },

  removeNodes: (nodeIds) => {
    const { nodes, edges } = get()
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      nodes: nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: edges.filter((e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target)),
    })
  },

  removeEdgeById: (edgeId) => {
    const { nodes, edges } = get()
    if (!edges.some((edge) => edge.id === edgeId)) return
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ edges: edges.filter((edge) => edge.id !== edgeId) })
  },

  removeEdgesByTarget: (nodeId, handleIds) => {
    const { nodes, edges } = get()
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      edges: edges.filter(
        (e) => !(e.target === nodeId && e.targetHandle && handleIds.includes(e.targetHandle))
      ),
    })
  },

  updateNodeData: (nodeId, partialData) => {
    if (!partialData || Object.keys(partialData).length === 0) return
    const { nodes, edges } = get()
    const index = nodes.findIndex((node) => node.id === nodeId)
    if (index === -1) return
    const target = nodes[index]
    const updatedNode: AppNode = { ...target, data: { ...target.data, ...partialData } }
    const next = nodes.slice()
    next[index] = updatedNode
    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: next })
  },

  organizeNodes: (viewport) => {
    const { nodes, edges } = get()
    const next = organizeCanvasNodes(nodes, edges, viewport)
    const changedCount = next.filter((node, index) => {
      const current = nodes[index]
      return node.position.x !== current.position.x || node.position.y !== current.position.y
    }).length
    if (changedCount === 0) return 0

    pushSnapshot(get, set, { nodes, edges }, true)
    set({ nodes: next })
    return changedCount
  },

  applyAgentWorkflow: (workflow) => {
    const { nodes, edges } = get()
    const newNodes = workflow.newNodes.map(createNodeFromAgentNode)
    pushSnapshot(get, set, { nodes, edges }, true)
    set({
      nodes: [...nodes, ...newNodes],
      edges: [...edges, ...workflow.newEdges],
    })
  },
}))
