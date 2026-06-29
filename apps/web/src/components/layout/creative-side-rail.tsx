'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserRound, Building2, ArrowLeftRight, Check, Coins } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useHomeScrollStore } from '@/stores/home-scroll-store'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useNavigationStore } from '@/stores/navigation-store'
import { useBizMgmtBalance } from '@/hooks/use-biz-mgmt-balance'
import {
  creativeNavItems,
  isNavItemActive,
} from './nav-config'

const navLabelMap: Record<string, string> = {
  'Toby Studio': 'Toby',
  灵动画布: '画布',
}

type RailTheme = {
  rail: string
  activeIcon: string
  activeText: string
  hoverText: string
  logo: string
}

const railTheme: RailTheme = {
  rail: 'bg-[linear-gradient(180deg,rgba(16,18,50,0.72)_0%,rgba(12,16,48,0.9)_48%,rgba(6,8,26,0.98)_100%)]',
  activeIcon: 'bg-[#f2efff] text-[#5e4fd7] shadow-[0_0_28px_rgba(168,139,255,0.66),0_0_72px_rgba(73,128,255,0.24)]',
  activeText: 'text-white drop-shadow-[0_0_14px_rgba(168,139,255,0.54)]',
  hoverText: 'hover:text-violet-100',
  logo: 'text-[#f3f0ff] drop-shadow-[0_0_20px_rgba(168,139,255,0.48)]',
}

