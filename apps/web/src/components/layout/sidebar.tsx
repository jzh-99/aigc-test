'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CreditsBadge } from './credits-badge'
import { WorkspaceSwitcher } from './workspace-switcher'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import { PanelLeftClose, PanelLeft } from 'lucide-react'
import { isNavItemActive, managementNavItems, type NavItem } from './nav-config'

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const { sidebarCollapsed, toggleSidebar } = useLayoutStore()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())

  const visibleManagementItems = managementNavItems.filter((item) => {
    if (item.requireUserRole && user?.role !== item.requireUserRole) return false
    if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
    return true
  })

  function renderNavItem(item: NavItem) {
    const isActive = isNavItemActive(item.href, currentPath)

    const button = (
      <Button
        key={item.href}
        variant="ghost"
        className={cn(
          'w-full justify-start gap-3',
          sidebarCollapsed && 'justify-center px-0',
          isActive ? 'nav-item-active' : 'hover:bg-accent'
        )}
        asChild
      >
        <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
          <item.icon className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>{item.label}</span>}
        </Link>
      </Button>
    )

    if (sidebarCollapsed) {
      return (
        <Tooltip key={item.href} delayDuration={0}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      )
    }
    return button
  }

  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col border-r bg-background transition-all duration-300 relative z-30',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-accent shrink-0">
            <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* T crossbar */}
              <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white"/>
              {/* T stem */}
              <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white"/>
              {/* AI dot */}
              <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.7)"/>
            </svg>
          </div>
          {!sidebarCollapsed && (
            <span className="font-bold text-xl gradient-accent-text tracking-tight whitespace-nowrap drop-shadow-sm">
              Toby.AI 企业版
            </span>
          )}
        </Link>
      </div>

      {/* Workspace Switcher */}
      <div className="px-2 py-2 border-b">
        <WorkspaceSwitcher collapsed={sidebarCollapsed} />
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="flex flex-col gap-1 px-2">
          {visibleManagementItems.map(renderNavItem)}
        </nav>
      </ScrollArea>

      {/* Bottom section */}
      <div className="mt-auto">
        <Separator />
        <div className="p-3">
          <CreditsBadge collapsed={sidebarCollapsed} />
        </div>
        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            size="icon"
            className="w-full"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </aside>
  )
}
