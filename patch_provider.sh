cat << 'INNER_EOF' > /root/autodl-tmp/aigc-test/apps/web/src/lib/auth-provider.tsx
'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { toast } from 'sonner'
import { apiGet } from '@/lib/api-client'

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

  // Setup periodic heartbeat to detect background kicks
  useEffect(() => {
    if (!isInitialized || !user || !accessToken) return

    const interval = setInterval(async () => {
      try {
        // Just call a lightweight authenticated endpoint to trigger the JWT middleware
        // If the token is revoked, the API client interceptor will automatically clear auth and redirect
        await apiGet('/users/me')
      } catch (err) {
        // Expected to fail with ApiError when kicked, handled by api-client.ts
      }
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [isInitialized, user, accessToken])

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
