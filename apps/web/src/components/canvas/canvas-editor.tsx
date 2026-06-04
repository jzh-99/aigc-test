'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import ReactFlow, {
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { nodeRegistry } from '@/lib/canvas/registry'
import { useCanvasPoller } from '@/hooks/canvas/use-canvas-poller'
import { useCanvasAutosave } from '@/hooks/canvas/use-canvas-autosave'
import { useAuthStore } from '@/stores/auth-store'
import { uploadAssetFile, createNodeOutput } from '@/lib/canvas/canvas-api'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import { toast } from 'sonner'
import { computeFloatingParamPanelPosition } from './floating-param-panel-position'
import { NodeParamPanel } from './node-param-panel'
import type { AppNode, AppEdge } from '@/lib/canvas/types'
import { getUpstreamNodeIds } from '@/lib/canvas/dag'
import { generateUUID } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { getCanvasNodeMiniMapColor, getCanvasNodeMiniMapStrokeColor, getCanvasNodeTheme } from '@/lib/canvas/node-theme'
import {
  getCanvasUploadMediaKind,
  getNodeUploadRule,
  getUploadAccept,
  getUploadTargetLabel,
  isFileAllowedForUploadTarget,
  type CanvasUploadTarget,
} from '@/lib/canvas/media-upload-rules'

const nodeTypes = nodeRegistry.getReactFlowTypesMapping()


type NodeMenuCategory = {
  id: 'text' | 'image' | 'video' | 'audio' | 'asset' | 'storyboard_splitter'
  label: string
  baseType: string
  baseLabel: string
  colorClass: string
  testId: string
  items: Array<{ type: string; label: string; testId: string }>
}

const NODE_MENU_CATEGORIES: NodeMenuCategory[] = [
  {
    id: 'text',
    label: '文本',
    baseType: 'text_input',
    baseLabel: '文本',
    colorClass: getCanvasNodeTheme('text_input').menuButtonClassName,
    testId: 'canvas-add-node-text',
    items: []
    // items: [
    //   { type: 'script_writer', label: '剧本', testId: 'canvas-add-node-script' },
    //   { type: 'storyboard_splitter', label: '分镜', testId: 'canvas-add-node-storyboard' },
    // ],
  },
  {
    id: 'image',
    label: '图片',
    baseType: 'image_gen',
    baseLabel: '图片',
    colorClass: getCanvasNodeTheme('image_gen').menuButtonClassName,
    testId: 'canvas-add-node-image',
    items: [],
  },
  {
    id: 'video',
    label: '视频',
    baseType: 'video_gen',
    baseLabel: '视频',
    colorClass: getCanvasNodeTheme('video_gen').menuButtonClassName,
    testId: 'canvas-add-node-video',
    items: [
      // { type: 'video_stitch', label: '视频拼接', testId: 'canvas-add-node-video-stitch' },
    ],
  },
  {
    id: 'audio',
    label: '音频',
    baseType: 'audio_gen',
    baseLabel: '音频',
    colorClass: getCanvasNodeTheme('audio_gen').menuButtonClassName,
    testId: 'canvas-add-node-audio',
    items: [],
  },
  {
    id: 'storyboard_splitter',
    label: '脚本',
    baseType: 'storyboard_splitter',
    baseLabel: '脚本',
    colorClass: getCanvasNodeTheme('storyboard_splitter').menuButtonClassName,
    testId: 'canvas-add-node-storyboard',
    items: [],
  },
  // {
  //   id: 'asset',
  //   label: '资产',
  //   baseType: 'asset',
  //   baseLabel: '资产',
  //   colorClass: 'bg-muted hover:bg-accent text-foreground border border-border',
  //   testId: 'canvas-add-node-asset',
  //   items: [],
  // },
]

