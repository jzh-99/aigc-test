'use client'

import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { inspirationItems } from '@/components/dashboard/creative-home-data'
import { useHomeScrollStore } from '@/stores/home-scroll-store'
import { cn } from '@/lib/utils'

const TAB_ITEMS = ['发现', 'MJ 美学', '视频', '短片']

export function InspirationContent() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isTabSticky = useHomeScrollStore((s) => s.isTabSticky)
  const setTabSticky = useHomeScrollStore((s) => s.setTabSticky)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    /* 以 section 滚动容器为 root，检测哨兵是否滚出可视区 */
    const scrollRoot = sentinel.closest('section') as HTMLElement | null

    const observer = new IntersectionObserver(
      ([entry]) => {
        setTabSticky(entry.intersectionRatio < 0.05)
      },
      { threshold: [0, 0.05], root: scrollRoot }
    )

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
      setTabSticky(false)
    }
  }, [setTabSticky])

  return (
    <div className="creative-home-content-panel -mx-5 mt-8 sm:-mx-8 lg:-mx-12 lg:mt-10">
      {/* 模糊虚化分界线 */}
      {/* <div className="inspiration-divider" aria-hidden="true" /> */}

      {/* IntersectionObserver 哨兵元素 — 用于检测标签栏是否到达顶部 */}
      <div ref={sentinelRef} className="h-0" aria-hidden="true" />

      {/* 吸顶标签栏 */}
      <div className={cn(
        'inspiration-sticky-tabs sticky top-0 z-20 px-5 py-4 sm:px-6 lg:px-10',
        isTabSticky && 'is-stuck'
      )}>
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4 overflow-x-auto">
            {TAB_ITEMS.map((tab, index) => (
              <button
                key={tab}
                type="button"
                className={`h-9 shrink-0 rounded-full px-4 text-base font-semibold transition ${
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
      </div>

      {/* 灵感内容网格 */}
      <div className="relative z-10 mt-7 grid auto-rows-[12rem] grid-cols-1 gap-2.5 px-5 pb-16 sm:grid-cols-2 sm:px-8 xl:grid-cols-5 lg:px-12">
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
  )
}
