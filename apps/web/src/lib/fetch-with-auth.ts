import { useAuthStore } from '@/stores/auth-store'
import { dedupedRefresh } from '@/lib/api-client'

/**
 * 带认证的 fetch，返回原始 Response（用于流式请求如 SSE）
 *
 * 复用 api-client.ts 的 dedupedRefresh 去重锁，
 * 避免两套独立 refresh 机制并发导致 token 轮换竞态。
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().accessToken

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  if (res.status === 401) {
    let errorData: Record<string, any>
    try {
      errorData = await res.json()
    } catch {
      errorData = {}
    }

    if (errorData.error?.code === 'TOKEN_REVOKED' || errorData.error?.code === 'TOKEN_REUSE_DETECTED') {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login?reason=kicked'
      return res
    }

    // 使用去重 refresh，确保全局只有一个 refresh 请求在飞
    const refreshResult = await dedupedRefresh()
    if (refreshResult.token) {
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...options.headers,
          Authorization: `Bearer ${refreshResult.token}`,
        },
      })
    }

    useAuthStore.getState().clearAuth()
    window.location.href = '/login'
  }

  return res
}
