import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'
import {
  createImageNode,
  createVideoNode,
} from '../fixtures/canvas'

test.describe('canvas context menu upload', () => {
  test.use({ viewport: { width: 1600, height: 1200 } })

  test('shows upload entry on blank canvas and matching upload entry on media nodes', async ({ page }) => {
    const canvasId = 'canvas-context-menu-upload'

    await mockCanvasEditor(page, {
      canvasId,
      nodes: [
        createImageNode({ id: 'image-1', label: '图片节点', position: { x: 320, y: 180 } }),
        createVideoNode({ id: 'video-1', label: '视频节点', position: { x: 720, y: 180 } }),
      ],
    })

    await page.goto(`/canvas/editor/${canvasId}`)
    await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

    await page.locator('.react-flow__pane').click({
      button: 'right',
      position: { x: 80, y: 80 },
    })
    await expect(page.getByRole('button', { name: '上传文件' })).toBeVisible()

    await page.locator('.react-flow__node', { hasText: '图片节点' }).click({ button: 'right' })
    await expect(page.getByText('创建下游节点')).toBeVisible()
    await expect(page.getByRole('button', { name: '上传图片资源' })).toBeVisible()
    await expect(page.getByRole('button', { name: '上传视频资源' })).toHaveCount(0)

    await page.locator('.react-flow__node', { hasText: '视频节点' }).click({ button: 'right' })
    await expect(page.getByText('创建下游节点')).toBeVisible()
    await expect(page.getByRole('button', { name: '上传视频资源' })).toBeVisible()
    await expect(page.getByRole('button', { name: '上传图片资源' })).toHaveCount(0)
  })
})
