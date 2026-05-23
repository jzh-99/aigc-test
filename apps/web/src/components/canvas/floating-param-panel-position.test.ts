import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { computeFloatingParamPanelPosition } from './floating-param-panel-position'

describe('computeFloatingParamPanelPosition', () => {
  test('优先使用真实节点 DOM 中心对齐参数面板', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 640,
      viewportWidth: 1200,
      viewportHeight: 900,
      gap: 8,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 400, y: 100 },
      fallbackNodeSize: { width: 280, height: 220 },
      nodeRect: { left: 400, top: 100, width: 400, height: 320 },
    })

    assert.equal(position.left, 280)
    assert.equal(position.top, 428)
  })

  test('节点 DOM 暂不可用时回退到画布坐标估算', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 320,
      viewportWidth: 1200,
      viewportHeight: 900,
      gap: 8,
      wrapperRect: { left: 20, top: 30 },
      transform: { x: 10, y: 20, zoom: 2 },
      nodePosition: { x: 100, y: 50 },
      fallbackNodeSize: { width: 240, height: 100 },
    })

    assert.equal(position.left, 310)
    assert.equal(position.top, 358)
  })

  test('传入真实面板高度时，下方空间足够则显示在节点下方', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 780,
      panelHeight: 460,
      viewportWidth: 1466,
      viewportHeight: 900,
      gap: 14,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 480, y: 90 },
      fallbackNodeSize: { width: 240, height: 160 },
      nodeRect: { left: 462, top: 92, width: 484, height: 218 },
    })

    assert.equal(position.left, 314)
    assert.equal(position.top, 324)
  })

  test('下方空间不足时，面板上翻并保持视口内边距', () => {
    const position = computeFloatingParamPanelPosition({
      panelWidth: 780,
      panelHeight: 460,
      viewportWidth: 1466,
      viewportHeight: 900,
      gap: 14,
      wrapperRect: { left: 0, top: 0 },
      transform: { x: 0, y: 0, zoom: 1 },
      nodePosition: { x: 480, y: 600 },
      fallbackNodeSize: { width: 240, height: 160 },
      nodeRect: { left: 462, top: 620, width: 484, height: 218 },
    })

    assert.equal(position.left, 314)
    assert.equal(position.top, 146)
  })
})
