'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { inspirationItems, type InspirationItem } from '@/components/dashboard/creative-home-data'
import { InspirationLightbox } from '@/components/dashboard/inspiration-lightbox'
import { useHomeScrollStore } from '@/stores/home-scroll-store'
import { cn } from '@/lib/utils'

export function InspirationContent() {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isTabSticky = useHomeScrollStore((s) => s.isTabSticky)
  const setTabSticky = useHomeScrollStore((s) => s.setTabSticky)
  const [selectedItem, setSelectedItem] = useState<InspirationItem | null>(null)

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

  const handleLightboxOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedItem(null)
  }, [])

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
            <button
              type="button"
              className="h-9 shrink-0 rounded-full bg-violet-200/10 px-4 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(226,214,255,0.24),0_0_28px_rgba(116,87,255,0.14)] transition"
            >
              发现
            </button>
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
            className="group relative row-span-2 cursor-pointer overflow-hidden rounded-lg bg-[#10142e]"
            onClick={() => setSelectedItem(item)}
          >
            <img
              src={item.imageUrl}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,22,0.02)_0%,rgba(4,6,22,0.16)_46%,rgba(4,6,22,0.82)_100%)] opacity-75 transition duration-300 group-hover:opacity-95" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.18),transparent_18%),radial-gradient(circle_at_72%_68%,rgba(137,116,255,0.16),transparent_30%)] opacity-50 mix-blend-screen" />
            <div className="absolute inset-x-0 bottom-0 translate-y-8 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-5 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
              <p className="text-xs font-semibold text-violet-100/78">{item.category}</p>
              <h3 className="mt-1 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/70">{item.description}</p>
            </div>
          </article>
        ))}
      </div>

      {/* 灵感图片大图弹窗 */}
      <InspirationLightbox
        item={selectedItem}
        open={!!selectedItem}
        onOpenChange={handleLightboxOpenChange}
      />
    </div>
  )
}
