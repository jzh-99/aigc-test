import { expect, test } from '@playwright/test'
import { mockAuth } from '../fixtures/auth'

test.describe('music page', () => {
  test('shows creation form, empty state and voice upload entry', async ({ page }) => {
    await mockAuth(page, { workspaceId: 'ws-e2e' })

    await page.route('**/api/v1/teams/team-e2e', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'team-e2e', name: 'E2E团队', credits: { balance: 100, frozen_credits: 0 } }),
      })
    })
    await page.route('**/api/v1/payment/balance**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 100, frozen_credits: 0 }) })
    })
    await page.route('**/api/v1/music/tracks**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], cursor: null }) })
    })
    await page.route('**/api/v1/music/voice-clones**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
    })
    await page.route('**/api/v1/models?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'model-mureka-9',
            code: 'mureka-9',
            name: 'Mureka 9 音乐生成',
            description: '高质量音乐生成模型',
            module: 'music',
            category_references: {},
            credit_cost: 18,
            params_pricing: [
              { resolution: 'inspiration_song', model: 'mureka-9', unit_price: 18 },
              { resolution: 'instrumental', model: 'mureka-9', unit_price: 15 },
              { resolution: 'custom_song', model: 'mureka-9', unit_price: 15 },
            ],
            params_schema: {},
            resolution: null,
            is_active: true,
            provider_code: 'mureka',
          },
        ]),
      })
    })

    await page.goto('/music')

    await expect(page.getByRole('link', { name: /音乐/ })).toBeVisible()
    await expect(page.getByText('创造你的专属音乐')).toBeVisible()
    await expect(page.getByText('还没有音乐哦，快去创作吧')).toBeVisible()
    await expect(page.getByRole('button', { name: '灵感模式' })).toBeVisible()
    await expect(page.getByText('纯音乐')).toBeVisible()
    await expect(page.getByText('mureka-9')).toBeVisible()
    await expect(page.getByText('18 A豆 · 灵感模式生成歌曲')).toBeVisible()

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: '暂无音色，上传自己的音频文件生成音色' }).click()
    await expect(page.getByRole('dialog', { name: '上传自己的音频生成音色' })).toBeVisible()
  })
})
