import Link from 'next/link'
import {
  Bell,
  Gem,
  Menu,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react'
import {
  creativeEntryCards,
  inspirationItems,
} from '@/components/dashboard/creative-home-data'
import { creativeNavItems } from '@/components/layout/nav-config'

const navLabelMap: Record<string, string> = {
  'Toby Studio': 'Toby',
  灵动画布: '画布',
}

const tabItems = ['发现', 'MJ 美学', '视频', '短片']

export default function DashboardPage() {
  return (
    <main className="relative h-screen overflow-hidden bg-[#062236] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_6%,rgba(245,169,98,0.62),transparent_18%),radial-gradient(circle_at_51%_28%,rgba(107,163,245,0.42),transparent_28%),linear-gradient(180deg,#08709b_0%,#07384d_35%,#062236_78%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,22,35,0.58)_0%,rgba(4,22,35,0.18)_38%,rgba(4,22,35,0.34)_100%)]" />
      <div className="absolute left-[13%] top-[10%] h-[32rem] w-[44rem] rounded-full bg-[radial-gradient(circle,rgba(245,169,98,0.22),transparent_68%)] blur-3xl" />
      <div className="absolute right-[7%] top-[-10%] h-[35rem] w-[36rem] rounded-full bg-[radial-gradient(circle,rgba(255,210,170,0.28),transparent_64%)] blur-2xl" />
      <div className="absolute left-[20%] top-[16%] h-[42rem] w-[54rem] -rotate-12 rounded-full border border-white/10 opacity-60 blur-[1px]" />
      <div className="absolute right-[8%] top-[3%] h-[28rem] w-[24rem] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(245,169,98,0.24),rgba(107,163,245,0.1)_42%,transparent_67%)] blur-md" />

      <aside className="absolute inset-y-0 left-0 z-20 hidden w-24 flex-col items-center border-r border-white/10 bg-[#082c3d]/70 px-3 py-7 backdrop-blur-xl lg:flex">
        <Link href="/" className="mb-16 grid h-10 w-10 place-items-center text-white">
          <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
            <path d="M14 6h12l6 10-6 10H14L8 16 14 6Z" fill="currentColor" opacity="0.96" />
            <path d="M14 18h12l6 10-6 6H14l-6-6 6-10Z" fill="currentColor" opacity="0.78" />
          </svg>
          <span className="sr-only">Toby.AI</span>
        </Link>

        <nav className="flex flex-1 flex-col items-center gap-7">
          {creativeNavItems.map((item) => {
            const Icon = item.icon
            const isActive = item.href === '/'

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex flex-col items-center gap-2 text-[11px] font-medium transition ${
                  isActive ? 'text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full transition ${
                    isActive ? 'bg-white text-primary shadow-[0_0_22px_rgba(255,255,255,0.45)]' : ''
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>{navLabelMap[item.label] ?? item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="flex flex-col items-center gap-6 text-white/60">
          <Link
            href="/credits"
            className="rounded-lg border border-white/20 bg-white/5 px-2 py-1.5 text-center text-xs leading-5 text-white/90"
          >
            <span className="flex items-center justify-center gap-1">
              <Gem className="h-3.5 w-3.5 text-primary" />
              100
            </span>
            开通会员
          </Link>
          <UserRound className="h-6 w-6 rounded-full bg-white/80 p-1 text-[#173d4b]" />
          <Bell className="h-5 w-5" />
          <Menu className="h-5 w-5" />
        </div>
      </aside>

      <section className="relative z-10 h-full overflow-y-auto pl-0 lg:pl-24">
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
            <h1 className="select-none text-center font-serif text-[3.25rem] font-normal leading-[1.12] tracking-[0.18em] text-white/50 sm:text-[4.5rem] lg:text-[5.75rem]">
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
                  className="group relative min-h-[11.875rem] overflow-hidden rounded-[28px] border border-white/20 bg-white/10 p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_26px_70px_rgba(0,0,0,0.2)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-white/20"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-30 transition group-hover:opacity-50`} />
                  <div className="absolute -left-8 top-3 h-28 w-32 rounded-full bg-white/20 blur-2xl" />
                  <div className="relative grid h-full grid-cols-[8rem_1fr] items-center gap-6">
                    <div className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-[24px] border border-white/20 bg-white/10 shadow-[inset_0_0_28px_rgba(255,255,255,0.18)]">
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

      <div className="pointer-events-none absolute bottom-0 left-24 right-0 z-20 hidden border-t border-white/10 bg-[#041724]/40 px-4 py-2 text-center text-[12px] text-white/30 backdrop-blur-md lg:block">
        所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
      </div>
    </main>
  )
}
