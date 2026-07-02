'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import ReactFlow, {
  Background,
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
import { NodeParamPanel } from './node-param-panel'
import type { AppNode, AppEdge } from '@/lib/canvas/types'
import { getUpstreamNodeIds } from '@/lib/canvas/dag'
import { generateUUID } from '@/lib/utils'
import { Grid3X3, LayoutGrid, Loader2 } from 'lucide-react'
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

// 节点类型兼容性映射：源节点类型 → 允许的下游节点类型
const NODE_COMPATIBILITY: Record<string, string[]> = {
  // 文本节点可以连接到：图片、视频、音频、脚本、分镜
  'text_input': ['image_gen', 'video_gen', 'audio_gen', 'script_writer', 'storyboard_splitter'],
  // 图片节点可以连接到：视频、音频
  'image_gen': ['video_gen', 'audio_gen'],
  // 视频节点可以连接到：拼接、音频
  'video_gen': ['video_stitch', 'audio_gen'],
  // 音频节点可以连接到：视频
  'audio_gen': ['video_gen'],
  // 资产节点根据类型判断
  'asset': ['video_gen', 'audio_gen', 'image_gen'],
  // 剧本节点可以连接到：分镜
  'script_writer': ['storyboard_splitter'],
  // 分镜节点通常不再连接其他节点
  'storyboard_splitter': [],
  // 视频拼接节点可以连接到：音频
  'video_stitch': ['audio_gen'],
}

