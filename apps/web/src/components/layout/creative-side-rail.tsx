'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { UserRound } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTeamFeatures } from '@/hooks/use-team-features'
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
  glow: string
  activeIcon: string
  activeText: string
  hoverText: string
  logo: string
}

const railThemes: Record<string, RailTheme> = {
  灵感: {
    rail: 'border-[#a99cff]/20 bg-[linear-gradient(180deg,rgba(16,18,50,0.72)_0%,rgba(12,16,48,0.9)_48%,rgba(6,8,26,0.98)_100%)] shadow-[inset_-1px_0_0_rgba(169,156,255,0.16)]',
    glow: 'bg-[radial-gradient(circle_at_54%_14%,rgba(151,125,255,0.28),transparent_30%),radial-gradient(circle_at_36%_44%,rgba(73,128,255,0.16),transparent_24%)]',
    activeIcon: 'bg-[#f2efff] text-[#5e4fd7] shadow-[0_0_28px_rgba(168,139,255,0.66),0_0_72px_rgba(73,128,255,0.24)]',
    activeText: 'text-white drop-shadow-[0_0_14px_rgba(168,139,255,0.54)]',
    hoverText: 'hover:text-violet-100',
    logo: 'text-[#f3f0ff] drop-shadow-[0_0_20px_rgba(168,139,255,0.48)]',
  },
  创作: {
    rail: 'border-[#f7d7c2]/20 bg-[linear-gradient(180deg,rgba(37,45,68,0.88)_0%,rgba(21,48,69,0.9)_54%,rgba(9,36,55,0.96)_100%)] shadow-[inset_-1px_0_0_rgba(247,215,194,0.12)]',
    glow: 'bg-[radial-gradient(circle_at_46%_18%,rgba(255,194,164,0.26),transparent_26%),radial-gradient(circle_at_58%_52%,rgba(105,181,255,0.16),transparent_24%)]',
    activeIcon: 'bg-[#fff4ed] text-[#c46b5a] shadow-[0_0_26px_rgba(255,194,164,0.48),0_0_64px_rgba(91,159,223,0.22)]',
    activeText: 'text-white',
    hoverText: 'hover:text-[#ffe5d8]',
    logo: 'text-[#fff4ed] drop-shadow-[0_0_16px_rgba(255,194,164,0.42)]',
  },
  'Toby Studio': {
    rail: 'border-[#d8c5ff]/20 bg-[linear-gradient(180deg,rgba(34,34,68,0.92)_0%,rgba(27,44,68,0.9)_48%,rgba(13,35,53,0.96)_100%)] shadow-[inset_-1px_0_0_rgba(216,197,255,0.12)]',
    glow: 'bg-[radial-gradient(circle_at_48%_20%,rgba(196,155,236,0.25),transparent_26%),radial-gradient(circle_at_48%_56%,rgba(83,207,216,0.14),transparent_22%)]',
    activeIcon: 'bg-[#f4eeff] text-[#7f5bbe] shadow-[0_0_26px_rgba(196,155,236,0.5),0_0_64px_rgba(83,207,216,0.18)]',
    activeText: 'text-white',
    hoverText: 'hover:text-[#eadcff]',
    logo: 'text-[#f4eeff] drop-shadow-[0_0_16px_rgba(196,155,236,0.42)]',
  },
  灵动画布: {
    rail: 'border-[#b8f4e1]/20 bg-[linear-gradient(180deg,rgba(11,55,63,0.9)_0%,rgba(9,48,61,0.91)_48%,rgba(6,34,51,0.96)_100%)] shadow-[inset_-1px_0_0_rgba(184,244,225,0.12)]',
    glow: 'bg-[radial-gradient(circle_at_50%_22%,rgba(106,223,196,0.22),transparent_26%),radial-gradient(circle_at_56%_58%,rgba(125,220,255,0.16),transparent_22%)]',
    activeIcon: 'bg-[#e9fff8] text-[#167a71] shadow-[0_0_26px_rgba(106,223,196,0.46),0_0_64px_rgba(125,220,255,0.2)]',
    activeText: 'text-white',
    hoverText: 'hover:text-emerald-100',
    logo: 'text-[#e9fff8] drop-shadow-[0_0_16px_rgba(106,223,196,0.42)]',
  },
  资产: {
    rail: 'border-[#d7e8ff]/20 bg-[linear-gradient(180deg,rgba(27,47,65,0.92)_0%,rgba(18,43,61,0.93)_48%,rgba(7,34,51,0.96)_100%)] shadow-[inset_-1px_0_0_rgba(215,232,255,0.1)]',
    glow: 'bg-[radial-gradient(circle_at_50%_20%,rgba(215,232,255,0.18),transparent_26%),radial-gradient(circle_at_54%_56%,rgba(107,163,245,0.14),transparent_22%)]',
    activeIcon: 'bg-[#eef6ff] text-[#416b9b] shadow-[0_0_24px_rgba(215,232,255,0.4),0_0_58px_rgba(107,163,245,0.2)]',
    activeText: 'text-white',
    hoverText: 'hover:text-blue-100',
    logo: 'text-[#eef6ff] drop-shadow-[0_0_14px_rgba(215,232,255,0.34)]',
  },
}

export function CreativeSideRail() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const { showVideoStudioTab } = useTeamFeatures()
  const activeNavItem = creativeNavItems.find((item) => {
    const visibleChildren = item.children?.filter((child) => {
      if (child.feature === 'videoStudio') return showVideoStudioTab
      return true
    })

    return visibleChildren
      ? visibleChildren.some((child) => isNavItemActive(child.href, currentPath))
      : isNavItemActive(item.href, currentPath)
  })
  const activeRailTheme = railThemes[activeNavItem?.label ?? '灵感'] ?? railThemes.灵感

  return (
    <aside
      className={cn(
        'relative hidden h-screen w-20 shrink-0 flex-col items-center overflow-hidden border-r px-2 py-5 text-white backdrop-blur-2xl transition-colors duration-500 lg:flex',
        activeRailTheme.rail
      )}
    >
      <div className={cn('pointer-events-none absolute inset-0 opacity-100 transition duration-500', activeRailTheme.glow)} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/0 via-white/25 to-white/0" />
      <Link href="/" className={cn('relative z-10 mb-12 grid h-9 w-9 place-items-center transition', activeRailTheme.logo)}>
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
                    isActive ? activeRailTheme.activeText : `text-white/50 ${activeRailTheme.hoverText}`
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full border border-white/0 transition duration-300',
                      isActive
                        ? activeRailTheme.activeIcon
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
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Link
              href="/settings"
              className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-white/10 text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:border-white/35 hover:bg-white/20 hover:text-white hover:shadow-[0_0_22px_rgba(129,220,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="个人设置"
            >
              <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">个人设置</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
