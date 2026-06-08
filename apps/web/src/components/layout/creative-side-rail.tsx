'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LogOut, UserRound } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { apiPost } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useTeamFeatures } from '@/hooks/use-team-features'
import {
  creativeNavItems,
  isNavItemActive,
  managementNavItems,
} from './nav-config'

const navLabelMap: Record<string, string> = {
  'Toby Studio': 'Toby',
  灵动画布: '画布',
}

type RailTheme = {
  rail: string
  glow: string
  activeIcon: string
  activeText: string
  hoverText: string
  logo: string
}

const railTheme: RailTheme = {
  rail: 'border-[#a99cff]/20 bg-[linear-gradient(180deg,rgba(16,18,50,0.72)_0%,rgba(12,16,48,0.9)_48%,rgba(6,8,26,0.98)_100%)] shadow-[inset_-1px_0_0_rgba(169,156,255,0.16)]',
  glow: 'bg-[radial-gradient(circle_at_54%_14%,rgba(151,125,255,0.28),transparent_30%),radial-gradient(circle_at_36%_44%,rgba(73,128,255,0.16),transparent_24%)]',
  activeIcon: 'bg-[#f2efff] text-[#5e4fd7] shadow-[0_0_28px_rgba(168,139,255,0.66),0_0_72px_rgba(73,128,255,0.24)]',
  activeText: 'text-white drop-shadow-[0_0_14px_rgba(168,139,255,0.54)]',
  hoverText: 'hover:text-violet-100',
  logo: 'text-[#f3f0ff] drop-shadow-[0_0_20px_rgba(168,139,255,0.48)]',
}

export function CreativeSideRail() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const resetGeneration = useGenerationStore((s) => s.reset)
  const { showVideoStudioTab } = useTeamFeatures()
  const visibleManagementItems = managementNavItems.filter((item) => {
    if (item.label === '操作手册') return false
    if (item.requireUserRole && user?.role !== item.requireUserRole) return false
    if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
    return true
  })

  async function handleLogout() {
    try {
      await apiPost('/auth/logout', {})
    } catch {
      // 服务端登出失败时仍清理本地状态，避免用户被卡在当前会话。
    } finally {
      resetGeneration()
      clearAuth()
      router.replace('/login')
    }
  }

  return (
    <aside
      className={cn(
        'relative hidden h-screen w-20 shrink-0 flex-col items-center overflow-hidden border-r px-2 py-5 text-white backdrop-blur-2xl transition-colors duration-500 lg:flex',
        railTheme.rail
      )}
    >
      <div className={cn('pointer-events-none absolute inset-0 opacity-100 transition duration-500', railTheme.glow)} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/0 via-white/25 to-white/0" />
      <Link href="/" className={cn('relative z-10 mb-12 grid h-9 w-9 place-items-center transition', railTheme.logo)}>
        <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
          <path d="M14 6h12l6 10-6 10H14L8 16 14 6Z" fill="currentColor" opacity="0.96" />
          <path d="M14 18h12l6 10-6 6H14l-6-6 6-10Z" fill="currentColor" opacity="0.78" />
        </svg>
        <span className="sr-only">Toby.AI</span>
      </Link>

      <nav className="relative z-10 flex flex-1 flex-col items-center gap-5">
        {creativeNavItems.map((item) => {
          const visibleChildren = item.children?.filter((child) => {
            if (child.feature === 'videoStudio') return showVideoStudioTab
            return true
          })
          const isActive = visibleChildren
            ? visibleChildren.some((child) => isNavItemActive(child.href, currentPath))
            : isNavItemActive(item.href, currentPath)
          const Icon = item.icon

          return (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex flex-col items-center gap-1.5 text-[10px] font-medium leading-none transition',
                    isActive ? railTheme.activeText : `text-white/50 ${railTheme.hoverText}`
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full border border-white/0 transition duration-300',
                      isActive
                        ? railTheme.activeIcon
                        : 'bg-white/[0.03] text-white/55 group-hover:border-white/10 group-hover:bg-white/[0.08] group-hover:text-white/85'
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>{navLabelMap[item.label] ?? item.label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.description ?? item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      <div className="relative z-10 flex flex-col items-center gap-4 text-white/60">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-white/10 text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-white/35 hover:bg-white/20 hover:text-white hover:shadow-[0_0_22px_rgba(129,220,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="打开账户管理菜单"
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={12}
            className="w-44 border-white/15 bg-[#121735]/95 p-1.5 text-white shadow-[0_18px_60px_rgba(5,8,30,0.48)] backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 px-2 py-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-white/10 text-white/70">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">{user?.username ?? '当前用户'}</p>
                <p className="truncate text-[11px] text-white/50">{user?.email ?? user?.phone ?? '已登录账号'}</p>
              </div>
            </div>
            <DropdownMenuSeparator className="bg-white/10" />
            {visibleManagementItems.map((item) => {
              const isActive = isNavItemActive(item.href, currentPath)
              const Icon = item.icon

              return (
                <DropdownMenuItem
                  key={item.href}
                  asChild
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-2 text-xs text-white/70 focus:bg-white/10 focus:text-white',
                    isActive && 'bg-white/[0.12] text-white'
                  )}
                >
                  <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer rounded-md px-2.5 py-2 text-xs text-rose-200 focus:bg-rose-400/10 focus:text-rose-100"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
