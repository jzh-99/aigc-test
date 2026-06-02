'use client'

import Link from 'next/link'
import { Film } from 'lucide-react'
import type { ShortDramaProjectListItem } from '@/lib/short-drama/api'

interface ShortDramaProjectCardProps {
  project: ShortDramaProjectListItem
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  draft: { text: '草稿', className: 'border-slate-200 bg-slate-50 text-slate-500' },
  summary_ready: { text: '摘要就绪', className: 'border-sky-100 bg-sky-50 text-sky-600' },
  outline_ready: { text: '大纲就绪', className: 'border-blue-100 bg-blue-50 text-blue-600' },
  assets_ready: { text: '素材就绪', className: 'border-violet-100 bg-violet-50 text-violet-600' },
  episodes_ready: { text: '分集就绪', className: 'border-emerald-100 bg-emerald-50 text-emerald-600' },
  completed: { text: '已完成', className: 'border-green-100 bg-green-50 text-green-700' },
  failed: { text: '失败', className: 'border-red-100 bg-red-50 text-red-600' },
}

export function ShortDramaProjectCard({ project }: ShortDramaProjectCardProps) {
  const statusInfo = STATUS_LABELS[project.status] ?? STATUS_LABELS.draft

  return (
    <Link
      href={`/toby-studio/short-drama/${project.id}`}
      className="group flex min-h-[112px] flex-col justify-between rounded-xl border border-violet-100/70 bg-white/90 p-4 shadow-[0_14px_34px_rgba(75,57,122,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-white hover:shadow-[0_18px_42px_rgba(75,57,122,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500 transition-colors group-hover:bg-violet-100">
          <Film className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-5 text-slate-800">
            {project.title}
          </h3>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 pl-11">
        <div className="flex min-w-0 items-center gap-3 text-xs text-slate-400">
          <span>{project.episodeCount} 集</span>
          <span className="h-1 w-1 rounded-full bg-slate-200" />
          <span>{timeAgo(project.updatedAt)}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}>
          {statusInfo.text}
        </span>
      </div>
    </Link>
  )
}
