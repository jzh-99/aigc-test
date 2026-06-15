'use client'

import Link from 'next/link'
import { ArrowUpRight, Clock3, Film, Layers3 } from 'lucide-react'
import type { ShortDramaProjectListItem } from '@/lib/short-drama/api'
import { useNavigationStore } from '@/stores/navigation-store'
import { useRelativeTimeLabel } from '@/hooks/use-relative-time-label'

interface ShortDramaProjectCardProps {
  project: ShortDramaProjectListItem
}

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  draft: { text: '草稿', className: 'border-border bg-white/5 text-muted-foreground' },
  summary_ready: { text: '摘要就绪', className: 'border-sky-400/20 bg-sky-400/10 text-sky-200' },
  outline_ready: { text: '大纲就绪', className: 'border-blue-400/20 bg-blue-400/10 text-blue-200' },
  assets_ready: { text: '素材就绪', className: 'border-violet-400/20 bg-violet-400/10 text-violet-200' },
  episodes_ready: { text: '分集就绪', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
  completed: { text: '已完成', className: 'border-green-400/20 bg-green-400/10 text-green-200' },
  failed: { text: '失败', className: 'border-destructive/25 bg-destructive/10 text-destructive' },
}

export function ShortDramaProjectCard({ project }: ShortDramaProjectCardProps) {
  const statusInfo = STATUS_LABELS[project.status] ?? STATUS_LABELS.draft
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const updatedAtLabel = useRelativeTimeLabel(project.updatedAt)

  return (
    <Link
      href={`/toby-studio/short-drama/${project.id}`}
      className="group relative flex min-h-[148px] overflow-hidden rounded-lg border border-[#201b49] bg-[#0d0b1d] shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_22px_55px_rgba(34,26,63,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
      onClick={() => startNavigation(`/toby-studio/short-drama/${project.id}`)}
    >
      <div className="w-1.5 shrink-0 bg-gradient-to-b from-[#6f7cff] via-[#a86af5] to-[#21c4d6]" />
      <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Film className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                {project.title || '未命名短剧'}
              </h3>
              <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                {project.style ?? project.aspectRatio ?? 'Toby Studio'}
              </p>
            </div>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#302858] text-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-primary">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Layers3 className="h-3.5 w-3.5" />
              {project.episodeCount} 集
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              {updatedAtLabel}
            </span>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}>
            {statusInfo.text}
          </span>
        </div>
      </div>
    </Link>
  )
}
