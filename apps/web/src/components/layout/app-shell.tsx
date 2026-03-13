'use client'

import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { TooltipProvider } from '@/components/ui/tooltip'

interface AppShellProps {
  children: React.ReactNode
  title?: string
}

export function AppShell({ children, title }: AppShellProps) {
  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar title={title} />
          <main className="flex-1 overflow-y-auto bg-[hsl(var(--surface-warm))] p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
