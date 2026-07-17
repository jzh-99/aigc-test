export interface FloatingParamPanelPositionInput {
  panelWidth: number
  panelHeight?: number
  viewportWidth: number
  viewportHeight: number
  gap: number
  wrapperRect: {
    left: number
    top: number
  }
  transform: {
    x: number
    y: number
    zoom: number
  }
  nodePosition: {
    x: number
    y: number
  }
  fallbackNodeSize: {
    width: number
    height: number
  }
  nodeRect?: {
    left: number
    top: number
    width: number
    height: number
  }
}

const MIN_PANEL_INSET = 8
const LEGACY_PANEL_BOTTOM_GUARD = 200

function clampPanelLeft(left: number, panelWidth: number, viewportWidth: number): number {
  return Math.max(MIN_PANEL_INSET, Math.min(left, viewportWidth - panelWidth - MIN_PANEL_INSET))
}

export function computeFloatingParamPanelPosition(input: FloatingParamPanelPositionInput) {
  const { panelWidth, panelHeight, viewportWidth, viewportHeight, gap, wrapperRect, transform, nodePosition, fallbackNodeSize, nodeRect } = input

  // 水平方向：以节点中心为基准居中
  const nodeCenterX = nodeRect
    ? nodeRect.left + nodeRect.width / 2
    : wrapperRect.left + nodePosition.x * transform.zoom + transform.x + (fallbackNodeSize.width * transform.zoom) / 2
  const nodeTop = nodeRect
    ? nodeRect.top
    : wrapperRect.top + nodePosition.y * transform.zoom + transform.y
  const nodeBottom = nodeRect
    ? nodeRect.top + nodeRect.height
    : wrapperRect.top + nodePosition.y * transform.zoom + transform.y + fallbackNodeSize.height * transform.zoom

  // 垂直方向：固定在节点正下方，空间不足时翻到上方
  const top = panelHeight == null
    ? Math.min(nodeBottom + gap, viewportHeight - LEGACY_PANEL_BOTTOM_GUARD)
    : (() => {
        const measuredPanelHeight = Math.min(panelHeight, viewportHeight - MIN_PANEL_INSET * 2)
        const belowTop = nodeBottom + gap
        const aboveTop = nodeTop - measuredPanelHeight - gap
        const hasEnoughSpaceBelow = belowTop + measuredPanelHeight <= viewportHeight - MIN_PANEL_INSET
        const preferredTop = hasEnoughSpaceBelow ? belowTop : aboveTop
        return Math.max(MIN_PANEL_INSET, Math.min(preferredTop, viewportHeight - measuredPanelHeight - MIN_PANEL_INSET))
      })()

  return {
    top,
    left: clampPanelLeft(nodeCenterX - panelWidth / 2, panelWidth, viewportWidth),
  }
}
