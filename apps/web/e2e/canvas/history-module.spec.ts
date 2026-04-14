import { expect, test } from '@playwright/test'
import { mockCanvasEditor } from '../fixtures/api-mocks'

test('shows history module unit by batch module type', async ({ page }) => {
  const canvasId = 'canvas-history-module'

  await mockCanvasEditor(page, {
    canvasId,
    historyItems: [
      {
        id: 'batch-video-1',
        canvas_node_id: 'video-node-1',
        model: 'seedance-2.0',
        prompt: '视频任务',
        quantity: 2,
        completed_count: 1,
        failed_count: 0,
        status: 'processing',
        actual_credits: 16,
        created_at: '2026-04-14T10:00:00.000Z',
        module: 'video',
      },
      {
        id: 'batch-image-1',
        canvas_node_id: 'image-node-1',
        model: 'seedream-4.0',
        prompt: '图片任务',
        quantity: 4,
        completed_count: 3,
        failed_count: 0,
        status: 'completed',
        actual_credits: 12,
        created_at: '2026-04-14T10:00:01.000Z',
      },
    ],
  })

  await page.goto(`/canvas/editor/${canvasId}`)
  await expect(page.getByRole('button', { name: '记录' })).toBeVisible()

  await page.getByRole('button', { name: '记录' }).click()
  await expect(page.getByText('画布记录', { exact: true })).toBeVisible()

  const videoItem = page.getByRole('button', { name: /视频任务/ }).first()
  const imageItem = page.getByRole('button', { name: /图片任务/ }).first()

  await expect(videoItem).toBeVisible()
  await expect(imageItem).toBeVisible()

  await expect(videoItem).toContainText('1/2 条')
  await expect(imageItem).toContainText('3/4 张')
})
