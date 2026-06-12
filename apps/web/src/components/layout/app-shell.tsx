'use client'

import { Suspense } from 'react'
import { Topbar } from './topbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAssistant } from '@/components/ai-assistant/ai-assistant'
import { HeroVideoCarousel } from '@/components/dashboard/hero-video-carousel'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useHomeScrollStore } from '@/stores/home-scroll-store'
import { CreativeSideRail } from './creative-side-rail'

/** useSearchParams 加载期占位，宽度与侧边栏一致避免布局跳变 */
function SideRailFallback() {
  return <div className="hidden lg:block w-20 h-screen shrink-0" />
}

/** 使用暗色全屏背景的页面路径（不需要父级浅色背景和 padding） */
const DARK_FULLBLEED_PATHS = new Set([
  '/canvas',
  '/canvas/gallery',
  '/assets',
  '/toby-studio',
])

interface AppShellProps {
  children: React.ReactNode
  title?: string
  mainClassName?: string
}

export function AppShell({ children, title, mainClassName }: AppShellProps) {
  const pathname = usePathname()
  const isCreativeHome = pathname === '/'
  const isDarkFullbleed = DARK_FULLBLEED_PATHS.has(pathname)
  const isTabSticky = useHomeScrollStore((s) => s.isTabSticky)

  if (isCreativeHome && !title) {
    return (
      <TooltipProvider>
        <div className="relative flex h-screen overflow-hidden bg-[#050719]">
          <div className={cn(
            'creative-home-video-backdrop pointer-events-none fixed inset-0',
            isTabSticky && 'is-stuck'
          )}>
            <HeroVideoCarousel />
          </div>
          <Suspense fallback={<SideRailFallback />}>
            <CreativeSideRail />
          </Suspense>
          <div className={cn(
            'relative z-10 min-w-0 flex-1 overflow-hidden transition-colors duration-500',
            isTabSticky && 'bg-black/90'
          )}>
            {children}
          </div>
        </div>
        <AiAssistant />
      </TooltipProvider>
    )
  }

  /** 暗色全屏页面的 main 样式：无浅色背景、无 padding */
  const darkMainClass = 'flex-1 overflow-y-auto'
  /** 标准页面的 main 样式：无独立背景，透出父容器的统一渐变 */
  const defaultMainClass = 'flex-1 overflow-y-auto p-4 md:p-6'

  return (
    <TooltipProvider>
      {/* 父容器使用与侧边栏渐变等效的不透明纵向渐变，侧边栏和 main 均透明以共享同一层背景 */}
      <div className="flex h-screen overflow-hidden bg-[linear-gradient(180deg,#0E112B_0%,#0C102E_48%,#06081A_100%)]">
        <Suspense fallback={<SideRailFallback />}>
          <CreativeSideRail />
        </Suspense>
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="lg:hidden">
            <Topbar title={title} />
          </div>
          <main className={mainClassName ?? (isDarkFullbleed ? darkMainClass : defaultMainClass)}>
            {children}
          </main>
          {/* <div className={`shrink-0 border-t px-4 py-1.5 text-center text-[11px] ${isDarkFullbleed ? 'border-violet-200/10 bg-[#07091d]/55 text-violet-100/28 backdrop-blur-md' : 'text-muted-foreground/60 bg-[hsl(var(--surface-warm))]'}`}>
            所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
          </div> */}
        </div>
      </div>
      <AiAssistant />
    </TooltipProvider>
  )
}
