'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CreditsBadge } from './credits-badge'
import { WorkspaceSwitcher } from './workspace-switcher'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import { useTeamFeatures } from '@/hooks/use-team-features'
import {
  LayoutDashboard,
  Images,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Settings,
  Users,
  Shield,
  Palette,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  requireTeamRole?: string
  requireUserRole?: string
}

const baseNavItems: NavItem[] = [
  { href: '/', label: '工作台', icon: LayoutDashboard },
  { href: '/generation', label: '创作生成', icon: Sparkles },
  { href: '/canvas', label: '画布', icon: Palette },
  { href: '/assets', label: '资产库', icon: Images },
]

const roleNavItems: NavItem[] = [
  { href: '/team', label: '团队管理', icon: Users, requireTeamRole: 'owner' },
  { href: '/admin', label: '管理后台', icon: Shield, requireUserRole: 'admin' },
]

const bottomNavItems: NavItem[] = [
  { href: '/settings', label: '设置', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarCollapsed, toggleSidebar } = useLayoutStore()
  const { showCanvasTab } = useTeamFeatures()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())

  const visibleBaseItems = baseNavItems.filter((item) => item.href !== '/canvas' || showCanvasTab)

  const visibleRoleItems = roleNavItems.filter((item) => {
    if (item.requireUserRole && user?.role !== item.requireUserRole) return false
    if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
    return true
  })

  function renderNavItem(item: NavItem) {
    const isActive = item.href === '/'
      ? pathname === '/'
      : pathname.startsWith(item.href)

    const button = (
      <Button
        key={item.href}
        variant={isActive ? 'default' : 'ghost'}
        className={cn(
          'w-full justify-start gap-3',
          sidebarCollapsed && 'justify-center px-0'
        )}
        asChild
      >
        <Link href={item.href}>
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
        'hidden md:flex flex-col border-r bg-background transition-all duration-300 relative z-30',
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
          {visibleBaseItems.map(renderNavItem)}

          {visibleRoleItems.length > 0 && (
            <>
              <Separator className="my-2" />
              {visibleRoleItems.map(renderNavItem)}
            </>
          )}

          <Separator className="my-2" />
          {bottomNavItems.map(renderNavItem)}
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
