'use client'

import { Topbar } from './topbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAssistant } from '@/components/ai-assistant/ai-assistant'
import { usePathname } from 'next/navigation'
import { CreativeSideRail } from './creative-side-rail'

interface AppShellProps {
  children: React.ReactNode
  title?: string
  mainClassName?: string
}

export function AppShell({ children, title, mainClassName }: AppShellProps) {
  const pathname = usePathname()
  const isCreativeHome = pathname === '/'

  if (isCreativeHome && !title) {
    return (
      <TooltipProvider>
        <div className="flex h-screen overflow-hidden bg-[#062236]">
          <CreativeSideRail />
          <div className="min-w-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
        <AiAssistant />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-[#082c3d]">
        <CreativeSideRail />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="lg:hidden">
            <Topbar title={title} />
          </div>
          <main className={mainClassName ?? 'flex-1 overflow-y-auto bg-[hsl(var(--surface-warm))] p-4 md:p-6'}>
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

