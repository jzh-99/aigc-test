'use client'

import { Menu, Settings, LogOut, Coins, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useMemo } from 'react'
import { apiPost } from '@/lib/api-client'
import { useRouter } from 'next/navigation'
import { MobileSidebar } from './mobile-sidebar'
import { useTheme } from '@/context/theme-provider'
import Link from 'next/link'

interface TopbarProps {
  title?: string
}

export function Topbar({ title }: TopbarProps) {
  const { mobileOpen, setMobileOpen } = useLayoutStore()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const resetGeneration = useGenerationStore((s) => s.reset)
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  const canViewCredits = useMemo(() => {
    if (!activeTeam) return true
    const isOwnerOrAdmin = activeTeam.role === 'owner' || activeTeam.role === 'admin' || user?.role === 'admin'
    if (isOwnerOrAdmin) return true
    return activeTeam.allow_member_topup === true
  }, [activeTeam, user?.role])

  async function handleLogout() {
    try { await apiPost('/auth/logout', {}) } catch {}
    resetGeneration()
    clearAuth()
    router.replace('/login')
  }

  return (
    <header className="relative z-30 flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">菜单</span>
      </Button>

      {title && (
        <h1 className="text-lg font-semibold">{title}</h1>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* 主题切换按钮 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full text-muted-foreground hover:text-foreground"
          aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-accent-blue/10 flex items-center justify-center text-sm font-medium text-accent-blue">
                  {user?.username?.[0]?.toUpperCase() ?? 'U'}
                </div>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                个人设置
              </Link>
            </DropdownMenuItem>
            {canViewCredits && (
              <DropdownMenuItem asChild>
                <Link href="/credits">
                  <Coins className="mr-2 h-4 w-4" />
                  积分管理
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-error">
              <LogOut className="mr-2 h-4 w-4" />
              登出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-60">
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <MobileSidebar />
        </SheetContent>
      </Sheet>
    </header>
  )
}
