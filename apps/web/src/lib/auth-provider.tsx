'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { apiGet } from '@/lib/api-client'

const PUBLIC_PATHS = ['/login', '/accept-invite']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const user = useAuthStore((s) => s.user)
  const isRefreshing = useAuthStore((s) => s.isRefreshing)
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setIsRefreshing = useAuthStore((s) => s.setIsRefreshing)

  useEffect(() => {
    if (isInitialized) return

    // AbortController 防止 StrictMode 双重挂载导致两次并发 refresh 请求
    // （两次请求会导致 token 轮换竞态：第二个请求看到已撤销的旧 token → 触发重用检测 → 全部 token 被撤销）
    const controller = new AbortController()

    async function tryRefresh() {
      try {
        setIsRefreshing(true)
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        })
        if (res.ok) {
          const data = await res.json()
          setAuth(data.user, data.access_token)
        } else {
          const body = await res.json().catch(() => null)
          if (res.status === 403 && body?.error?.code === 'ACCOUNT_SUSPENDED') {
            toast.error('您的账户已被停用，请联系团队管理员')
          }
          clearAuth()
        }
      } catch (err) {
        // AbortError 说明组件已卸载，忽略即可，新挂载的 effect 会重新请求
        if ((err as DOMException).name === 'AbortError') return
        clearAuth()
      } finally {
        if (!controller.signal.aborted) {
          setIsRefreshing(false)
        }
      }
    }

    tryRefresh()
    return () => controller.abort()
  }, [isInitialized, setAuth, clearAuth, setIsRefreshing])

  useEffect(() => {
    // refresh 进行中时不做跳转判断，避免刷新页面时 token 还未取回就误跳登录页
    if (!isInitialized || isRefreshing) return
    if (!user && !PUBLIC_PATHS.includes(pathname)) {
      router.replace('/login')
    }
  }, [isInitialized, isRefreshing, user, pathname, router])

  useEffect(() => {
    if (!isInitialized || !user) return

    const interval = setInterval(async () => {
      try {
        await apiGet('/users/me')
      } catch (err) {
        // 429 (rate limited) — server is busy but user is still logged in, do nothing
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [isInitialized, user])

  // 不阻塞渲染：refresh 期间直接展示 children，各页面的 loading.tsx skeleton 承接过渡态。
  // refresh 完成后若未登录，useEffect 里的跳转逻辑会执行 router.replace('/login')。
  return <>{children}</>
}
