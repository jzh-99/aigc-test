import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { computeFloatingParamPanelPosition } from './floating-param-panel-position'

describe('computeFloatingParamPanelPosition', () => {
  test('面板在节点正下方，水平以节点中心居中', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 420,
      panelHeight: 500,
      viewportWidth: 1200,
      viewportHeight: 900,
      gap: 8,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 400, y: 100 },
      fallbackNodeSize: { width: 280, height: 220 },
      nodeRect: { left: 400, top: 100, width: 280, height: 200 },
    })

    // 水平居中：nodeCenterX = 400 + 140 = 540, left = 540 - 210 = 330
    assert.equal(position.left, 330)
    // 正下方：nodeBottom + gap = 300 + 8 = 308
    assert.equal(position.top, 308)
  })

  test('节点 DOM 暂不可用时回退到画布坐标估算', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 420,
      viewportWidth: 1200,
      viewportHeight: 900,
      gap: 8,
      wrapperRect: { left: 20, top: 30 },
      transform: { x: 10, y: 20, zoom: 2 },
      nodePosition: { x: 100, y: 50 },
      fallbackNodeSize: { width: 240, height: 100 },
    })

    // fallback 水平：wrapperRect.left + nodePosition.x * zoom + transform.x + (width * zoom) / 2
    // = 20 + 200 + 10 + 240 = 470, left = 470 - 210 = 260
    assert.equal(position.left, 260)
    // fallback 垂直：nodeBottom + gap = 30 + 100 + 20 + 200 + 8 = 358
    assert.equal(position.top, 358)
  })

  test('传入面板高度且下方空间足够时，面板在节点下方', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 420,
      panelHeight: 460,
      viewportWidth: 1466,
      viewportHeight: 900,
      gap: 14,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 480, y: 90 },
      fallbackNodeSize: { width: 240, height: 160 },
      nodeRect: { left: 462, top: 92, width: 280, height: 180 },
    })

    // 水平居中：nodeCenterX = 462 + 140 = 602, left = 602 - 210 = 392
    assert.equal(position.left, 392)
    // 正下方：nodeBottom + gap = 272 + 14 = 286, 286 + 460 = 746 <= 892 ✓
    assert.equal(position.top, 286)
  })

  test('下方空间不足时，面板翻到节点上方并保持视口内边距', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 420,
      panelHeight: 460,
      viewportWidth: 1466,
      viewportHeight: 900,
      gap: 14,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 480, y: 600 },
      fallbackNodeSize: { width: 240, height: 160 },
      nodeRect: { left: 462, top: 620, width: 280, height: 218 },
    })

    // 水平居中：nodeCenterX = 602, left = 392
    assert.equal(position.left, 392)
    // 正下方：nodeBottom + gap = 838 + 14 = 852, 852 + 460 = 1312 > 892 → 翻到上方
    // aboveTop = 620 - 460 - 14 = 146
    assert.equal(position.top, 146)
  })
})
