import { useAuthStore } from '@/stores/auth-store'
import { getErrorMessage, translateError } from './error-messages'

const API_BASE = '/api/v1'

export class ApiError extends Error {
  code: string
  status: number
  originalMessage: string

  constructor(status: number, code: string, message: string) {
    // 翻译错误信息为中文
    const translatedMessage = getErrorMessage(code, translateError(message))
    super(translatedMessage)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.originalMessage = message
  }
}

function getHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error && typeof body.error === 'object') {
        // Our custom error format: { error: { code, message } }
        code = body.error.code ?? code
        message = body.error.message ?? message
      } else if (body?.code || body?.message) {
        // Fastify built-in error format: { code, message, error: "Bad Request" }
        code = body.code ?? code
        message = body.message ?? message
      }
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, code, message)
  }
  return res.json()
}

let refreshPromise: Promise<{ token: string | null; rateLimited: boolean }> | null = null

async function refreshAccessToken(): Promise<{ token: string | null; rateLimited: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (res.status === 429) {
      // Rate limited — do NOT clear auth, user is still logged in
      return { token: null, rateLimited: true }
    }
    if (!res.ok) return { token: null, rateLimited: false }
    const data = await res.json()
    const newToken = data.access_token
    if (newToken && data.user) {
      useAuthStore.getState().setAuth(data.user, newToken)
    }
    return { token: newToken, rateLimited: false }
  } catch {
    return { token: null, rateLimited: false }
  }
}

export async function fetchWithAuth<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = { ...getHeaders(), ...init.headers }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    // 拦截 Token 被踢出的情况
    try {
      const clonedRes = res.clone()
      const errorData = await clonedRes.json()
      if (errorData?.error?.code === 'TOKEN_REVOKED' || errorData?.error?.code === 'TOKEN_REUSE_DETECTED') {
        useAuthStore.getState().clearAuth()
        if (typeof window !== 'undefined') {
          window.location.href = '/login?reason=kicked'
        }
        throw new ApiError(401, 'TOKEN_REVOKED', '账号已在其他设备登录')
      }
    } catch (e) {
      if (e instanceof ApiError) throw e
      // 忽略 parse error
    }

    // Skip refresh for auth endpoints — treat as normal error
    if (path.startsWith('/auth/')) {
      return handleResponse<T>(res)
    }
    // Try refresh (deduplicate concurrent refreshes)
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null
      })
    }
    const refreshResult = await refreshPromise
    if (refreshResult.rateLimited) {
      // Server is rate-limiting us — do NOT log out, just surface the error
      throw new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试')
    }
    if (refreshResult.token) {
      // Retry original request
      const retryHeaders = { ...init.headers, Authorization: `Bearer ${refreshResult.token}` } as Record<string, string>
      const retryRes = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: retryHeaders,
        credentials: 'include',
      })
      return handleResponse<T>(retryRes)
    }
    // Refresh failed (truly invalid/expired) — clear auth, redirect
    useAuthStore.getState().clearAuth()
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    throw new ApiError(401, 'AUTH_REQUIRED', 'Session expired')
  }

  return handleResponse<T>(res)
}

export async function apiGet<T>(path: string): Promise<T> {
  return fetchWithAuth<T>(path)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return fetchWithAuth<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return fetchWithAuth<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return fetchWithAuth<T>(path, { method: 'DELETE' })
}

export const apiFetcher = <T,>(path: string) => apiGet<T>(path)
