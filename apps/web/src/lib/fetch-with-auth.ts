import { useAuthStore } from '@/stores/auth-store'

/**
 * Check if token is expiring soon (within 5 minutes)
 * This allows proactive token refresh before expiration
 */
function isTokenExpiringSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const expiresAt = payload.exp * 1000 // Convert to milliseconds
    const now = Date.now()
    const timeLeft = expiresAt - now

    // Refresh if less than 5 minutes remaining
    return timeLeft < 5 * 60 * 1000
  } catch {
    return false
  }
}

/**
 * Fetch with automatic token refresh on expiration
 *
 * Features:
 * - Proactive token refresh (5 minutes before expiration)
 * - Automatic retry on 401 TOKEN_EXPIRED
 * - Seamless user experience (no visible delays)
 * - Automatic logout on refresh failure
 *
 * Note: refresh_token is stored in HttpOnly cookie, managed by browser
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const getToken = () => useAuthStore.getState().accessToken
  const setAccessToken = (token: string) => useAuthStore.getState().setAuth(useAuthStore.getState().user!, token)
  const logout = () => {
    useAuthStore.getState().clearAuth()
    window.location.href = '/login'
  }

  let token = getToken()

  // 🚀 Optimization: Proactively refresh token if expiring soon
  if (token && isTokenExpiringSoon(token)) {
    try {
      const refreshRes = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include', // Include HttpOnly cookie
      })

      if (refreshRes.ok) {
        const data = await refreshRes.json()
        const newToken = data.access_token
        setAccessToken(newToken)
        token = newToken
        console.log('[fetchWithAuth] Token proactively refreshed')
      }
    } catch (err) {
      console.warn('[fetchWithAuth] Proactive token refresh failed, will retry on 401:', err)
    }
  }

  // First attempt with current (or refreshed) token
  let res = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies for all requests
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  // If 401 and token expired, try to refresh and retry
  if (res.status === 401) {
    let errorData: any
    try {
      errorData = await res.json()
    } catch {
      errorData = {}
    }

    if (errorData.error?.code === 'TOKEN_EXPIRED') {
      try {
        const refreshRes = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include', // Include HttpOnly cookie
        })

        if (refreshRes.ok) {
          const data = await refreshRes.json()
          const newToken = data.access_token
          setAccessToken(newToken)
          console.log('[fetchWithAuth] Token refreshed after 401')

          // Retry original request with new token
          res = await fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
              ...options.headers,
              Authorization: `Bearer ${newToken}`,
            },
          })
        } else {
          // Refresh token also invalid, logout
          console.error('[fetchWithAuth] Refresh token invalid, logging out')
          logout()
        }
      } catch (err) {
        console.error('[fetchWithAuth] Token refresh failed:', err)
        logout()
      }
    }
  }

  return res
}
