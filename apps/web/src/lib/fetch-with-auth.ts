import { useAuthStore } from '@/stores/auth-store'
import { dedupedRefresh, waitForAuth } from '@/lib/api-client'

/**
 * 带认证的 fetch，返回原始 Response（用于流式 / SSE 请求）。
 *
 * 与 api-client.ts 的 fetchWithAuth 共享 waitForAuth 和 dedupedRefresh，
 * 保证两条路径的 token 生命周期完全一致。
 */
export async function fetchRawWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  await waitForAuth()

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
    let errorData: Record<string, unknown>
    try {
      errorData = await res.clone().json()
    } catch {
      errorData = {}
    }

    const errCode = (errorData as { error?: { code?: string } }).error?.code
    if (errCode === 'TOKEN_REVOKED' || errCode === 'TOKEN_REUSE_DETECTED') {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login?reason=kicked'
      return res
    }

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
