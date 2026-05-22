export interface FloatingParamPanelPositionInput {
  panelWidth: number
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
const PANEL_BOTTOM_GUARD = 200

function clampPanelLeft(left: number, panelWidth: number, viewportWidth: number): number {
  return Math.max(MIN_PANEL_INSET, Math.min(left, viewportWidth - panelWidth - MIN_PANEL_INSET))
}

export function computeFloatingParamPanelPosition(input: FloatingParamPanelPositionInput) {
  const { panelWidth, viewportWidth, viewportHeight, gap, wrapperRect, transform, nodePosition, fallbackNodeSize, nodeRect } = input

  const nodeCenterX = nodeRect
    ? nodeRect.left + nodeRect.width / 2
    : wrapperRect.left + nodePosition.x * transform.zoom + transform.x + (fallbackNodeSize.width * transform.zoom) / 2
  const nodeBottom = nodeRect
    ? nodeRect.top + nodeRect.height
    : wrapperRect.top + nodePosition.y * transform.zoom + transform.y + fallbackNodeSize.height * transform.zoom

  return {
    top: Math.min(nodeBottom + gap, viewportHeight - PANEL_BOTTOM_GUARD),
    left: clampPanelLeft(nodeCenterX - panelWidth / 2, panelWidth, viewportWidth),
  }
}
