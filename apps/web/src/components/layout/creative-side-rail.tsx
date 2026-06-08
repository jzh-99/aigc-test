'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bell, Gem, Menu, Moon, Sun, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { useTeamFeatures } from '@/hooks/use-team-features'
import {
  creativeNavItems,
  isNavItemActive,
} from './nav-config'

const navLabelMap: Record<string, string> = {
  'Toby Studio': 'Toby',
  灵动画布: '画布',
}

export function CreativeSideRail() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const { theme, toggleTheme } = useTheme()
  const { showVideoStudioTab } = useTeamFeatures()

  return (
    <aside className="hidden h-screen w-24 shrink-0 flex-col items-center border-r border-white/10 bg-[#082c3d]/80 px-3 py-7 text-white backdrop-blur-xl lg:flex">
      <Link href="/" className="mb-16 grid h-10 w-10 place-items-center text-white">
        <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
          <path d="M14 6h12l6 10-6 10H14L8 16 14 6Z" fill="currentColor" opacity="0.96" />
          <path d="M14 18h12l6 10-6 6H14l-6-6 6-10Z" fill="currentColor" opacity="0.78" />
        </svg>
        <span className="sr-only">Toby.AI</span>
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-7">
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
                    'group flex flex-col items-center gap-2 text-[11px] font-medium transition',
                    isActive ? 'text-white' : 'text-white/50 hover:text-white/80'
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full transition',
                      isActive && 'bg-white text-primary shadow-[0_0_22px_rgba(255,255,255,0.45)]'
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>{navLabelMap[item.label] ?? item.label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      <div className="flex flex-col items-center gap-5 text-white/60">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Link
              href="/credits"
              className="rounded-lg border border-white/20 bg-white/5 px-2 py-1.5 text-center text-xs leading-5 text-white/90 transition hover:bg-white/10"
            >
              <span className="flex items-center justify-center gap-1">
                <Gem className="h-3.5 w-3.5 text-primary" />
                100
              </span>
              开通会员
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">A豆与会员</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9 rounded-full text-white/65 hover:bg-white/10 hover:text-white"
              aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          </TooltipContent>
        </Tooltip>

        <UserRound className="h-6 w-6 rounded-full bg-white/80 p-1 text-[#173d4b]" />
        <Bell className="h-5 w-5" />
        <Menu className="h-5 w-5" />
      </div>
    </aside>
  )
}