function AddNodePanel({ onSelect }: { onSelect: (type: string) => void }) {
  return (
    <div className="group relative bg-background/90 backdrop-blur-md p-2 rounded-xl border border-border shadow-md flex gap-2">
      {NODE_MENU_CATEGORIES.map((category) => (
        <button
          key={category.id}
          data-testid={category.testId}
          onClick={() => onSelect(category.baseType)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${category.colorClass}`}
        >
          + {category.baseLabel}
        </button>
      ))}
      <div className="pointer-events-none absolute left-0 top-full mt-2 w-[360px] opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        {/* <div className="grid grid-cols-4 gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur-md">
          {NODE_MENU_CATEGORIES.map((category) => (
            <div key={category.id} className="min-w-0">
              <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{category.label}</div>
              <div className="space-y-1">
                {category.items.length === 0 ? (
                  <div className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground">暂无</div>
                ) : category.items.map((item) => (
                  <button
                    key={item.type}
                    data-testid={item.testId}
                    onClick={() => onSelect(item.type)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    + {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div> */}
      </div>
    </div>
  )
}

function ContextNodeMenu({
  x,
  y,
  title,
  onSelect,
  onClose,
  onUpload,
  uploadLabel = '上传文件',
  uploadingFromMenu,
}: {
  x: number
  y: number
  title?: string
  onSelect: (type: string) => void
  onClose: () => void
  /** 点击后触发文件选择（仅 add 模式下传入） */
  onUpload?: () => void
  uploadLabel?: string
  /** 上传进行中时禁用按钮 */
  uploadingFromMenu?: boolean
}) {
  return createPortal(
    <div
      className="fixed z-50 min-w-[150px] rounded-xl border border-border bg-background py-1 shadow-xl"
      style={{ top: y, left: x }}
      onMouseLeave={onClose}
    >
      {title && <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{title}</div>}
      {NODE_MENU_CATEGORIES.map((category) => (
        <div key={category.id} className="group/item relative">
          <button
            onClick={() => onSelect(category.baseType)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
          >
            <span>+ {category.baseLabel}</span>
            {/* <span className="text-border">›</span> */}
          </button>
          {/* <div className="pointer-events-none absolute left-full top-0 ml-1 min-w-[140px] rounded-xl border border-border bg-background py-1 opacity-0 shadow-xl group-hover/item:pointer-events-auto group-hover/item:opacity-100">
            <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{category.label}</div>
            {category.items.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">暂无</div>
            ) : category.items.map((item) => (
              <button
                key={item.type}
                onClick={() => onSelect(item.type)}
                className="w-full px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
              >
                + {item.label}
              </button>
            ))}
          </div> */}
        </div>
      ))}
      {/* 上传文件入口：仅 add 模式（非下游节点）时显示 */}
      {onUpload && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            onClick={onUpload}
            disabled={uploadingFromMenu}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {uploadingFromMenu ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <span>↑</span>
            )}
            {uploadLabel}
          </button>
        </>
      )}
    </div>,
    document.body
  )
}

const NODE_CANVAS_H: Record<string, number> = {
  image_gen: 260,
  text_input: 130,
  asset: 200,
  video_gen: 220,
  audio_gen: 160,
  script_writer: 100,
  storyboard_splitter: 100,
  video_stitch: 220,
}

const NODE_CANVAS_W: Record<string, number> = {
  image_gen: 260,
  text_input: 240,
  asset: 160,
  video_gen: 280,
  audio_gen: 240,
  script_writer: 240,
  storyboard_splitter: 280,
  video_stitch: 280,
}

const PARAM_PANEL_INTERACTIVE_NODE_TYPES = new Set(['text_input', 'script_writer', 'storyboard_splitter'])

function isInteractiveNodeClick(event: unknown): boolean {
  if (!(event instanceof MouseEvent)) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('button, input, textarea, select, [data-canvas-node-interactive="true"]'))
}

function FloatingParamPanel({
  node,
  canvasId,
  wrapperRef,
  onClose,
  onExecuted,
  onStoryboardExpandedRef,
}: {
  node: AppNode
  canvasId: string
  wrapperRef: React.RefObject<HTMLDivElement>
  onClose: () => void
  onExecuted: () => void
  onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null>
}) {
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [measuredPanelHeight, setMeasuredPanelHeight] = useState<number | undefined>(undefined)
  // 重构后的单列面板宽度；视频面板因 Seedance 模式下最多 6 个工具栏按钮需要更宽空间
  const PANEL_W = ['storyboard_splitter'].includes(node.type ?? '')
    ? 320
    : node.type === 'audio_gen'
    ? 780
    : node.type === 'video_gen'
    ? 720
    : 420
  const PANEL_MAX_H = 640
  const PANEL_ESTIMATED_H = node.type === 'audio_gen' ? 470 : PANEL_MAX_H
  const GAP = 8

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const updatePanelHeight = () => {
      setMeasuredPanelHeight(Math.min(panel.getBoundingClientRect().height, PANEL_MAX_H))
    }
    updatePanelHeight()

    const resizeObserver = new ResizeObserver(updatePanelHeight)
    resizeObserver.observe(panel)
    return () => resizeObserver.disconnect()
  }, [PANEL_MAX_H, node.id])

  const rect = wrapperRef.current?.getBoundingClientRect()
  if (!rect) return null

  const domNode = wrapperRef.current?.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null
  const nodeRect = domNode?.getBoundingClientRect()
  // 参数面板必须跟随节点的实际 DOM 中心，避免动态宽度节点出现视觉偏移。
  const { top: rawTop, left } = computeFloatingParamPanelPosition({
    panelWidth: PANEL_W,
    panelHeight: measuredPanelHeight ?? PANEL_ESTIMATED_H,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    gap: GAP,
    wrapperRect: rect,
    transform: { x: tx, y: ty, zoom },
    nodePosition: node.position,
    fallbackNodeSize: {
      width: NODE_CANVAS_W[node.type ?? ''] ?? 280,
      height: NODE_CANVAS_H[node.type ?? ''] ?? 200,
    },
    nodeRect: nodeRect
      ? {
          left: nodeRect.left,
          top: nodeRect.top,
          width: nodeRect.width,
          height: nodeRect.height,
        }
      : undefined,
  })
  const top = rawTop

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-40 drop-shadow-2xl"
      style={{ top, left, width: PANEL_W, maxHeight: PANEL_MAX_H, overflowY: 'auto' }}
    >
      <NodeParamPanel
        node={node}
        canvasId={canvasId}
        onClose={onClose}
        onExecuted={onExecuted}
        onStoryboardExpandedRef={onStoryboardExpandedRef}
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
  onKickPollReady,
  onNodeSelected,
  onStoryboardExpandedRef,
}: {
  canvasId: string
  onSave: () => void
  saving: boolean
  lastSaved: Date | null
  onKickPollReady?: (fn: () => void) => void
  onNodeSelected?: (nodeId: string) => boolean
  onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null>
}) {
  const nodes = useCanvasStructureStore((s) => s.nodes)
  const edges = useCanvasStructureStore((s) => s.edges)
  const onNodesChange = useCanvasStructureStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStructureStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStructureStore((s) => s.onConnect)
  const flushHistory = useCanvasStructureStore((s) => s.flushHistory)
  const addNode = useCanvasStructureStore((s) => s.addNode)
  const addNodeWithConfig = useCanvasStructureStore((s) => s.addNodeWithConfig)
  const addNodeAndConnect = useCanvasStructureStore((s) => s.addNodeAndConnect)
  const addNodesWithEdges = useCanvasStructureStore((s) => s.addNodesWithEdges)
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const generatingNodeIds = useCanvasExecutionStore((s) => s.generatingNodeIds)
  const setHighlightedNodes = useCanvasExecutionStore((s) => s.setHighlightedNodes)
  const replaceNodeOutput = useCanvasExecutionStore((s) => s.replaceNodeOutput)
  const initNodeState = useCanvasExecutionStore((s) => s.initNodeState)
  const { project } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const token = useAuthStore((s) => s.accessToken)
  const [uploading, setUploading] = useState(false)

  // 右键菜单上传相关状态
  const uploadFromMenuRef = useRef<HTMLInputElement>(null)
  const [uploadingFromMenu, setUploadingFromMenu] = useState(false)
  /** 记录右键菜单触发时的画布坐标，用于定位新建节点 */
  const uploadMenuPositionRef = useRef<{ x: number; y: number } | null>(null)
  /** 记录右键菜单触发的上传目标，空白画布新增素材节点，节点菜单替换节点资源 */
  const uploadMenuTargetRef = useRef<CanvasUploadTarget | null>(null)

  // Track drag-connect source so onConnectEnd can auto-connect to node body
  const connectStartRef = useRef<{ nodeId: string; handleId: string | null } | null>(null)
  const connectCompletedRef = useRef(false)

  const handleConnectStart = useCallback((_: any, params: { nodeId: string | null; handleId: string | null }) => {
    connectStartRef.current = params.nodeId ? { nodeId: params.nodeId, handleId: params.handleId } : null
    connectCompletedRef.current = false
  }, [])

  const handleConnect = useCallback((connection: any) => {
    connectCompletedRef.current = true
    const err = onConnect(connection)
    if (err) toast.error(err)
  }, [onConnect])

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    // If already connected via handle, skip
    if (connectCompletedRef.current || !connectStartRef.current) return
    const src = connectStartRef.current
    connectStartRef.current = null

    const clientX = 'touches' in event ? event.changedTouches[0].clientX : event.clientX
    const clientY = 'touches' in event ? event.changedTouches[0].clientY : event.clientY

    // Walk up DOM from cursor position to find a ReactFlow node element
    let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    let targetNodeId: string | null = null
    while (el && el !== document.body) {
      if (el.classList?.contains('react-flow__node') && el.dataset?.id) {
        targetNodeId = el.dataset.id
        break
      }
      el = el.parentElement
    }

    if (!targetNodeId || targetNodeId === src.nodeId) return

    // Determine best targetHandle: for keyframe video nodes use any-in; default any-in
    const err = onConnect({
      source: src.nodeId,
      sourceHandle: src.handleId,
      target: targetNodeId,
      targetHandle: 'any-in',
    })
    if (err) toast.error(err)
  }, [onConnect])

  const { kickPoll } = useCanvasPoller(canvasId)

  useEffect(() => {
    onKickPollReady?.(kickPoll)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickPoll])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number; mode: 'add' | 'downstream'; sourceNodeIds: string[]; uploadTarget: CanvasUploadTarget | null } | null>(null)

  const refreshUploadedAssetType = useCallback(async (mediaKind: 'image' | 'video' | 'audio') => {
    if (!token) return
    const sidebar = useCanvasSidebarDataStore.getState()
    if (mediaKind === 'video') await sidebar.refreshVideoAssets(canvasId, token)
    else if (mediaKind === 'audio') await sidebar.refreshAudioAssets(canvasId, token)
    else await sidebar.refreshAssets(canvasId, token)
  }, [canvasId, token])

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const canvasPos = project({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setSelectedNodeIds((prev) => (prev.length === 0 ? prev : []))
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: canvasPos.x,
      canvasY: canvasPos.y,
      mode: 'add',
      sourceNodeIds: [],
      uploadTarget: { kind: 'canvas' },
    })
  }, [project])

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: AppNode) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceNodeIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds
      : selectedNodeId === node.id
      ? [node.id]
      : [node.id]
    const sourceNodes = nodes.filter((n) => sourceNodeIds.includes(n.id))
    const maxX = Math.max(...sourceNodes.map((n) => n.position.x))
    const avgY = sourceNodes.reduce((sum, n) => sum + n.position.y, 0) / sourceNodes.length
    setSelectedEdgeId(null)
    setSelectedNodeIds((prev) => {
      if (sourceNodeIds.length <= 1) return prev.length === 0 ? prev : []
      return prev.length === sourceNodeIds.length && prev.every((id, index) => id === sourceNodeIds[index])
        ? prev
        : sourceNodeIds
    })
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      canvasX: maxX + 340,
      canvasY: avgY,
      mode: 'downstream',
      sourceNodeIds,
      uploadTarget: getNodeUploadRule(node),
    })
  }, [nodes, selectedNodeId, selectedNodeIds])

  const handleContextMenuAdd = useCallback((type: string) => {
    if (!contextMenu) return
    if (contextMenu.mode === 'downstream') {
      const errors = addNodeAndConnect(contextMenu.sourceNodeIds, type, { x: contextMenu.canvasX, y: contextMenu.canvasY })
      errors.forEach((err) => toast.error(err))
    } else {
      addNode(type, { x: contextMenu.canvasX, y: contextMenu.canvasY })
    }
    setContextMenu(null)
  }, [contextMenu, addNode, addNodeAndConnect])

  /** 右键菜单点击"上传文件"：记录坐标后触发隐藏 input */
  const handleContextMenuUpload = useCallback(() => {
    if (!contextMenu?.uploadTarget) return
    uploadMenuPositionRef.current = { x: contextMenu.canvasX, y: contextMenu.canvasY }
    uploadMenuTargetRef.current = contextMenu.uploadTarget
    uploadFromMenuRef.current?.setAttribute('accept', getUploadAccept(contextMenu.uploadTarget))
    setContextMenu(null)
    uploadFromMenuRef.current?.click()
  }, [contextMenu])

  /** 文件选择后：空白画布新增素材节点；节点菜单替换当前图片/视频资源 */
  const handleUploadFromMenu = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!token) { toast.error('请先登录'); return }

    const target = uploadMenuTargetRef.current ?? { kind: 'canvas' as const }
    if (!isFileAllowedForUploadTarget(file, target)) {
      const acceptText = target.kind === 'canvas'
        ? '请选择图片、视频或音频文件'
        : target.mediaKind === 'image'
        ? '当前节点只能上传图片文件'
        : target.mediaKind === 'video'
        ? '当前节点只能上传视频文件'
        : '当前节点只能上传音频文件'
      toast.error(acceptText)
      return
    }

    const position = uploadMenuPositionRef.current ?? { x: 200, y: 200 }
    const mediaKind = getCanvasUploadMediaKind(file)
    if (!mediaKind) {
      toast.error('请选择图片、视频或音频文件')
      return
    }

    setUploadingFromMenu(true)
    try {
      if (target.kind === 'canvas') {
        const nodeId = `node_${generateUUID()}`
        const url = await uploadAssetFile(file, token, { canvasId, canvasNodeId: nodeId })
        const nodeType = mediaKind === 'video' ? 'video_gen' : mediaKind === 'audio' ? 'audio_gen' : 'image_gen'
        addNodeWithConfig(nodeType, position, {}, nodeId)
        const outputId = await createNodeOutput(canvasId, nodeId, url, token)
        initNodeState(nodeId)
        replaceNodeOutput(nodeId, {
          id: outputId,
          url,
          type: mediaKind,
        })
        await refreshUploadedAssetType(mediaKind)
        toast.success('上传成功')
        return
      }

      const url = await uploadAssetFile(file, token, { canvasId, canvasNodeId: target.nodeId })
      if (target.uploadMode === 'output') {
        const outputId = await createNodeOutput(canvasId, target.nodeId, url, token)
        initNodeState(target.nodeId)
        replaceNodeOutput(target.nodeId, {
          id: outputId,
          url,
          type: mediaKind,
        })
      } else {
        updateNodeData(target.nodeId, {
          config: { url, name: file.name, mimeType: file.type, canvasId },
          label: file.name.replace(/\.[^.]+$/, ''),
        })
      }
      await refreshUploadedAssetType(mediaKind)
      toast.success('上传成功')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '上传失败'
      toast.error(message)
    } finally {
      setUploadingFromMenu(false)
    }
  }, [token, canvasId, addNodeWithConfig, initNodeState, replaceNodeOutput, updateNodeData, refreshUploadedAssetType])

  const [showShortcuts, setShowShortcuts] = useState(false)
  const clipboardRef = useRef<{ nodes: AppNode[]; edges: AppEdge[] } | null>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const trackingMouseRef = useRef(false)
  const trackMouse = useCallback((e: MouseEvent) => { mousePosRef.current = { x: e.clientX, y: e.clientY } }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return

      const isMod = e.metaKey || e.ctrlKey

      // Undo: Ctrl+Z
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        flushHistory()
        useCanvasStructureStore.getState().undo()
        setHighlightedNodes(new Set())
        void onSave()
        return
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((isMod && e.key === 'z' && e.shiftKey) || (isMod && e.key === 'y')) {
        e.preventDefault()
        flushHistory()
        useCanvasStructureStore.getState().redo()
        setHighlightedNodes(new Set())
        void onSave()
        return
      }

      if (isMod && e.key === 'c') {
        const sourceIds = selectedNodeIds.length > 1 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []
        const selected = nodes.filter((n) => sourceIds.includes(n.id))
        if (selected.length > 0) {
          clipboardRef.current = {
            nodes: selected,
            edges: edges.filter((edge) => sourceIds.includes(edge.source) || sourceIds.includes(edge.target)),
          }
          if (!trackingMouseRef.current) {
            trackingMouseRef.current = true
            window.addEventListener('mousemove', trackMouse, { passive: true })
          }
        }
        return
      }

      if (isMod && e.key === 'v' && clipboardRef.current) {
        const rect = wrapperRef.current?.getBoundingClientRect()
        if (!rect) return
        const pos = project({
          x: mousePosRef.current.x - rect.left,
          y: mousePosRef.current.y - rect.top,
        })
        const copiedNodes = clipboardRef.current.nodes
        const idMap = new Map(copiedNodes.map((node) => [node.id, `node_${crypto.randomUUID()}`]))
        const minX = Math.min(...copiedNodes.map((node) => node.position.x))
        const minY = Math.min(...copiedNodes.map((node) => node.position.y))
        const newNodes = copiedNodes.map((node) => ({
          ...node,
          id: idMap.get(node.id)!,
          selected: false,
          position: {
            x: pos.x + (node.position.x - minX) + 20,
            y: pos.y + (node.position.y - minY) + 20,
          },
          data: {
            ...node.data,
            config: JSON.parse(JSON.stringify(node.data.config)),
          },
        }))
        const newEdges = clipboardRef.current.edges.map((edge) => {
          const source = idMap.get(edge.source) ?? edge.source
          const target = idMap.get(edge.target) ?? edge.target
          return {
            ...edge,
            id: `edge_${source}_${edge.sourceHandle ?? 'source'}_${target}_${edge.targetHandle ?? 'target'}_${crypto.randomUUID()}`,
            source,
            target,
            selected: false,
          }
        })
        const errors = addNodesWithEdges(newNodes, newEdges)
        errors.forEach((err) => toast.error(err))
        setSelectedNodeId(newNodes.length === 1 ? newNodes[0].id : null)
        setSelectedNodeIds(newNodes.length > 1 ? newNodes.map((node) => node.id) : [])
        window.removeEventListener('mousemove', trackMouse)
        trackingMouseRef.current = false
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (trackingMouseRef.current) {
        window.removeEventListener('mousemove', trackMouse)
        trackingMouseRef.current = false
      }
    }
  }, [selectedNodeId, selectedNodeIds, nodes, edges, addNodesWithEdges, project, trackMouse, flushHistory, onSave])

  const handleAddNode = useCallback((type: string) => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    const existingCount = nodes.filter((n) => n.type === type).length
    const offset = existingCount * 40
    const position = project({ x: rect.width / 2 + offset, y: rect.height / 2 + offset })
    addNode(type, position)
  }, [addNode, project, nodes])

  // Delete key: remove selected node or edge
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeId) {
          onEdgesChange([{ type: 'remove', id: selectedEdgeId }])
          setSelectedEdgeId(null)
        } else if (selectedNodeIds.length > 1) {
          removeNodes(selectedNodeIds)
          setSelectedNodeIds([])
          setSelectedNodeId(null)
        } else if (selectedNodeId) {
          removeNodes([selectedNodeId])
          setSelectedNodeId(null)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, selectedNodeIds, selectedEdgeId, removeNodes, onEdgesChange])

  // Drop file onto canvas → create corresponding node by media type
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return

    // 侧边栏资产库拖入：读取自定义数据
    const assetDataRaw = e.dataTransfer.getData('application/x-canvas-asset')
    if (assetDataRaw) {
      if (!token) { toast.error('请先登录'); return }
      try {
        const assetData = JSON.parse(assetDataRaw) as { url: string; type: string }
        const position = project({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        const mediaKind: 'image' | 'video' | 'audio' = assetData.type.startsWith('video') ? 'video' : assetData.type.startsWith('audio') ? 'audio' : 'image'
        const nodeType = mediaKind === 'video' ? 'video_gen' : mediaKind === 'audio' ? 'audio_gen' : 'image_gen'
        const nodeId = `node_${generateUUID()}`
        addNodeWithConfig(nodeType, position, {}, nodeId)
        const outputId = await createNodeOutput(canvasId, nodeId, assetData.url, token)
        initNodeState(nodeId)
        replaceNodeOutput(nodeId, { id: outputId, url: assetData.url, type: mediaKind })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '拖入资产失败'
        toast.error(message)
      }
      return
    }

    // 外部文件拖入
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/') || f.type.startsWith('audio/')
    )
    if (!files.length) return
    if (!token) { toast.error('请先登录'); return }

    setUploading(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const position = project({
          x: e.clientX - rect.left + i * 180,
          y: e.clientY - rect.top,
        })
        try {
          const mediaKind = getCanvasUploadMediaKind(file)
          if (!mediaKind) continue
          const nodeId = `node_${generateUUID()}`
          const url = await uploadAssetFile(file, token, { canvasId, canvasNodeId: nodeId })
          const nodeType = mediaKind === 'video' ? 'video_gen' : mediaKind === 'audio' ? 'audio_gen' : 'image_gen'
          addNodeWithConfig(nodeType, position, {}, nodeId)
          const outputId = await createNodeOutput(canvasId, nodeId, url, token)
          initNodeState(nodeId)
          replaceNodeOutput(nodeId, { id: outputId, url, type: mediaKind })
          await refreshUploadedAssetType(mediaKind)
        } catch (err: any) {
          toast.error(`上传 ${file.name} 失败: ${err.message}`)
        }
      }
    } finally {
      setUploading(false)
    }
  }, [token, project, addNodeWithConfig, canvasId, refreshUploadedAssetType, initNodeState, replaceNodeOutput])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  // Compute direct upstream node IDs for lineage highlighting (one layer only)
  const directUpstreamIds = useMemo(
    () => selectedNodeId ? new Set(getUpstreamNodeIds(selectedNodeId, edges)) : new Set<string>(),
    [selectedNodeId, edges]
  )

  // Style edges — full .map() on every selection/generation change.
  // At <200 edges the cost is <1ms; if edge counts grow significantly,
  // consider a diffing approach that only spreads changed edges.
  const styledEdges = useMemo<AppEdge[]>(() => edges.map((edge) => {
    const isUpstream = selectedNodeId
      ? edge.target === selectedNodeId
      : false
    const isActive = generatingNodeIds.has(edge.target)
    const isSelected = edge.id === selectedEdgeId

    if (isSelected) return { ...edge, animated: false, style: { stroke: '#ef4444', strokeWidth: 2 } }
    if (isActive) return { ...edge, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } }
    if (isUpstream) return { ...edge, animated: false, style: { stroke: '#a78bfa', strokeWidth: 2 } }
    return { ...edge, animated: false, style: { stroke: '#d4d4d8', strokeWidth: 1.5 } }
  }), [edges, selectedNodeId, selectedEdgeId, generatingNodeIds])

  // Push direct upstream highlight set into execution store so nodes read it directly
  // (avoids recreating all node data objects on selection change)
  useEffect(() => {
    setHighlightedNodes(directUpstreamIds)
  }, [directUpstreamIds, setHighlightedNodes])

  // nodes passed to ReactFlow are stable — no data mutation needed
  const saveLabel = saving
    ? '保存中…'
    : lastSaved
    ? `已保存 ${lastSaved.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '保存'

  const handleSelectionChange = useCallback(({ nodes: sel }: { nodes: Array<{ id: string }> }) => {
    if (sel.length > 1) {
      const next = sel.map((n) => n.id)
      setSelectedNodeIds((prev) => {
        if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev
        return next
      })
      return
    }
    setSelectedNodeIds((prev) => (prev.length === 0 ? prev : []))
  }, [])

  const handleNodeClick = useCallback((event: unknown, node: AppNode) => {
    if (onNodeSelected?.(node.id)) return // consumed by agent — skip selection
    if (!PARAM_PANEL_INTERACTIVE_NODE_TYPES.has(node.type ?? '') && isInteractiveNodeClick(event)) return
    setSelectedEdgeId(null)
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
  }, [onNodeSelected])

  const handleEdgeClick = useCallback((_e: unknown, edge: AppEdge) => {
    setSelectedNodeId(null)
    setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id))
  }, [])

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setSelectedNodeIds((prev) => (prev.length === 0 ? prev : []))
    setContextMenu((prev) => (prev ? null : prev))
  }, [])

  return (
    <div
      className="w-full h-full relative"
      ref={wrapperRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{
        background: 'hsl(var(--background))',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
    >
      {uploading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="bg-card rounded-xl px-4 py-2 shadow-lg text-sm font-medium text-foreground">上传中…</div>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center">
              <span className="text-2xl">✦</span>
            </div>
            <p className="text-sm font-medium text-muted-foreground">右键画布或点击顶部按钮添加节点</p>
            <p className="text-xs text-muted-foreground/70">拖拽图片/视频/音频到画布可快速创建素材节点</p>
          </div>
        </div>
      )}

      {/* Selected edge delete hint */}
      {selectedEdgeId && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-foreground/90 text-background text-xs px-3 py-1.5 rounded-lg shadow-lg">
            按 Delete 删除连线
          </div>
        </div>
      )}

      {/* Multi-select hint */}
      {selectedNodeIds.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-foreground/90 text-background text-xs px-3 py-1.5 rounded-lg shadow-lg">
            已选中 {selectedNodeIds.length} 个节点 · 按 Delete 批量删除
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart as any}
        onConnectEnd={handleConnectEnd as any}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick as any}
        onEdgeClick={handleEdgeClick as any}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu as any}
        onNodeContextMenu={handleNodeContextMenu as any}
        onSelectionChange={handleSelectionChange as any}
        fitView
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'hsl(var(--background))' }}
        deleteKeyCode={null}
        panOnDrag
        panOnScroll
        selectionOnDrag={false}
        selectionKeyCode="Control"
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
      >
        <Controls
          className="!bg-card !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-muted [&>button:hover]:!text-foreground"
        />
        <MiniMap
          nodeColor={(node) => getCanvasNodeMiniMapColor(node.type)}
          nodeStrokeColor={(node) => getCanvasNodeMiniMapStrokeColor(node.type)}
          nodeBorderRadius={4}
          maskColor="rgba(0,0,0,0.06)"
          className="!bg-card/90 !border-border !rounded-xl"
          style={{ width: 140, height: 90 }}
        />
        <Panel position="top-left" className="!m-0">
          <AddNodePanel onSelect={handleAddNode} />
        </Panel>
        <Panel position="top-right" className="flex gap-1.5">
          <button
            onClick={() => {
              flushHistory()
              useCanvasStructureStore.getState().undo()
              setHighlightedNodes(new Set())
              void onSave()
            }}
            className="px-2 py-1.5 text-xs font-medium bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border shadow-sm transition-colors"
            title="撤销 (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            onClick={() => {
              flushHistory()
              useCanvasStructureStore.getState().redo()
              setHighlightedNodes(new Set())
              void onSave()
            }}
            className="px-2 py-1.5 text-xs font-medium bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border shadow-sm transition-colors"
            title="重做 (Ctrl+Shift+Z)"
          >
            ↪
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border shadow-sm transition-colors disabled:opacity-60 min-w-[80px] justify-center"
          >
            {saving && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />}
            {saveLabel}
          </button>
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className={`px-2 py-1.5 text-xs font-medium rounded-lg border shadow-sm transition-colors ${showShortcuts ? 'bg-foreground text-background border-foreground' : 'bg-card hover:bg-muted text-muted-foreground border-border'}`}
            title="快捷键"
          >
            ?
          </button>
        </Panel>

        {showShortcuts && (
          <Panel position="top-right" className="mt-10">
            <div className="bg-card/95 backdrop-blur-sm text-foreground text-xs rounded-xl shadow-2xl border border-border p-4 w-56 space-y-2.5">
              <div className="font-semibold text-muted-foreground mb-1">快捷键</div>
              {[
                ['Ctrl+Z', '撤销'],
                ['Ctrl+Shift+Z', '重做'],
                ['Ctrl+C', '复制节点'],
                ['Ctrl+V', '粘贴节点'],
                ['Delete / ⌫', '删除节点/连线'],
                ['右键画布', '添加节点菜单'],
                ['Shift+拖拽', '多选节点'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <kbd className="bg-muted text-foreground px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap border border-border">{key}</kbd>
                  <span className="text-muted-foreground text-right">{desc}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {selectedNode && (
        <FloatingParamPanel
          node={selectedNode}
          canvasId={canvasId}
          wrapperRef={wrapperRef}
          onClose={() => setSelectedNodeId(null)}
          onExecuted={kickPoll}
          onStoryboardExpandedRef={onStoryboardExpandedRef}
        />
      )}

      {/* 右键菜单上传文件的隐藏 input */}
      <input
        ref={uploadFromMenuRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleUploadFromMenu}
      />

      {contextMenu && (
        <ContextNodeMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.mode === 'downstream' ? '创建下游节点' : undefined}
          onSelect={handleContextMenuAdd}
          onClose={() => setContextMenu(null)}
          onUpload={contextMenu.uploadTarget ? handleContextMenuUpload : undefined}
          uploadLabel={contextMenu.uploadTarget ? getUploadTargetLabel(contextMenu.uploadTarget) : undefined}
          uploadingFromMenu={uploadingFromMenu}
        />
      )}
    </div>
  )
}

export function CanvasEditor({ canvasId, onKickPollReady, onNodeSelected, onStoryboardExpandedRef }: { canvasId: string; onKickPollReady?: (fn: () => void) => void; onNodeSelected?: (nodeId: string) => boolean; onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null> }) {
  const token = useAuthStore((s) => s.accessToken)
  const prefetchSidebar = useCanvasSidebarDataStore((s) => s.prefetch)

  const { save, saving, lastSaved } = useCanvasAutosave(canvasId)

  useEffect(() => {
    if (!canvasId || !token) return
    prefetchSidebar(canvasId, token)
  }, [canvasId, token, prefetchSidebar])

  return (
    <ReactFlowProvider>
      <Flow canvasId={canvasId} onSave={save} saving={saving} lastSaved={lastSaved} onKickPollReady={onKickPollReady} onNodeSelected={onNodeSelected} onStoryboardExpandedRef={onStoryboardExpandedRef} />
    </ReactFlowProvider>
  )
}
