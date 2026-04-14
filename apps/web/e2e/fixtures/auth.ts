import type { Page } from '@playwright/test'

export interface MockAuthOptions {
  userId?: string
  teamId?: string
  workspaceId?: string
  username?: string
  email?: string
  token?: string
}

const DEFAULTS = {
  userId: 'user-e2e',
  teamId: 'team-e2e',
  workspaceId: 'ws-e2e',
  username: 'E2E用户',
  email: 'e2e@example.com',
  token: 'e2e-access-token',
}

export async function mockAuth(page: Page, options: MockAuthOptions = {}) {
  const cfg = {
    ...DEFAULTS,
    ...options,
  }

  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: cfg.token,
        user: {
          id: cfg.userId,
          email: cfg.email,
          phone: null,
          username: cfg.username,
          avatar_url: null,
          role: 'member',
          password_change_required: false,
          teams: [
            {
              id: cfg.teamId,
              name: 'E2E团队',
              role: 'owner',
              team_type: 'standard',
              owner: null,
              workspaces: [
                {
                  id: cfg.workspaceId,
                  name: 'E2E工作区',
                  role: 'owner',
                },
              ],
            },
          ],
        },
      }),
    })
  })

  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: cfg.userId,
        username: cfg.username,
        email: cfg.email,
      }),
    })
  })

  return cfg
}
