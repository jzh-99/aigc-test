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

  const nodeCenterX = nodeRect
    ? nodeRect.left + nodeRect.width / 2
    : wrapperRect.left + nodePosition.x * transform.zoom + transform.x + (fallbackNodeSize.width * transform.zoom) / 2
  const nodeTop = nodeRect
    ? nodeRect.top
    : wrapperRect.top + nodePosition.y * transform.zoom + transform.y
  const nodeBottom = nodeRect
    ? nodeRect.top + nodeRect.height
    : wrapperRect.top + nodePosition.y * transform.zoom + transform.y + fallbackNodeSize.height * transform.zoom
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
