'use client'

import { useCallback, useRef, useState } from 'react'

/** 排斥力半径（px），超出此距离字符不动 */
const REPEL_RADIUS = 230
/** 最大偏移距离（px） */
const MAX_OFFSET = 92
/** 弹回过渡时长（ms） */
const RETURN_DURATION = 600

interface CharState {
  x: number
  y: number
}

/** 逐字基础变换 —— 用于实现手写/反美学排版 */
export interface CharVariant {
  /** 旋转角度（deg） */
  rotate?: number
  /** 垂直偏移（px） */
  offsetY?: number
  /** 缩放 */
  scale?: number
}

interface CursorRepelTitleProps {
  text: string
  className?: string
  /** 字符 span 的 CSS 类名 */
  charClassName?: string
  /** 逐字基础变换，实现不对称/手写排版 */
  charVariants?: CharVariant[]
  /** 被推开时的光晕颜色 */
  glowColor?: string
}

export function CursorRepelTitle({
  text,
  className,
  charClassName = 'toby-title-char',
  charVariants,
  glowColor = 'rgba(168, 85, 247, ',
}: CursorRepelTitleProps) {
  const chars = Array.from(text)
  const containerRef = useRef<HTMLHeadingElement>(null)
  const charRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [isActive, setIsActive] = useState(false)
  const [charStates, setCharStates] = useState<CharState[]>(
    () => chars.map(() => ({ x: 0, y: 0 }))
  )

  /** 根据鼠标位置计算每个字符的偏移 */
  const computeRepel = useCallback(
    (mouseX: number, mouseY: number) => {
      const newStates: CharState[] = []
      for (let i = 0; i < chars.length; i++) {
        const el = charRefs.current[i]
        if (!el) {
          newStates.push({ x: 0, y: 0 })
          continue
        }
        const rect = el.getBoundingClientRect()
        const charCenterX = rect.left + rect.width / 2
        const charCenterY = rect.top + rect.height / 2
        const dx = charCenterX - mouseX
        const dy = charCenterY - mouseY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < REPEL_RADIUS && dist > 0) {
          const force = (1 - dist / REPEL_RADIUS) ** 2
          const angle = Math.atan2(dy, dx)
          newStates.push({
            x: Math.cos(angle) * force * MAX_OFFSET,
            y: Math.sin(angle) * force * MAX_OFFSET,
          })
        } else {
          newStates.push({ x: 0, y: 0 })
        }
      }
      return newStates
    },
    [chars.length]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isActive) setIsActive(true)
      const newStates = computeRepel(e.clientX, e.clientY)
      setCharStates(newStates)
    },
    [computeRepel, isActive]
  )

  const handleMouseLeave = useCallback(() => {
    setIsActive(false)
    setCharStates(chars.map(() => ({ x: 0, y: 0 })))
  }, [chars.length])

  /** 拼接每个字符的完整 transform */
  const buildTransform = (index: number, offset: CharState) => {
    const variant = charVariants?.[index]
    const parts: string[] = []

    // 基础变换（手写/反美学）
    if (variant) {
      if (variant.offsetY) parts.push(`translateY(${variant.offsetY}px)`)
      if (variant.rotate) parts.push(`rotate(${variant.rotate}deg)`)
      if (variant.scale && variant.scale !== 1) parts.push(`scale(${variant.scale})`)
    }

    // 光标排斥偏移
    parts.push(`translate(${offset.x}px, ${offset.y}px)`)

    return parts.join(' ')
  }

  return (
    <h1
      ref={containerRef}
      className={className}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'default' }}
    >
      {chars.map((char, i) => {
        const offset = charStates[i] ?? { x: 0, y: 0 }
        const displacement = Math.sqrt(offset.x ** 2 + offset.y ** 2)
        const glowIntensity = Math.min(displacement / MAX_OFFSET, 1)

        return (
          <span
            key={`${char}-${i}`}
            ref={(el) => {
              charRefs.current[i] = el
            }}
            className={charClassName}
            style={{
              transform: buildTransform(i, offset),
              transition: isActive
                ? 'transform 80ms linear'
                : `transform ${RETURN_DURATION}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
              textShadow: glowIntensity > 0.15
                ? `0 0 ${12 + glowIntensity * 20}px ${glowColor}${glowIntensity * 0.5})`
                : 'none',
            }}
            aria-hidden="true"
          >
            {char === ' ' ? ' ' : char}
          </span>
        )
      })}
    </h1>
  )
}
