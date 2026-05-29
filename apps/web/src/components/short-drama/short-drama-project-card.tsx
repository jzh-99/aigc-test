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
  draft: { text: '草稿', className: 'bg-gray-100 text-gray-600' },
  summary_ready: { text: '摘要就绪', className: 'bg-blue-100 text-blue-600' },
  outline_ready: { text: '大纲就绪', className: 'bg-blue-100 text-blue-600' },
  assets_ready: { text: '素材就绪', className: 'bg-purple-100 text-purple-600' },
  episodes_ready: { text: '分集就绪', className: 'bg-green-100 text-green-600' },
  completed: { text: '已完成', className: 'bg-green-100 text-green-700' },
  failed: { text: '失败', className: 'bg-red-100 text-red-600' },
}

export function ShortDramaProjectCard({ project }: ShortDramaProjectCardProps) {
  const statusInfo = STATUS_LABELS[project.status] ?? STATUS_LABELS.draft

  return (
    <Link
      href={`/toby-studio/short-drama/${project.id}`}
      className="block p-4 rounded-lg border hover:border-primary/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium text-sm line-clamp-1">{project.title}</h3>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>
          {statusInfo.text}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span>{project.episodeCount} 集</span>
        <span>{timeAgo(project.updatedAt)}</span>
      </div>
    </Link>
  )
}
