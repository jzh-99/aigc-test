import Link from 'next/link'
import {
  BookOpenText,
  ImageIcon,
  Music2,
  Presentation,
  Sparkles,
  Video,
  WandSparkles,
} from 'lucide-react'
import { CursorRepelTitle } from '@/components/dashboard/cursor-repel-title'

/** 每个模块的渐变色配置 */
const moduleAccents: Record<string, string> = {
  'AI 音乐': 'from-violet-500/70 via-fuchsia-500/25 to-pink-500/30',
  'AI 短剧': 'from-purple-600/30 via-purple-900/10 to-indigo-900/20',
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

export default function TobyStudioPage() {
  return (
    <main className="toby-studio-page relative min-h-full overflow-hidden bg-[#060918] text-white">
      {/* ── 第一层：流动氛围光晕 ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="toby-orb toby-orb--violet absolute -left-[10%] -top-[15%] h-[50rem] w-[50rem] rounded-full" />
        <div className="toby-orb toby-orb--sky absolute -right-[8%] top-[8%] h-[40rem] w-[40rem] rounded-full" />
        <div className="toby-orb toby-orb--amber absolute -bottom-[20%] left-[30%] h-[35rem] w-[35rem] rounded-full" />
      </div>

      {/* ── 第二层：中央渐变聚焦 ── */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(116,87,255,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_60%,rgba(59,130,246,0.06),transparent_40%)]" />
      </div>

      {/* ── 第三层：噪点纹理 ── */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat' }} />

      {/* ── 第四层：顶部到中部渐变过渡 ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[36rem]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0d28]/60 via-transparent to-transparent" />
      </div>

      {/* ── 装饰性倾斜椭圆 ── */}
      <div className="pointer-events-none absolute left-[12%] top-[10%] h-[22rem] w-[56rem] -rotate-12 rounded-full border border-violet-200/[0.06] opacity-25 blur-[1.5px]" />
      <div className="pointer-events-none absolute -right-[8%] top-[35%] h-[16rem] w-[40rem] rotate-[8deg] rounded-full border border-sky-200/[0.04] opacity-20 blur-[1px]" />

      {/* ── 页面内容 ── */}
      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-5 pb-16 pt-10 sm:px-8 lg:px-12 lg:pt-14">
        {/* 页面头部 */}
        <header className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-200/20 bg-white/5 shadow-[0_0_28px_rgba(116,87,255,0.2)] backdrop-blur">
            <WandSparkles className="h-7 w-7 text-violet-300" />
          </div>
          <div>
            <CursorRepelTitle
              text="Toby Studio"
              className="select-none font-serif text-[2.8rem] font-normal leading-[1.12] tracking-wide sm:text-[3.6rem]"
            />
            <p className="mt-3 text-sm font-medium leading-6 text-white/45">
              独立内容工作室，承载音乐、短剧、绘本等专项创作模块。
            </p>
          </div>
        </header>

        {/* 模块卡片网格：统一行高 */}
        <section className="toby-module-grid mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {studioModules.map((item) => {
            const Icon = item.icon
            const accent = moduleAccents[item.title]

            return (
              <ModuleCard
                key={item.title}
                title={item.title}
                description={item.description}
                icon={Icon}
                accent={accent}
                status={item.status}
                available={item.available}
                href={item.available ? item.href : undefined}
              />
            )
          })}
        </section>
      </div>
    </main>
  )
}

/* ──────────────────────────────────────────
   模块卡片子组件
   ────────────────────────────────────────── */

interface ModuleCardProps {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  status: string
  available: boolean
  href?: string
}

function ModuleCard({ title, description, icon: Icon, accent, status, available, href }: ModuleCardProps) {
  const card = (
    <div className="creative-glass-card group flex h-full flex-col overflow-hidden rounded-[24px] p-6 transition duration-300 hover:-translate-y-1">
      {/* 渐变叠层 */}
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-10 transition group-hover:opacity-25`} />
      <div className="creative-glass-sheen" />

      {/* 图标 + 状态 */}
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

      {/* 标题 & 描述 */}
      <div className="relative mt-5 space-y-2.5">
        <h2 className="text-[1.15rem] font-semibold tracking-wide text-white">{title}</h2>
        <p className="text-sm font-medium leading-6 text-white/50">{description}</p>
      </div>

      {/* 底部操作按钮：撑满剩余空间 */}
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
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060918]">
        {card}
      </Link>
    )
  }

  return <div className="opacity-70">{card}</div>
}
