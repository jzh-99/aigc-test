'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useTeamFeatures } from '@/hooks/use-team-features'

export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const { showCanvasTab } = useTeamFeatures()
  const canUseCanvas = showCanvasTab && activeTeam?.team_type === 'avatar_enabled'

  useEffect(() => {
    if (!isInitialized) return
    if (!canUseCanvas) router.replace('/')
  }, [canUseCanvas, isInitialized, router])

  if (!isInitialized || !canUseCanvas) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <>{children}</>
}
