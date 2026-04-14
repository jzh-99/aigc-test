import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'

test('switches between image and video asset tabs', async ({ page }) => {
  const canvasId = 'canvas-asset-tabs'

  await mockCanvasEditor(page, {
    canvasId,
    imageAssets: [
      {
        id: 'asset-image-1',
        type: 'image/jpeg',
        storage_url: 'https://cdn.test/image-1.jpg',
        original_url: null,
        created_at: '2026-04-14T10:00:00.000Z',
        batch_id: 'batch-image-1',
        canvas_node_id: 'node-image-1',
        prompt: '图片资产',
        model: 'seedream-4.0',
      },
    ],
    videoAssets: [
      {
        id: 'asset-video-1',
        type: 'video/mp4',
        storage_url: 'https://cdn.test/video-1.mp4',
        original_url: null,
        created_at: '2026-04-14T10:00:01.000Z',
        batch_id: 'batch-video-1',
        canvas_node_id: 'node-video-1',
        prompt: '视频资产',
        model: 'seedance-2.0',
      },
    ],
  })

  await page.goto(`/canvas/editor/${canvasId}`)
  await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

  await page.getByRole('button', { name: '记录' }).click()
  await expect(page.getByText('画布记录', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '资产库', exact: true }).last().click()

  await expect(page.getByRole('button', { name: '图片', exact: true })).toBeVisible()
  await expect(page.getByTestId('canvas-asset-item-asset-image-1')).toBeVisible()

  await page.getByRole('button', { name: '视频', exact: true }).click()

  await expect(page.getByTestId('canvas-asset-item-asset-video-1')).toBeVisible()
  await expect(page.getByTestId('canvas-asset-item-asset-video-1').locator('video')).toBeVisible()
})
