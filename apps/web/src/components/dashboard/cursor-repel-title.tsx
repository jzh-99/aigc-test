'use client'

import { useCallback, useEffect, useRef } from 'react'

/** 鼠标排斥半径（px） */
const REPEL_RADIUS = 230
/** 最大偏移距离（px） */
const MAX_OFFSET = 92
/** 弹簧刚度 — 值越大字符回弹力越强 */
const SPRING_K = 0.028
/** 阻尼系数 — 越接近 1 振荡越久（"挣扎"感越强） */
const DAMPING = 0.91

/** @adjustable 鼠标排斥跟随弹簧刚度（越小越慢，0.01-0.1） */
const REPEL_SMOOTH = 0.04
/** @adjustable 鼠标排斥最大偏移（px） */
const REPEL_MAX_DIST = 55
/** @adjustable 反光触发距离（px），鼠标距字符中心此范围内触发 */
const FLASH_RADIUS = 120
/** @adjustable 一次光带扫过耗时（秒） */
const SHIMMER_DURATION = 0.45

/** 逐字基础变换 —— 用于实现手写/反美学排版 */
export interface CharVariant {
  rotate?: number
  offsetY?: number
  scale?: number
}

interface CursorRepelTitleProps {
  text: string
  className?: string
  charClassName?: string
  charVariants?: CharVariant[]
  glowColor?: string
}

/** 每个字符的物理状态 */
interface CharPhysics {
  x: number
  y: number
  vx: number
  vy: number
  repelX: number
  repelY: number
  /** 当前闪光强度（平滑跟随鼠标距离） */
  flash: number
  /** 光带扫过的触发时刻（0 = 未激活） */
  shimmerStart: number
  /** 上一帧是否有悬停（用于检测首次进入） */
  wasHovered: boolean
  /** 上一帧 shimmer 是否处于激活状态（避免每帧重设 style） */
  shimmerActive: boolean
}

/** 黄金比例，用于生成不可公约频率 */
const PHI = 1.618033988749895

/**
 * 复刻 CSS :nth-child 规则的基础亮度
 * :nth-child(3n) → 0.88, :nth-child(odd) → 0.96, 默认 → 0.92
 */
function getBaseBrightness(index: number): number {
  const n = index + 1
  if (n % 3 === 0) return 0.88
  if (n % 2 === 1) return 0.96
  return 0.92
}

/** 伪噪声函数 — 不可公约频率正弦波相乘 */
function windNoise(t: number, seed: number): number {
  const a = Math.sin(t * PHI * 0.7 + seed)
  const b = Math.sin(t * PHI * PHI * 0.5 + seed * 2.3)
  const c = Math.sin(t * PHI * PHI * PHI * 0.3 + seed * 0.7)
  return a * b * c
}

/** 自然风力模型 — 基础风 + 阵风 + 湍流 */
function computeWind(t: number): { x: number; y: number } {
  const baseX = Math.sin(t * 0.08) * 0.3 + Math.sin(t * 0.13 + 1.5) * 0.15
  const baseY = Math.sin(t * 0.06 + 0.8) * 0.1
  const gustEnv = Math.max(0, windNoise(t * 0.35, 0)) ** 0.6
  const gustX = gustEnv * 1.6
  const gustY = gustEnv * 0.35 * Math.sin(t * 0.9 + 2.1)
  const turbX = windNoise(t * 2.5, 3.7) * 0.2
  const turbY = windNoise(t * 3.1, 1.2) * 0.08
  return { x: baseX + gustX + turbX, y: baseY + gustY + turbY }
}

/**
 * 生成反光渐变 — 白色基底 + 窄高光条纹
 * 高光条纹比基色更亮，带有微紫色色调
 */
const SHIMMER_GRADIENT =
  'linear-gradient(105deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.8) 25%, rgba(255,255,255,1) 40%, rgba(210,195,255,0.95) 50%, rgba(255,255,255,1) 60%, rgba(255,255,255,0.8) 75%, rgba(255,255,255,0.8) 100%)'

