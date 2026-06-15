import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { creativeEntryCards } from '@/components/dashboard/creative-home-data'
import { CursorRepelTitle, type CharVariant } from '@/components/dashboard/cursor-repel-title'
import { InspirationContent } from '@/components/dashboard/inspiration-content'

/** 「让美好被看见」逐字手写反美学变换 */
const heroCharVariants: CharVariant[] = [
  { rotate: -9.5, offsetY: 14, scale: 1.13 },  // 让
  { rotate: 6.8, offsetY: -11, scale: 0.91 },  // 美
  { rotate: -5.6, offsetY: 12, scale: 1.1 },   // 好
  { rotate: 0, offsetY: -6, scale: 0.72 },     // 空格
  { rotate: 0, offsetY: 8, scale: 0.8 },       // 空格
  { rotate: 10.2, offsetY: -16, scale: 0.88 }, // 被
  { rotate: -7.8, offsetY: 9, scale: 1.12 },   // 看
  { rotate: 5.4, offsetY: -12, scale: 0.93 },  // 见
]

export default function DashboardPage() {
  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 " />
      {/* <div className="pointer-events-none absolute inset-x-0 top-0 h-[62vh] bg-[linear-gradient(180deg,rgba(5,7,22,0.04)_0%,rgba(5,7,22,0.12)_62%,rgba(5,7,22,0.5)_100%)]" /> */}
      <div className="pointer-events-none absolute left-[20%] top-[21%] h-[24rem] w-[58rem] -rotate-12 rounded-full border border-violet-200/10 opacity-25 blur-[1px]" />

      <section className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto flex min-h-screen w-full max-w-[1660px] flex-col px-5 pb-16 pt-16 sm:px-8 lg:px-12 lg:pt-24">
          <div className="flex justify-end lg:hidden">
            <Link
              href="/generation?mode=image"
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white backdrop-blur"
            >
              开始创作
            </Link>
          </div>

          <div className="mt-8 flex justify-center lg:mt-0">
            <CursorRepelTitle
              text="让美好  被看见"
              className="select-none text-center font-serif text-[3.25rem] font-normal leading-[1.12] sm:text-[4.5rem] lg:text-[5.75rem]"
              charClassName="creative-title-char"
              charVariants={heroCharVariants}
              glowColor="rgba(173, 144, 255, "
              windEnabled={false}
            />
          </div>

          <div className="mt-[24vh] grid gap-5 lg:mt-[28vh] lg:grid-cols-3">
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

          <InspirationContent />
        </div>
      </section>

      {/* <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 hidden border-t border-violet-200/10 bg-[#050719]/42 px-4 py-2 text-center text-[12px] text-violet-100/34 backdrop-blur-md lg:block">
        所有创作内容均由 AI 生成，可能存在不准确之处，请自行甄别其真实性
      </div> */}
    </main>
  )
}
