'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, Settings } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useNavigationStore } from '@/stores/navigation-store'
import { managementNavItems } from './nav-config'
import { cn } from '@/lib/utils'

interface SettingsManagementNavProps {
  showBack?: boolean
}

export function SettingsManagementNav({ showBack = false }: SettingsManagementNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const activeTeam = useAuthStore((s) => s.activeTeam())
  const startNavigation = useNavigationStore((s) => s.startNavigation)

  const tabs = [
    { href: '/settings', label: '个人设置', icon: Settings },
    ...managementNavItems.filter((item) => {
      if (item.href === '/settings' || item.label === '操作手册') return false
      if (item.requireUserRole && user?.role !== item.requireUserRole) return false
      if (item.requireTeamRole && activeTeam?.role !== item.requireTeamRole) return false
      return true
    }),
  ]

  function handleBack() {
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push('/settings')
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/70 p-2">
      {showBack && (
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回上一步
        </button>
      )}
      {tabs.map((item) => {
        const Icon = item.icon
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => startNavigation(item.href)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