export function CursorRepelTitle({
  text,
  className,
  charClassName = 'toby-title-char',
  charVariants,
  glowColor = 'rgba(168, 85, 247, ',
}: CursorRepelTitleProps) {
  const chars = Array.from(text)
  const containerRef = useRef<HTMLHeadingElement>(null)
  const charEls = useRef<(HTMLSpanElement | null)[]>([])
  const physicsRef = useRef<CharPhysics[]>(
    chars.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, repelX: 0, repelY: 0, flash: 0, shimmerStart: 0, wasHovered: false, shimmerActive: false }))
  )
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const rafRef = useRef(0)

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current.x = e.clientX
    mouseRef.current.y = e.clientY
    mouseRef.current.inside = true
  }, [])

  const handleMouseLeave = useCallback(() => {
    mouseRef.current.inside = false
  }, [])

  useEffect(() => {
    const t0 = performance.now()
    const ps = physicsRef.current
    const charCount = chars.length

    function tick() {
      const t = (performance.now() - t0) / 1000

      for (let i = 0; i < charCount; i++) {
        const el = charEls.current[i]
        const p = ps[i]
        if (!el || !p) continue

        // ── 1) 风力 ──
        const charDelay = i * 0.12
        const wind = computeWind(t - charDelay)
        const charMul = 1 + (i % 3 - 1) * 0.15
        const fx = wind.x * charMul
        const fy = wind.y * charMul

        // ── 2) 鼠标交互（共用一次 getBoundingClientRect） ──
        let targetRepelX = 0
        let targetRepelY = 0
        let flashTarget = 0

        if (mouseRef.current.inside) {
          const rect = el.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const dx = cx - mouseRef.current.x
          const dy = cy - mouseRef.current.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          // 排斥偏移
          if (dist < REPEL_RADIUS && dist > 0) {
            const force = (1 - dist / REPEL_RADIUS) ** 2
            const angle = Math.atan2(dy, dx)
            targetRepelX = Math.cos(angle) * force * REPEL_MAX_DIST
            targetRepelY = Math.sin(angle) * force * REPEL_MAX_DIST
          }

          // 反光触发距离
          if (dist < FLASH_RADIUS) {
            const ratio = 1 - dist / FLASH_RADIUS
            flashTarget = ratio * ratio
          }
        }

        // 慢速排斥漂移
        p.repelX += (targetRepelX - p.repelX) * REPEL_SMOOTH
        p.repelY += (targetRepelY - p.repelY) * REPEL_SMOOTH

        // ── 3) 反光光带触发：鼠标首次进入字符范围时启动一次扫过 ──
        const isHovered = flashTarget > 0.2
        if (!p.wasHovered && isHovered) {
          p.shimmerStart = t
        }
        p.wasHovered = isHovered

        // 闪光强度平滑跟随（用于 brightness）
        const flashSpeed = flashTarget > p.flash ? 0.2 : 0.08
        p.flash += (flashTarget - p.flash) * flashSpeed

        // ── 4) 风力弹簧积分 ──
        const sx = -SPRING_K * p.x
        const sy = -SPRING_K * p.y
        p.vx = (p.vx + fx + sx) * DAMPING
        p.vy = (p.vy + fy + sy) * DAMPING
        p.x += p.vx
        p.y += p.vy
        p.x = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, p.x))
        p.y = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, p.y))

        // ── 5) 最终位置 ──
        const finalX = p.x + p.repelX
        const finalY = p.y + p.repelY

        // ── 6) transform ──
        const variant = charVariants?.[i]
        const parts: string[] = []
        if (variant) {
          if (variant.offsetY) parts.push(`translateY(${variant.offsetY}px)`)
          if (variant.rotate) parts.push(`rotate(${variant.rotate}deg)`)
          if (variant.scale && variant.scale !== 1) parts.push(`scale(${variant.scale})`)
        }
        parts.push(`translate(${finalX.toFixed(1)}px, ${finalY.toFixed(1)}px)`)
        el.style.transform = parts.join(' ')

        // ── 7) 反光光带渲染 ──
        const shimmerAge = p.shimmerStart > 0 ? t - p.shimmerStart : SHIMMER_DURATION + 1
        const shimmerPlaying = shimmerAge < SHIMMER_DURATION

        if (shimmerPlaying) {
          // 光带从右到左扫过：background-position 100% → -50%
          const progress = shimmerAge / SHIMMER_DURATION
          // easeOutQuart 缓动：开头快，结尾慢，更像光线掠过
          const eased = 1 - (1 - progress) ** 4
          const bgPos = 100 - eased * 150

          if (!p.shimmerActive) {
            // 首次进入：设置 gradient 相关样式
            el.style.background = SHIMMER_GRADIENT
            el.style.backgroundSize = '250% 100%'
            el.style.color = 'transparent'
            el.style.webkitBackgroundClip = 'text'
            el.style.backgroundClip = 'text'
            p.shimmerActive = true
          }
          el.style.backgroundPosition = `${bgPos.toFixed(1)}% center`

          // 亮度：扫过时高亮
          const base = getBaseBrightness(i)
          const shimmerBright = base + 0.45
          el.style.filter = `brightness(${shimmerBright.toFixed(2)})`
        } else {
          // 光带结束：还原所有样式
          if (p.shimmerActive) {
            el.style.background = ''
            el.style.backgroundSize = ''
            el.style.backgroundPosition = ''
            el.style.color = ''
            el.style.webkitBackgroundClip = ''
            el.style.backgroundClip = ''
            p.shimmerActive = false
            p.shimmerStart = 0
          }
          // 正常亮度
          const base = getBaseBrightness(i)
          el.style.filter = `brightness(${base.toFixed(2)})`
        }

        // ── 8) 光晕 ──
        const disp = Math.sqrt(finalX ** 2 + finalY ** 2)
        const windGlow = Math.min(disp / MAX_OFFSET, 1)

        const shadows: string[] = []
        if (windGlow > 0.15) {
          shadows.push(
            `0 0 ${(12 + windGlow * 20).toFixed(0)}px ${glowColor}${(windGlow * 0.5).toFixed(2)})`
          )
        }
        // 光带扫过时的辉光
        if (shimmerPlaying && shimmerAge < SHIMMER_DURATION * 0.8) {
          const progress = shimmerAge / SHIMMER_DURATION
          const peak = Math.sin(progress * Math.PI) // 中间最亮
          shadows.push(
            `0 0 ${(18 + peak * 30).toFixed(0)}px rgba(255, 255, 255, ${(peak * 0.35).toFixed(2)})`,
            `0 0 ${(10 + peak * 16).toFixed(0)}px ${glowColor}${(peak * 0.45).toFixed(2)})`
          )
        }
        el.style.textShadow = shadows.length > 0 ? shadows.join(', ') : 'none'
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [chars.length, charVariants, glowColor])

  return (
    <h1
      ref={containerRef}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'default' }}
    >
      {chars.map((char, i) => (
        <span
          key={`${char}-${i}`}
          ref={(el) => { charEls.current[i] = el }}
          className={charClassName}
          aria-hidden="true"
        >
          {char === ' ' ? ' ' : char}
        </span>
      ))}
    </h1>
  )
}
