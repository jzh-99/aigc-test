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

    async function tryRefresh() {
      try {
        setIsRefreshing(true)
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
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
        clearAuth()
      } finally {
        setIsRefreshing(false)
      }
    }

    tryRefresh()
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

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
      </div>
    )
  }

  return <>{children}</>
}
