'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clapperboard, ImageIcon, Loader2, Paintbrush, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { CursorRepelTitle, type CharVariant } from '@/components/dashboard/cursor-repel-title'
import type { LucideIcon } from 'lucide-react'

/** 入口项配置 */
interface EntryConfig {
  icon: LucideIcon
  label: string
  desc: string
  name: string
  accent: string
}

const ENTRIES: EntryConfig[] = [
  {
    icon: Clapperboard,
    label: '制作视频',
    desc: '剧本 → 分镜 → 角色 → 视频',
    name: '未命名视频项目',
    accent: 'from-sky-500/60 via-blue-500/20 to-indigo-500/40',
  },
  {
    icon: ImageIcon,
    label: '生成图片',
    desc: '描述你想要的图片',
    name: '未命名图片项目',
    accent: 'from-violet-500/70 via-fuchsia-500/25 to-pink-500/30',
  },
  {
    icon: Paintbrush,
    label: '自由创作',
    desc: '空白画布，自由搭建',
    name: '未命名画布',
    accent: 'from-amber-500/60 via-orange-400/20 to-rose-400/30',
  },
]

/** 标题逐字变换 */
const titleVariants: CharVariant[] = [
  { rotate: -2.5, offsetY: 3, scale: 1.04 },
  { rotate: 1.8, offsetY: -2, scale: 0.97 },
  { rotate: -1.2, offsetY: 4, scale: 1.02 },
  { rotate: 3.0, offsetY: -3, scale: 0.95 },
  { rotate: -2.0, offsetY: 2, scale: 1.03 },
]

export default function CanvasIndexPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const [checking, setChecking] = useState(true)
  const [creating, setCreating] = useState<number | null>(null)

  useEffect(() => {
    if (!isInitialized || !token) return
    const qs = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
    fetch(`/api/v1/canvases${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((canvases: Array<{ id: string }>) => {
        if (canvases.length > 0) {
          router.replace('/canvas/gallery')
        } else {
          setChecking(false)
        }
      })
      .catch(() => setChecking(false))
  }, [isInitialized, token, activeWorkspaceId, router])

  async function createCanvas(idx: number) {
    if (!token || creating !== null) return
    setCreating(idx)
    try {
      const res = await fetch('/api/v1/canvases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: ENTRIES[idx].name,
          ...(activeWorkspaceId ? { workspace_id: activeWorkspaceId } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      const canvas = await res.json()
      router.push(`/canvas/editor/${canvas.id}`)
    } catch {
      toast.error('创建画布失败')
      setCreating(null)
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-[#060918]">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400/60" />
      </div>
    )
  }

  return (
    <main className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-[#060918] px-4 text-white">
      {/* ── 氛围光效 ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="toby-orb toby-orb--violet absolute -left-[10%] -top-[10%] h-[40rem] w-[40rem] rounded-full" />
        <div className="toby-orb toby-orb--sky absolute -right-[5%] top-[15%] h-[32rem] w-[32rem] rounded-full" />
        <div className="toby-orb toby-orb--amber absolute -bottom-[15%] left-[25%] h-[28rem] w-[28rem] rounded-full" />
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(116,87,255,0.10),transparent_55%)]" />
      </div>
      {/* 噪点纹理 */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundRepeat: 'repeat' }} />
      {/* 装饰椭圆 */}
      <div className="pointer-events-none absolute left-[8%] top-[15%] h-[18rem] w-[45rem] -rotate-12 rounded-full border border-violet-200/[0.06] opacity-20 blur-[1.5px]" />

      {/* ── 页面内容 ── */}
      <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center gap-10 py-16">
        {/* 标题 */}
        <div className="text-center">
          <CursorRepelTitle
            text="你想做什么"
            className="select-none font-serif text-[2.4rem] font-normal leading-[1.12] sm:text-[3rem]"
            charClassName="toby-title-char"
            charVariants={titleVariants}
            glowColor="rgba(116, 87, 255, "
          />
          <p className="mt-3 text-sm font-medium text-white/40">选择一个方向开始创作</p>
        </div>

        {/* 入口卡片 */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          {ENTRIES.map((entry, idx) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.label}
                type="button"
                onClick={() => createCanvas(idx)}
                disabled={creating !== null}
                className="creative-glass-card group relative flex h-full flex-col overflow-hidden rounded-[20px] p-5 text-left transition duration-300 hover:-translate-y-1 disabled:opacity-60"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${entry.accent} opacity-10 transition group-hover:opacity-25`} />
                <div className="creative-glass-sheen" />

                <div className="relative creative-glass-icon grid h-10 w-10 place-items-center overflow-hidden rounded-xl">
                  <Sparkles className="absolute left-1 top-1 h-3 w-3 text-white" aria-hidden="true" />
                  <Icon className="h-5 w-5 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]" aria-hidden="true" />
                </div>
                <div className="relative mt-4">
                  <div className="text-[1.05rem] font-semibold tracking-wide text-white">{entry.label}</div>
                  <div className="mt-1 text-sm font-medium text-white/45">{entry.desc}</div>
                </div>
                {creating === idx && (
                  <Loader2 className="relative mt-3 h-4 w-4 animate-spin text-violet-300" />
                )}
              </button>
            )
          })}

          {/* 批量生产（待开放） */}
          <div className="opacity-40">
            <div className="creative-glass-card relative flex h-full flex-col overflow-hidden rounded-[20px] p-5">
              <div className="relative creative-glass-icon grid h-10 w-10 place-items-center overflow-hidden rounded-xl">
                <Sparkles className="absolute left-1 top-1 h-3 w-3 text-white" aria-hidden="true" />
                <span className="text-lg">📦</span>
              </div>
              <div className="relative mt-4">
                <div className="text-[1.05rem] font-semibold tracking-wide text-white">批量生产</div>
                <div className="mt-1 text-sm font-medium text-white/45">即将推出</div>
              </div>
            </div>
          </div>
        </div>

        {/* 查看全部 */}
        <a
          href="/canvas/gallery"
          className="text-sm font-medium text-white/35 transition-colors hover:text-white/70"
        >
          查看全部画布 →
        </a>
      </div>
    </main>
  )
}
