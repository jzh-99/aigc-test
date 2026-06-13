'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { apiGet, dedupedRefresh } from '@/lib/api-client'

const PUBLIC_PATHS = ['/login', '/accept-invite']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const user = useAuthStore((s) => s.user)
  const isRefreshing = useAuthStore((s) => s.isRefreshing)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setIsRefreshing = useAuthStore((s) => s.setIsRefreshing)

  useEffect(() => {
    if (isInitialized) return

    async function tryRefresh() {
      try {
        setIsRefreshing(true)
        const refreshResult = await dedupedRefresh()
        if (refreshResult.rateLimited) {
          clearAuth()
          return
        }
        if (!refreshResult.token) {
          clearAuth()
        }
      } catch (err) {
        if (err instanceof Error && /ACCOUNT_SUSPENDED/.test(err.message)) {
          toast.error('您的账户已被停用，请联系团队管理员')
        }
        clearAuth()
      } finally {
        setIsRefreshing(false)
      }
    }

    tryRefresh()
  }, [isInitialized, clearAuth, setIsRefreshing])

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
