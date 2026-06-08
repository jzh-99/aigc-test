import Link from 'next/link'
import {
  Search,
  Sparkles,
} from 'lucide-react'
import {
  creativeEntryCards,
  inspirationItems,
} from '@/components/dashboard/creative-home-data'

const tabItems = ['发现', 'MJ 美学', '视频', '短片']

export default function DashboardPage() {
  return (
    <main className="relative h-screen overflow-hidden bg-[#062236] text-white">
      <video
        className="absolute inset-0 h-full w-full scale-105 object-cover"
        src="/videos/creative-home-bg.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,27,38,0.08)_0%,rgba(2,27,38,0.34)_52%,rgba(2,27,38,0.72)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(255,236,194,0.18),transparent_22%),linear-gradient(90deg,rgba(4,36,51,0.52)_0%,rgba(4,36,51,0.12)_44%,rgba(4,36,51,0.45)_100%)]" />
      <div className="absolute left-[20%] top-[21%] h-[35rem] w-[58rem] -rotate-12 rounded-full border border-white/10 opacity-40 blur-[1px]" />

      <section className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-screen w-full max-w-[1660px] flex-col px-5 pb-16 pt-16 sm:px-8 lg:px-12 lg:pt-20">
          <div className="flex justify-end lg:hidden">
            <Link
              href="/generation?mode=image"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur"
            >
              开始创作
            </Link>
          </div>

          <div className="pointer-events-none mt-8 flex justify-center lg:mt-0">
            <h1 className="creative-home-title select-none text-center font-serif text-[3.25rem] font-normal leading-[1.12] tracking-[0.18em] sm:text-[4.5rem] lg:text-[5.75rem]">
              用想象，造点不同
            </h1>
          </div>

          <div className="mt-20 grid gap-6 lg:mt-28 lg:grid-cols-3">
            {creativeEntryCards.map((card) => {
              const Icon = card.icon
              const primaryAction = card.actions[0]

              return (
                <Link
                  key={card.title}
                  href={primaryAction.href}
                  className="creative-glass-card group relative min-h-[11.875rem] overflow-hidden rounded-[28px] p-7 transition duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-20 transition group-hover:opacity-40`} />
                  <div className="creative-glass-sheen" />
                  <div className="relative grid h-full grid-cols-[8rem_1fr] items-center gap-6">
                    <div className="creative-glass-icon relative grid h-24 w-24 place-items-center overflow-hidden rounded-[24px]">
                      <Sparkles className="absolute left-3 top-3 h-5 w-5 text-white" aria-hidden="true" />
                      <Icon className="h-14 w-14 text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.4)]" aria-hidden="true" />
                    </div>
                    <div className="space-y-3">
                      <h2 className="text-2xl font-semibold tracking-wide text-white">{card.title}</h2>
                      <div className="space-y-1 text-[15px] font-medium leading-6 text-white/60">
                        <p>{card.kicker}</p>
                        <p>{card.description}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="mt-16 flex flex-col gap-5 lg:mt-20 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4 overflow-x-auto">
              {tabItems.map((tab, index) => (
                <button
                  key={tab}
                  type="button"
                  className={`h-11 shrink-0 rounded-full px-6 text-base font-semibold transition ${
                    index === 0
                      ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'text-white/50 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <label className="flex h-11 w-full max-w-[14rem] items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 text-white/50 backdrop-blur lg:mr-3">
              <Search className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm">搜索</span>
            </label>
          </div>

          <div className="mt-7 grid auto-rows-[12rem] grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {inspirationItems.map((item) => (
              <article
                key={item.id}
                className={`group relative row-span-2 overflow-hidden rounded-lg bg-gradient-to-br ${item.toneClass}`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.32),transparent_19%),radial-gradient(circle_at_70%_64%,rgba(255,255,255,0.18),transparent_23%)] opacity-70" />
                <div className="absolute inset-x-0 bottom-0 translate-y-8 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-5 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  <p className="text-xs font-semibold text-primary">{item.category}</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/70">{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 hidden border-t border-white/10 bg-[#041724]/40 px-4 py-2 text-center text-[12px] text-white/30 backdrop-blur-md lg:block">
        所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
      </div>
    </main>
  )
}
