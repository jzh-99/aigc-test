'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 背景视频列表 */
const heroVideoSlides = [
  '/videos/creative-home-bg.mp4',
  '/videos/creative-home-bg2.mp4',
  '/videos/creative-home-bg3.mp4',
  '/videos/creative-home-bg4.mp4',
  '/videos/creative-home-bg5.mp4',
]

/** 淡入淡出过渡时长（ms） */
const FADE_DURATION = 800

export function HeroVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])

  /** 当前视频播放结束时，切换到下一个 */
  const handleVideoEnded = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % heroVideoSlides.length)
  }, [])

  /** 活跃视频索引变化时，播放目标视频并做淡入淡出 */
  useEffect(() => {
    const nextVideo = videoRefs.current[activeIndex]
    if (!nextVideo) return

    // 开始过渡
    setIsTransitioning(true)

    // 等当前视频淡出后，启动下一个视频
    const timer = setTimeout(() => {
      nextVideo.currentTime = 0
      nextVideo.play().catch(() => {
        // 自动播放被浏览器拦截时静默处理
      })
      setIsTransitioning(false)
    }, FADE_DURATION / 2)

    return () => clearTimeout(timer)
  }, [activeIndex])

  /** 初始化：只预加载第一个视频 */
  useEffect(() => {
    const firstVideo = videoRefs.current[0]
    if (firstVideo) {
      firstVideo.play().catch(() => {
        // 自动播放被浏览器拦截时静默处理
      })
    }
  }, [])

  return (
    <>
      {heroVideoSlides.map((src, index) => {
        const isActive = index === activeIndex
        const isFadingOut = isActive && isTransitioning

        return (
          <video
            key={src}
            ref={(el) => {
              videoRefs.current[index] = el
            }}
            className="absolute inset-0 h-full w-full scale-105 object-cover transition-opacity"
            src={src}
            autoPlay={isActive}
            muted
            playsInline
            preload={isActive ? 'metadata' : 'none'}
            aria-hidden="true"
            onEnded={isActive ? handleVideoEnded : undefined}
            style={{
              opacity: isActive && !isFadingOut ? 1 : 0,
              transitionDuration: `${FADE_DURATION}ms`,
              transitionTimingFunction: 'ease-in-out',
            }}
          />
        )
      })}
    </>
  )
}