function getCompatibleNodeTypes(sourceNodeType: string): Set<string> {
  const allowed = NODE_COMPATIBILITY[sourceNodeType] || []
  return new Set(allowed)
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
  sourceNodeId, // 新增：源节点ID，用于类型判断
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
  /** 源节点ID，用于判断兼容性 */
  sourceNodeId?: string
}) {
  // 使用 ref 来管理菜单元素，避免重复创建和销毁
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 获取源节点类型
  let sourceNodeType: string | null = null
  if (sourceNodeId) {
    // 通过全局 store 获取节点信息
    const nodes = useCanvasStructureStore.getState().nodes
    const sourceNode = nodes.find(n => n.id === sourceNodeId)
    sourceNodeType = sourceNode?.type || null
  }

  // 计算兼容的节点类型
  const compatibleTypes = sourceNodeType ? getCompatibleNodeTypes(sourceNodeType) : null

  useEffect(() => {
    // 如果菜单已存在，更新位置和内容
    if (menuRef.current && document.body.contains(menuRef.current)) {
      menuRef.current.style.top = `${y}px`
      menuRef.current.style.left = `${x}px`
      return
    }

    // 创建新菜单
    const menuEl = document.createElement('div')
    menuEl.id = 'context-menu'
    menuEl.style.cssText = `
      position: fixed !important;
      top: ${y}px !important;
      left: ${x}px !important;
      min-width: 150px;
      background: hsl(var(--background)) !important;
      border: 1px solid hsl(var(--border)) !important;
      border-radius: 12px;
      padding: 4px;
      z-index: 9999 !important;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      opacity: 1 !important;
      visibility: visible !important;
      display: block !important;
      pointer-events: auto !important;
    `

    // 创建标题
    if (title) {
      const titleEl = document.createElement('div')
      titleEl.style.cssText = 'padding: 6px 12px; font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); border-bottom: 1px solid hsl(var(--border)); margin-bottom: 4px;'
      titleEl.textContent = title
      menuEl.appendChild(titleEl)
    }

    if (onUpload) {
      const uploadBtn = document.createElement('button')
      uploadBtn.type = 'button'
      uploadBtn.disabled = !!uploadingFromMenu
      uploadBtn.style.cssText = `
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 500;
        color: hsl(var(--foreground));
        background: transparent;
        border: none;
        border-radius: 6px;
        margin-bottom: 4px;
        cursor: ${uploadingFromMenu ? 'not-allowed' : 'pointer'};
        opacity: ${uploadingFromMenu ? '0.6' : '1'};
        transition: all 0.15s;
      `
      uploadBtn.innerHTML = `<span>${uploadingFromMenu ? '上传中...' : uploadLabel}</span>`
      if (!uploadingFromMenu) {
        uploadBtn.onmouseenter = () => {
          uploadBtn.style.background = 'hsl(var(--muted))'
        }
        uploadBtn.onmouseleave = () => {
          uploadBtn.style.background = 'transparent'
        }
        uploadBtn.onclick = () => {
          onUpload()
        }
      }
      menuEl.appendChild(uploadBtn)
    }

    // 创建按钮
    NODE_MENU_CATEGORIES.forEach((category) => {
      const btn = document.createElement('button')
      const isCompatible = compatibleTypes === null || compatibleTypes.has(category.baseType)

      btn.style.cssText = `
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 500;
        color: ${isCompatible ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'};
        background: transparent;
        border: none;
        border-radius: 6px;
        margin-bottom: 2px;
        cursor: ${isCompatible ? 'pointer' : 'not-allowed'};
        opacity: ${isCompatible ? '1' : '0.5'};
        transition: all 0.15s;
      `

      btn.innerHTML = `<span>+ ${category.baseLabel}</span>`

      if (isCompatible) {
        btn.onmouseenter = () => {
          btn.style.background = 'hsl(var(--muted))'
        }
        btn.onmouseleave = () => {
          btn.style.background = 'transparent'
        }
        btn.onclick = () => {
          onSelect(category.baseType)
        }
      } else {
        btn.title = `当前节点类型无法连接到 ${category.baseLabel}`
      }

      menuEl.appendChild(btn)
    })

    // 添加到 document.body
    document.body.appendChild(menuEl)
    menuRef.current = menuEl

    // 清理函数
    return () => {
      if (menuRef.current && document.body.contains(menuRef.current)) {
        document.body.removeChild(menuRef.current)
        menuRef.current = null
      }
    }
  }, [x, y, title, onSelect, onUpload, uploadLabel, uploadingFromMenu, compatibleTypes])

  // 返回一个占位符（实际渲染在 useEffect 中完成）
  return null
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
const CANVAS_GRID_STORAGE_KEY = 'toby-canvas-show-grid'

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
  isDragging,
}: {
  node: AppNode
  canvasId: string
  wrapperRef: React.RefObject<HTMLDivElement>
  onClose: () => void
  onExecuted: () => void
  onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null>
  isDragging?: boolean
}) {
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const [measuredNodeSize, setMeasuredNodeSize] = useState<{ width: number; height: number } | null>(null)
  // 重构后的单列面板宽度；视频面板因 Seedance 模式下最多 6 个工具栏按钮需要更宽空间
  const PANEL_W = ['storyboard_splitter'].includes(node.type ?? '')
    ? 320
    : node.type === 'audio_gen'
    ? 780
    : node.type === 'video_gen'
    ? 680
    : 420
  const GAP = 4

  useEffect(() => {
    const domNode = wrapperRef.current?.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null
    if (!domNode) {
      setMeasuredNodeSize(null)
      return
    }

    const updateNodeSize = () => {
      const next = {
        width: domNode.offsetWidth,
        height: domNode.offsetHeight,
      }
      setMeasuredNodeSize((current) => (
        current?.width === next.width && current.height === next.height ? current : next
      ))
    }
    updateNodeSize()

    const resizeObserver = new ResizeObserver(updateNodeSize)
    resizeObserver.observe(domNode)
    return () => resizeObserver.disconnect()
  }, [node.id, wrapperRef])

  if (isDragging) return null

  const nodeWidth = measuredNodeSize?.width ?? NODE_CANVAS_W[node.type ?? ''] ?? 280
  const nodeHeight = measuredNodeSize?.height ?? NODE_CANVAS_H[node.type ?? ''] ?? 200
  const nodeCenterX = node.position.x * zoom + tx + (nodeWidth * zoom) / 2
  const nodeBottom = node.position.y * zoom + ty + nodeHeight * zoom

  const top = nodeBottom + GAP
  const left = nodeCenterX - PANEL_W / 2

  return (
    <div
      className="absolute z-20 drop-shadow-2xl"
      style={{ top, left, width: PANEL_W }}
    >
      <NodeParamPanel
        node={node}
        canvasId={canvasId}
        onClose={onClose}
        onExecuted={onExecuted}
        onStoryboardExpandedRef={onStoryboardExpandedRef}
      />
    </div>
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
  const organizeNodes = useCanvasStructureStore((s) => s.organizeNodes)
  const generatingNodeIds = useCanvasExecutionStore((s) => s.generatingNodeIds)
  const setHighlightedNodes = useCanvasExecutionStore((s) => s.setHighlightedNodes)
  const replaceNodeOutput = useCanvasExecutionStore((s) => s.replaceNodeOutput)
  const initNodeState = useCanvasExecutionStore((s) => s.initNodeState)
  const { project, fitView, screenToFlowPosition } = useReactFlow()
  const [,, zoom] = useStore((s) => s.transform)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem(CANVAS_GRID_STORAGE_KEY) !== 'false'
  })
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

    // 触发连接动画事件
    if (!err && connection.target) {
      window.dispatchEvent(new CustomEvent('node-connected', {
        detail: {
          targetNodeId: connection.target,
          targetHandleId: connection.targetHandle || 'any-in'
        }
      }))
    }
  }, [onConnect])

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    // If already connected via handle, skip
    if (connectCompletedRef.current || !connectStartRef.current) {
      return
    }

    const src = connectStartRef.current
    connectStartRef.current = null

    // 记录连接结束时间戳，防止立即被 handlePaneClick 关闭
    connectEndTimestampRef.current = Date.now()

    const clientX = 'touches' in event ? event.changedTouches[0].clientX : event.clientX
    const clientY = 'touches' in event ? event.changedTouches[0].clientY : event.clientY

    // Walk up DOM from cursor position to find a ReactFlow node element
    let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    let targetNodeId: string | null = null
    while (el && el !== document.body) {
      // 只检测真正的节点元素，不检测其他 UI 元素
      if (el.classList?.contains('react-flow__node') && el.dataset?.id) {
        targetNodeId = el.dataset.id
        break
      }
      el = el.parentElement
    }

    // 如果找到目标节点且不是源节点，连接到它
    if (targetNodeId && targetNodeId !== src.nodeId) {
      const err = onConnect({
        source: src.nodeId,
        sourceHandle: src.handleId,
        target: targetNodeId,
        targetHandle: 'any-in',
      })
      if (err) toast.error(err)
      return
    }

    // 没有找到有效目标节点 → 空画布拖放，显示节点创建菜单
    // 检查是否在画布区域内（而不是在工具栏、面板等区域）
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return

    // 检查鼠标是否在画布容器范围内（允许一定误差）
    const isInCanvas = (
      clientX >= rect.left - 10 &&
      clientX <= rect.right + 10 &&
      clientY >= rect.top - 10 &&
      clientY <= rect.bottom + 10
    )

    if (!isInCanvas) {
      // 鼠标在画布外，不显示菜单
      return
    }

    // 使用 screenToFlowPosition 转换坐标（推荐方式，无需手动计算偏移）
    const canvasPos = screenToFlowPosition({ x: clientX, y: clientY })

    // 边界检测：确保菜单不会超出视口
    // 预估菜单高度约为 200px，宽度约为 150px
    const MENU_HEIGHT = 200
    const MENU_WIDTH = 150
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // 调整菜单位置，避免超出视口
    let adjustedX = clientX
    let adjustedY = clientY

    if (clientX + MENU_WIDTH > viewportWidth) {
      adjustedX = viewportWidth - MENU_WIDTH - 10
    }
    if (clientY + MENU_HEIGHT > viewportHeight) {
      adjustedY = clientY - MENU_HEIGHT - 10 // 如果下方空间不够，显示在上方
    }

    // 设置右键菜单为 downstream 模式，显示节点选择器
    setContextMenu({
      x: adjustedX,
      y: adjustedY,
      canvasX: canvasPos.x,
      canvasY: canvasPos.y,
      mode: 'downstream',
      sourceNodeIds: [src.nodeId],
      uploadTarget: null, // 不显示上传选项
    })

    // 设置临时连接线，显示从源节点到菜单的连接
    setTempConnectionLine({
      sourceNodeId: src.nodeId,
      targetX: canvasPos.x,
      targetY: canvasPos.y
    })
  }, [onConnect, screenToFlowPosition])

  const { kickPoll } = useCanvasPoller(canvasId)

  useEffect(() => {
    onKickPollReady?.(kickPoll)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kickPoll])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number; mode: 'add' | 'downstream'; sourceNodeIds: string[]; uploadTarget: CanvasUploadTarget | null } | null>(null)
  const connectEndTimestampRef = useRef(0)
  const [tempConnectionLine, setTempConnectionLine] = useState<{ sourceNodeId: string; targetX: number; targetY: number } | null>(null)

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
    setTempConnectionLine(null) // 清除临时连接线
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

  const handleOrganizeNodes = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    const viewport = rect
      ? (() => {
        const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top })
        const bottomRight = screenToFlowPosition({ x: rect.right, y: rect.bottom })
        return {
          x: topLeft.x,
          y: topLeft.y,
          width: Math.max(1, bottomRight.x - topLeft.x),
          height: Math.max(1, bottomRight.y - topLeft.y),
        }
      })()
      : undefined
    const changedCount = organizeNodes(viewport)
    // if (changedCount === 0) {
    //   toast.info(nodes.length <= 1 ? '暂无可整理的节点' : '画布已经很整齐了')
    //   return
    // }

    setHighlightedNodes(new Set())
    setSelectedNodeId(null)
    setSelectedNodeIds([])
    setSelectedEdgeId(null)
    window.setTimeout(() => {
      fitView({ padding: 0.18, duration: 260 })
    }, 0)
    void onSave()
    // toast.success(`已整理 ${changedCount} 个节点`)
  }, [fitView, nodes.length, onSave, organizeNodes, screenToFlowPosition, setHighlightedNodes])

  const handleToggleGrid = useCallback(() => {
    setShowGrid((current) => {
      const next = !current
      window.localStorage.setItem(CANVAS_GRID_STORAGE_KEY, String(next))
      return next
    })
  }, [])

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

    if (isSelected) {
      return {
        ...edge,
        animated: false,
        className: 'canvas-edge canvas-edge--selected',
        style: { stroke: '#a855f7', strokeWidth: 2.5 },
      }
    }
    if (isActive) {
      return {
        ...edge,
        animated: true,
        className: 'canvas-edge canvas-edge--active',
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
      }
    }
    if (isUpstream) {
      return {
        ...edge,
        animated: false,
        className: 'canvas-edge canvas-edge--upstream',
        style: { stroke: '#a78bfa', strokeWidth: 2 },
      }
    }
    return {
      ...edge,
      animated: false,
      className: 'canvas-edge',
      style: { stroke: '#d4d4d8', strokeWidth: 1.5 },
    }
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

    // 如果刚刚结束连接拖拽（100ms 内），不要关闭菜单
    const timeSinceConnectEnd = Date.now() - connectEndTimestampRef.current
    if (timeSinceConnectEnd < 100) {
      return
    }

    setContextMenu((prev) => {
      if (prev) {
        return null
      }
      return prev
    })
  }, [])

  const handleNodeDragStart = useCallback((_: unknown, node: AppNode) => {
    setDraggingNodeId(node.id)
  }, [])

  const handleNodeDragStop = useCallback(() => {
    setDraggingNodeId(null)
  }, [])

  // 计算临时连接线的 SVG 路径
  const tempConnectionLinePath = useMemo(() => {
    if (!tempConnectionLine || !wrapperRef.current) return null

    const sourceNode = nodes.find(n => n.id === tempConnectionLine.sourceNodeId)
    if (!sourceNode) return null

    // 获取节点的实际 DOM 元素位置
    const nodeEl = wrapperRef.current.querySelector(`[data-id="${tempConnectionLine.sourceNodeId}"]`) as HTMLElement
    if (!nodeEl) return null

    const nodeRect = nodeEl.getBoundingClientRect()
    const wrapperRect = wrapperRef.current.getBoundingClientRect()

    // 计算源节点的右侧中心点（source handle 位置）
    const sourceX = (nodeRect.right - wrapperRect.left) / zoom
    const sourceY = (nodeRect.top + nodeRect.height / 2 - wrapperRect.top) / zoom

    // 目标点（菜单位置，已经是画布坐标）
    const targetX = tempConnectionLine.targetX
    const targetY = tempConnectionLine.targetY

    // 使用贝塞尔曲线连接
    const deltaX = Math.abs(targetX - sourceX)
    const controlOffset = Math.min(deltaX * 0.5, 100)

    const path = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`

    return { path, sourceX, sourceY, targetX, targetY }
  }, [tempConnectionLine, nodes, zoom, wrapperRef])

  return (
    <div ref={wrapperRef} className="relative w-full h-full overflow-hidden">
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
        onNodeDragStart={handleNodeDragStart as any}
        onNodeDragStop={handleNodeDragStop as any}
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
        {showGrid && (
          <>
            <Background
              id="canvas-grid-minor"
              gap={24}
              size={1.5}
              color="hsl(var(--muted-foreground))"
              className="opacity-50"
            />
            <Background
              id="canvas-grid-major"
              gap={120}
              size={2.4}
              color="hsl(var(--muted-foreground))"
              className="opacity-70"
            />
          </>
        )}
        <Controls
          className="!rounded-lg !border !border-border/80 !bg-background/95 !shadow-lg !shadow-foreground/10 [&>button]:!h-8 [&>button]:!w-8 [&>button]:!border-border/80 [&>button]:!bg-card [&>button]:!text-foreground [&>button]:!shadow-sm [&>button:hover]:!bg-muted [&>button:hover]:!text-primary [&_svg]:!h-4 [&_svg]:!w-4 [&_svg]:!stroke-current"
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
            onClick={handleToggleGrid}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border shadow-sm transition-colors ${
              showGrid
                ? 'bg-muted text-foreground border-border'
                : 'bg-card hover:bg-muted text-muted-foreground border-border'
            }`}
            title={showGrid ? '隐藏网格' : '显示网格'}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
            网格
          </button>
          <button
            onClick={handleOrganizeNodes}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-card hover:bg-muted text-muted-foreground rounded-lg border border-border shadow-sm transition-colors"
            title="整理画布节点"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            整理
          </button>
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

      {/* 临时连接线 SVG 层 */}
      {tempConnectionLine && tempConnectionLinePath && (
        <svg className="absolute inset-0 pointer-events-none z-10" style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#a78bfa" />
            </marker>
          </defs>
          <path
            d={tempConnectionLinePath.path}
            stroke="#a78bfa"
            strokeWidth="2"
            fill="none"
            strokeDasharray="5,5"
            markerEnd="url(#arrowhead)"
            className="animate-pulse"
          />
          {/* 终点圆圈 */}
          <circle
            cx={tempConnectionLinePath.targetX}
            cy={tempConnectionLinePath.targetY}
            r="6"
            fill="#a78bfa"
            className="animate-ping"
          />
        </svg>
      )}

      {selectedNode && (
        <FloatingParamPanel
          node={selectedNode}
          canvasId={canvasId}
          wrapperRef={wrapperRef}
          onClose={() => setSelectedNodeId(null)}
          onExecuted={kickPoll}
          onStoryboardExpandedRef={onStoryboardExpandedRef}
          isDragging={draggingNodeId === selectedNode.id}
        />
      )}

      {/* 右键菜单上传文件的隐藏 input */}
      <input
        ref={uploadFromMenuRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleUploadFromMenu}
      />

      {contextMenu && (
        <>
          <ContextNodeMenu
            x={contextMenu.x}
            y={contextMenu.y}
            title={contextMenu.mode === 'downstream' ? '创建下游节点' : undefined}
            onSelect={handleContextMenuAdd}
            onClose={() => {
              setContextMenu(null)
              setTempConnectionLine(null) // 清除临时连接线
            }}
            onUpload={contextMenu.uploadTarget ? handleContextMenuUpload : undefined}
            uploadLabel={contextMenu.uploadTarget ? getUploadTargetLabel(contextMenu.uploadTarget) : undefined}
            uploadingFromMenu={uploadingFromMenu}
            sourceNodeId={contextMenu.sourceNodeIds[0]} // 传入源节点ID
          />
        </>
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
