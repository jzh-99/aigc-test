'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { CreditsBadge } from './credits-badge'
import { WorkspaceSwitcher } from './workspace-switcher'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import {
  LayoutDashboard,
  Images,
  Sparkles,
  Settings,
  Users,
  Shield,
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
  { href: '/assets', label: '资产库', icon: Images },
]

const roleNavItems: NavItem[] = [
  { href: '/team', label: '团队管理', icon: Users, requireTeamRole: 'owner' },
  { href: '/admin', label: '管理后台', icon: Shield, requireUserRole: 'admin' },
]

const bottomNavItems: NavItem[] = [
  { href: '/settings', label: '设置', icon: Settings },
]

export function MobileSidebar() {
  const pathname = usePathname()
  const { setMobileOpen } = useLayoutStore()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())

  const visibleRoleItems = roleNavItems.filter((item) => {
    if (item.requireUserRole && user?.role !== item.requireUserRole) return false
    if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
    return true
  })

  function renderNavItem(item: NavItem) {
    const isActive = item.href === '/'
      ? pathname === '/'
      : pathname.startsWith(item.href)

    return (
      <Button
        key={item.href}
        variant={isActive ? 'default' : 'ghost'}
        className="w-full justify-start gap-3"
        asChild
      >
        <Link href={item.href} onClick={() => setMobileOpen(false)}>
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
          {baseNavItems.map(renderNavItem)}

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
