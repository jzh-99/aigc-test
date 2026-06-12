'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { useNavigationStore } from '@/stores/navigation-store'

interface ModuleCardProps {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  status: string
  available: boolean
  href?: string
}

export function ModuleCard({ title, description, icon: Icon, accent, status, available, href }: ModuleCardProps) {
  const startNavigation = useNavigationStore((s) => s.startNavigation)

  const card = (
    <div className="creative-glass-card group flex h-full flex-col overflow-hidden rounded-[24px] p-6 transition duration-300 hover:-translate-y-1">
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-10 transition group-hover:opacity-25`} />
      <div className="creative-glass-sheen" />

      <div className="relative flex items-start justify-between">
        <div className="creative-glass-icon relative grid h-12 w-12 place-items-center overflow-hidden rounded-2xl">
          <Sparkles className="absolute left-1.5 top-1.5 h-3.5 w-3.5 text-white" aria-hidden="true" />
          <Icon className="h-6 w-6 text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.35)]" aria-hidden="true" />
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-sm ${
            available
              ? 'border border-emerald-400/25 bg-emerald-500/15 text-emerald-300'
              : 'border border-white/10 bg-white/5 text-white/35'
          }`}
        >
          {status}
        </span>
      </div>

      <div className="relative mt-5 space-y-2.5">
        <h2 className="text-[1.15rem] font-semibold tracking-wide text-white">{title}</h2>
        <p className="text-sm font-medium leading-6 text-white/50">{description}</p>
      </div>

      <div className="relative mt-auto pt-5">
        <span
          className={`inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-semibold transition ${
            available
              ? 'bg-white/8 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-white/14'
              : 'cursor-not-allowed text-white/25'
          }`}
        >
          {available ? '进入模块' : '敬请期待'}
        </span>
      </div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060918]"
        onClick={() => startNavigation(href)}
      >
        {card}
      </Link>
    )
  }

  return <div className="opacity-70">{card}</div>
}
