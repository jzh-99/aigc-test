'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { CreditsBadge } from './credits-badge'
import { WorkspaceSwitcher } from './workspace-switcher'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import { Sparkles } from 'lucide-react'
import {
  creativeNavItems,
  isNavItemActive,
  managementNavItems,
  type NavItem,
} from './nav-config'

export function MobileSidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const currentPath = query ? `${pathname}?${query}` : pathname
  const { setMobileOpen } = useLayoutStore()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())

  const visibleManagementItems = managementNavItems.filter((item) => {
    if (item.requireUserRole && user?.role !== item.requireUserRole) return false
    if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
    return true
  })

  function renderNavItem(item: NavItem) {
    const isActive = item.children
      ? item.children.some((child) => isNavItemActive(child.href, currentPath))
      : isNavItemActive(item.href, currentPath)

    return (
      <Button
        key={item.href}
        variant={isActive ? 'default' : 'ghost'}
        className="w-full justify-start gap-3"
        asChild
      >
        <Link
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive ? 'page' : undefined}
        >
          <item.icon className={cn('h-4 w-4 shrink-0')} />
          <span>{item.label}</span>
        </Link>
      </Button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-accent">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-base gradient-accent-text">
            创作平台
          </span>
        </Link>
      </div>

      {/* Workspace Switcher */}
      <div className="px-2 py-2 border-b">
        <WorkspaceSwitcher collapsed={false} />
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="flex flex-col gap-1 px-2">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">创作</p>
          {creativeNavItems.map(renderNavItem)}

          {visibleManagementItems.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">管理</p>
              {visibleManagementItems.map(renderNavItem)}
            </>
          )}
        </nav>
      </ScrollArea>

      {/* Bottom */}
      <div className="mt-auto">
        <Separator />
        <div className="p-3">
          <CreditsBadge collapsed={false} />
        </div>
      </div>
    </div>
  )
}
