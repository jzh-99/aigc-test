'use client'

import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAssistant } from '@/components/ai-assistant/ai-assistant'

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
          <div className="shrink-0 border-t px-4 py-1.5 text-center text-[11px] text-muted-foreground/60 bg-[hsl(var(--surface-warm))]">
            所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
          </div>
        </div>
      </div>
      <AiAssistant />
    </TooltipProvider>
  )
}

