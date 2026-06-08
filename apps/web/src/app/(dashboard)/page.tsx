import {
  creativeEntryCards,
  inspirationItems,
} from '@/components/dashboard/creative-home-data'
import { CreativeEntryActions } from '@/components/dashboard/creative-entry-actions'

const entryEyebrows: Record<string, string> = {
  'AI 生图': '文字成图',
  'AI 视频': '动态创作',
  'Toby Studio': '数字人内容',
  灵动画布: '素材编排',
}

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--surface-warm))] px-6 py-8 shadow-sm sm:px-8 lg:px-10">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            灵感启动台
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
              从一个想法开始 AI 创作
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              汇集图片、视频、数字人与画布入口，把灵感快速推进到可编辑、可迭代的创意资产。
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">开始创作</p>
            <h2 className="text-2xl font-semibold text-foreground">选择创作入口</h2>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            按素材类型进入对应能力，保持创意路径清晰。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {creativeEntryCards.map((card) => {
            const Icon = card.icon

            return (
              <article
                key={card.title}
                className="flex min-h-[260px] flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="space-y-5">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${card.accent} text-white shadow-sm`}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">
                      {entryEyebrows[card.title] ?? '创作入口'}
                    </p>
                    <h3 className="text-xl font-semibold text-foreground">{card.title}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {card.description}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <CreativeEntryActions actions={card.actions} />
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">灵感参考</p>
            <h2 className="text-2xl font-semibold text-foreground">精选灵感</h2>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            用渐变色块承载方向与氛围，先浏览主题，再进入对应工具继续创作。
          </p>
        </div>

        <div className="columns-1 gap-4 sm:columns-2 xl:columns-4">
          {inspirationItems.map((item) => (
            <article
              key={item.id}
              className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
              <div className={`${item.heightClass} bg-gradient-to-br ${item.toneClass}`} />
              <div className="space-y-3 p-4">
                <p className="text-xs font-medium text-primary">{item.category}</p>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
