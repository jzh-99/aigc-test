cat << 'INNER_EOF' > /root/autodl-tmp/aigc-test/apps/web/src/lib/auth-provider.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { toast } from 'sonner'

const PUBLIC_PATHS = ['/login', '/accept-invite']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isInitialized, user, accessToken, setAuth, clearAuth, setInitialized } = useAuthStore()
  const resetGeneration = useGenerationStore((s) => s.reset)

  useEffect(() => {
    if (isInitialized) return

    async function tryRefresh() {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          resetGeneration()
          setAuth(data.user, data.access_token)
        } else {
          if (res.status === 403) {
            const data = await res.json().catch(() => null)
            if (data?.error?.code === 'ACCOUNT_SUSPENDED') {
              toast.error('您的账户已被停用，请联系团队管理员')
            }
          }
          clearAuth()
        }
      } catch {
        clearAuth()
      }
    }

    tryRefresh()
  }, [isInitialized, setAuth, clearAuth, setInitialized, resetGeneration])

  useEffect(() => {
    if (!isInitialized) return
    if (!user && !PUBLIC_PATHS.includes(pathname)) {
      router.replace('/login')
    }
  }, [isInitialized, user, pathname, router])

  // Setup Server-Sent Events to listen for kicks using native EventSource
  useEffect(() => {
    if (!isInitialized || !user || !accessToken) return

    const url = `/api/v1/auth/events?token=${accessToken}`
    const eventSource = new EventSource(url)

    eventSource.addEventListener('kick', (e) => {
      toast.warning('您的账号已在其他设备登录，即将退出', {
        duration: 5000,
      })
      
      setTimeout(() => {
        clearAuth()
        router.replace('/login?reason=kicked')
      }, 1500)
      
      eventSource.close()
    })

    return () => {
      eventSource.close()
    }
  }, [isInitialized, user, accessToken, clearAuth, router])

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
      </div>
    )
  }

  return <>{children}</>
}
INNER_EOF
