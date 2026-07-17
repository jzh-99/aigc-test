import { WandSparkles } from 'lucide-react'
import { CursorRepelTitle } from '@/components/dashboard/cursor-repel-title'
import { StudioModuleGrid } from './module-card'

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
              windEnabled={false}
            />
            <p className="mt-3 text-sm font-medium leading-6 text-white/45">
              独立内容工作室，承载音乐、短剧、绘本等专项创作模块。
            </p>
          </div>
        </header>

        {/* 模块卡片网格：统一行高 */}
        <StudioModuleGrid />
      </div>
    </main>
  )
}
