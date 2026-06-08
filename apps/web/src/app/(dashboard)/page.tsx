import Link from 'next/link'
import type { CSSProperties } from 'react'
import {
  Search,
  Sparkles,
} from 'lucide-react'
import {
  creativeEntryCards,
  inspirationItems,
} from '@/components/dashboard/creative-home-data'

const tabItems = ['发现', 'MJ 美学', '视频', '短片']
const heroVideoSlides = [
  '/videos/creative-home-bg.mp4',
  '/videos/creative-home-bg2.mp4',
  '/videos/creative-home-bg3.mp4',
  '/videos/creative-home-bg4.mp4',
]
const heroTitleChars = Array.from('让美好被看见')

export default function DashboardPage() {
  return (
    <main className="relative h-screen overflow-hidden bg-[#080b22] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[31rem] overflow-hidden lg:h-[32rem]">
        {heroVideoSlides.map((src, index) => (
          <video
            key={src}
            className="creative-home-video-slide absolute inset-0 h-full w-full scale-105 object-cover"
            src={src}
            autoPlay
            muted
            loop
            playsInline
            preload={index === 0 ? 'metadata' : 'none'}
            aria-hidden="true"
            style={{ animationDelay: `${index * 6}s` }}
          />
        ))}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,8,31,0.18)_0%,rgba(10,15,48,0.46)_56%,rgba(8,11,34,0.96)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(173,144,255,0.2),transparent_24%),radial-gradient(circle_at_80%_18%,rgba(77,160,255,0.14),transparent_30%),linear-gradient(90deg,rgba(5,10,30,0.68)_0%,rgba(21,18,54,0.18)_45%,rgba(7,12,34,0.64)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[#080b22]" />
      </div>
      <div className="pointer-events-none absolute left-[20%] top-[21%] h-[24rem] w-[58rem] -rotate-12 rounded-full border border-violet-200/10 opacity-25 blur-[1px]" />

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

          <div className="mt-8 flex justify-center lg:mt-0">
            <h1
              className="creative-home-title select-none text-center font-serif text-[3.25rem] font-normal leading-[1.12] sm:text-[4.5rem] lg:text-[5.75rem]"
              aria-label="让美好被看见"
            >
              {heroTitleChars.map((char, index) => (
                <span
                  key={`${char}-${index}`}
                  className="creative-home-title-char"
                  data-char={char}
                  style={{
                    '--char-lift': index % 2 === 0 ? '0em' : '-0.035em',
                    '--char-tilt': `${(index - 3) * -0.7}deg`,
                    '--char-hover-tilt': `${(index - 3) * 1.6}deg`,
                  } as CSSProperties}
                  aria-hidden="true"
                >
                  {char}
                </span>
              ))}
            </h1>
          </div>

          <div className="mt-16 grid gap-5 lg:mt-24 lg:grid-cols-2">
            {creativeEntryCards.map((card) => {
              const Icon = card.icon
              const primaryAction = card.actions[0]

              return (
                <Link
                  key={card.title}
                  href={primaryAction.href}
                  className="creative-glass-card group relative min-h-[9.75rem] overflow-hidden rounded-[24px] p-6 transition duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-10 transition group-hover:opacity-25`} />
                  <div className="creative-glass-sheen" />
                  <div className="relative grid h-full grid-cols-[6.5rem_1fr] items-center gap-5">
                    <div className="creative-glass-icon relative grid h-20 w-20 place-items-center overflow-hidden rounded-[20px]">
                      <Sparkles className="absolute left-2.5 top-2.5 h-4 w-4 text-white" aria-hidden="true" />
                      <Icon className="h-11 w-11 text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.4)]" aria-hidden="true" />
                    </div>
                    <div className="space-y-2.5">
                      <h2 className="text-[1.35rem] font-semibold tracking-wide text-white">{card.title}</h2>
                      <div className="space-y-1 text-sm font-medium leading-5 text-white/60">
                        <p>{card.kicker}</p>
                        <p>{card.description}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="creative-home-content-panel -mx-5 mt-8 px-5 pb-16 pt-14 sm:-mx-8 sm:px-8 lg:-mx-12 lg:mt-10 lg:px-12">
            <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4 overflow-x-auto">
                {tabItems.map((tab, index) => (
                  <button
                    key={tab}
                    type="button"
                    className={`h-11 shrink-0 rounded-full px-6 text-base font-semibold transition ${
                      index === 0
                        ? 'bg-violet-200/10 text-white shadow-[inset_0_1px_0_rgba(226,214,255,0.24),0_0_28px_rgba(116,87,255,0.14)]'
                        : 'text-white/50 hover:bg-violet-200/10 hover:text-violet-50'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <label className="flex h-11 w-full max-w-[14rem] items-center gap-3 rounded-full border border-violet-200/10 bg-[#151a3f]/35 px-4 text-violet-100/55 shadow-[inset_0_1px_0_rgba(226,214,255,0.1)] backdrop-blur lg:mr-3">
                <Search className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm">搜索</span>
              </label>
            </div>

            <div className="relative z-10 mt-7 grid auto-rows-[12rem] grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
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
        </div>
      </section>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 hidden border-t border-violet-200/10 bg-[#07091d]/55 px-4 py-2 text-center text-[12px] text-violet-100/28 backdrop-blur-md lg:block">
        所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
      </div>
    </main>
  )
}