export function CreativeSideRail() {
  const pathname = usePathname()
  const router = useRouter()
  // 不再使用 useSearchParams：它在静态渲染下会让整个 Suspense 边界降级为 client
  // rendering，并触发 "Text content does not match" / "hydrating this Suspense boundary" 报错。
  // query string（如 /generation?mode=image）的精确匹配改为 mount 后从 window.location 读取，
  // 保证 SSR 与首屏 CSR 输出完全一致。
  const [search, setSearch] = useState('')
  useEffect(() => {
    setSearch(window.location.search.slice(1))
  }, [pathname])
  const currentPath = search ? `${pathname}?${search}` : pathname
  const isCreativeHome = pathname === '/'
  const isTabSticky = useHomeScrollStore((s) => s.isTabSticky)
  /* 首页且未吸顶时保持透明，其余情况使用实色轨道主题 */
  const isTransparent = isCreativeHome && !isTabSticky
  /* 仅首页吸顶时使用主题渐变；非首页侧边栏保持透明让父容器渐变透出 */
  const showRailTheme = isCreativeHome && isTabSticky
  const user = useAuthStore((s) => s.user)
  const activeTeamId = useAuthStore((s) => s.activeTeamId)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { setActiveTeam, setActiveWorkspace } = useAuthStore()
  const { showVideoStudioTab } = useTeamFeatures()
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  // 余额统一指向业管 A 豆余额接口（不区分团队/个人，业管以当前选中会员身份查询）
  const { data: balanceData } = useBizMgmtBalance()
  const remainingCredits = balanceData?.balance ?? 0

  return (
    <aside
      className={cn(
        'relative hidden h-screen w-20 shrink-0 flex-col items-center overflow-hidden px-2 py-5 text-white transition-colors duration-500 lg:flex',
        isTransparent
          ? 'z-20 bg-transparent'
          : showRailTheme
            ? railTheme.rail
            : 'bg-transparent'
      )}
    >
      <Link href="/" className={cn('relative z-10 mb-12 grid h-9 w-9 place-items-center transition', railTheme.logo)}>
        <svg viewBox="0 0 40 40" className="h-8 w-8 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="toby-logo-fill" x1="9" y1="6" x2="31" y2="34" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F8F4FF" />
              <stop offset="0.45" stopColor="#A8DCFF" />
              <stop offset="1" stopColor="#B98CFF" />
            </linearGradient>
            <linearGradient id="toby-logo-stroke" x1="8" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="0.52" stopColor="#8EE7FF" />
              <stop offset="1" stopColor="#C08BFF" />
            </linearGradient>
            <filter id="toby-logo-glow" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
              <feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor="#A88BFF" floodOpacity="0.78" />
              <feDropShadow dx="0" dy="2" stdDeviation="5" floodColor="#55D6FF" floodOpacity="0.26" />
            </filter>
          </defs>
          <path
            d="M11 7.5C12.7 6.4 15.8 6 20 6s7.3.4 9 1.5c.7.5 1.1 1.4.9 2.2l-.9 4.7c-.2 1.1-1.3 1.8-2.4 1.5-1-.2-2.2-.4-3.7-.5v15.2c0 1.3-1 2.4-2.3 2.5l-3.2.3c-1.5.1-2.7-1.1-2.7-2.5V15.4c-1.5.1-2.7.3-3.7.5-1.1.3-2.2-.4-2.4-1.5l-.9-4.7c-.2-.8.2-1.7.9-2.2Z"
            fill="url(#toby-logo-fill)"
            filter="url(#toby-logo-glow)"
          />
          <path
            d="M20 6c4.2 0 7.3.4 9 1.5.7.5 1.1 1.4.9 2.2l-.9 4.7c-.2 1.1-1.3 1.8-2.4 1.5-1-.2-2.2-.4-3.7-.5v15.2c0 1.3-1 2.4-2.3 2.5l-3.2.3c-1.5.1-2.7-1.1-2.7-2.5V15.4c-1.5.1-2.7.3-3.7.5-1.1.3-2.2-.4-2.4-1.5l-.9-4.7c-.2-.8.2-1.7.9-2.2C12.7 6.4 15.8 6 20 6Z"
            fill="none"
            stroke="url(#toby-logo-stroke)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path
            d="M16.3 10.4c2.2-.4 5.3-.4 7.5 0M18.7 15v14.2"
            fill="none"
            stroke="white"
            strokeLinecap="round"
            strokeWidth="1.4"
            opacity="0.42"
          />
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
                  onClick={() => startNavigation(item.href)}
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
        {/* 工作区切换（仅多工作区时显示） */}
        {user && user.teams.reduce((sum, t) => sum + t.workspaces.length, 0) > 1 && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-white/10 text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-white/35 hover:bg-white/20 hover:text-white hover:shadow-[0_0_22px_rgba(129,220,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    aria-label="切换工作区"
                  >
                    <ArrowLeftRight className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">切换工作区</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={12}
              className="w-48 border-white/15 bg-[#121735]/95 p-1.5 text-white shadow-[0_18px_60px_rgba(5,8,30,0.48)] backdrop-blur-xl"
            >
              <div className="px-2 py-1.5 text-[11px] font-medium text-white/40">切换工作区</div>
              {user.teams.map((team) => (
                <div key={team.id}>
                  {user.teams.length > 1 && (
                    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/35">
                      <Building2 className="h-3 w-3" />
                      <span className="truncate">{team.name}</span>
                    </div>
                  )}
                  {team.workspaces.map((ws) => {
                    const isActive = activeWorkspaceId === ws.id
                    return (
                      <DropdownMenuItem
                        key={ws.id}
                        className={cn(
                          'cursor-pointer rounded-md px-2.5 py-2 text-xs text-white/70 focus:bg-white/10 focus:text-white',
                          isActive && 'bg-white/[0.12] text-white'
                        )}
                        onClick={() => {
                          if (activeTeamId !== team.id) setActiveTeam(team.id)
                          setActiveWorkspace(ws.id)
                        }}
                      >
                        <span className="truncate">{ws.name}</span>
                        {isActive && <Check className="ml-auto h-3.5 w-3.5 text-accent-blue" />}
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator className="bg-white/10" />
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          type="button"
          onClick={() => {
            startNavigation('/credits')
            router.push('/credits')
          }}
          className="flex flex-col items-center gap-1 rounded-xl border-2 border-white/20 bg-white/[0.06] px-2 py-1.5 text-[10px] font-medium text-white/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:border-white/35 hover:bg-white/[0.1] hover:text-white"
          aria-label={`剩余 ${remainingCredits.toLocaleString()} A豆`}
        >
          <Coins className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
          <span className="whitespace-nowrap">{remainingCredits.toLocaleString()} A豆</span>
        </button>

        {/* 用户头像：进入设置页 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                startNavigation('/settings')
                router.push('/settings')
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-white/10 text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-white/35 hover:bg-white/20 hover:text-white hover:shadow-[0_0_22px_rgba(129,220,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="进入设置页"
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
          </TooltipTrigger>
          <TooltipContent side="right">设置</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
