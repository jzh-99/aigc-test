'use client'

import Link from 'next/link'
import { BookOpenText, ImageIcon, Music2, Presentation, Sparkles, Video } from 'lucide-react'
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

const moduleAccents: Record<string, string> = {
  'AI 音乐': 'from-violet-500/70 via-fuchsia-500/25 to-pink-500/30',
  'AI 短剧': 'from-sky-500/60 via-blue-500/20 to-indigo-500/40',
  'AI 绘本': 'from-amber-500/60 via-orange-400/20 to-rose-400/30',
  'AI 海报': 'from-emerald-500/60 via-teal-400/20 to-cyan-400/30',
  'AI PPT': 'from-rose-500/60 via-pink-400/20 to-fuchsia-400/30',
}

const studioModules = [
  {
    title: 'AI 音乐',
    description: '生成歌曲、纯音乐，管理我的音乐作品与克隆音色。',
    href: '/toby-studio/music',
    icon: Music2,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 短剧',
    description: '面向短剧脚本、分镜与成片工作流的创作模块。',
    href: '/toby-studio/short-drama',
    icon: Video,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 绘本',
    description: '面向绘本故事、角色设定与连续画面生成的创作模块。',
    href: '/toby-studio/picture-book',
    icon: BookOpenText,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 海报',
    description: '面向品牌宣传、活动物料与营销视觉的海报创作模块。',
    href: '/toby-studio/poster',
    icon: ImageIcon,
    status: '待开放',
    available: false,
  },
  {
    title: 'AI PPT',
    description: '面向提纲生成、页面排版与演示文稿制作的创作模块。',
    href: '/toby-studio/ppt',
    icon: Presentation,
    status: '待开放',
    available: false,
  },
]

export function StudioModuleGrid() {
  return (
    <section className="toby-module-grid mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {studioModules.map((item) => (
        <ModuleCard
          key={item.title}
          title={item.title}
          description={item.description}
          icon={item.icon}
          accent={moduleAccents[item.title]}
          status={item.status}
          available={item.available}
          href={item.available ? item.href : undefined}
        />
      ))}
    </section>
  )
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
