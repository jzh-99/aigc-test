'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { cn } from '@/lib/utils'

// @adjustable 磁吸生效距离（像素）
const MAGNETIC_RANGE = 60
// @adjustable 磁吸最大偏移距离（像素）
const MAX_DRIFT = 8
// @adjustable 悬停放大倍数
const HOVER_SCALE = 1.8
// @adjustable 原始点大小（像素）
const DOT_SIZE = 10
// @adjustable 放大后点大小
const DOT_SIZE_HOVER = DOT_SIZE * HOVER_SCALE

interface NodeHandleProps {
  /** 'target' | 'source' */
  type: 'target' | 'source'
  /** Handle 位置 */
  position: Position
  /** Handle ID */
  id: string
  /** 是否在 group-hover 时显示（仅 source） */
  showOnGroupHover?: boolean
  /** 传入的 className */
  className?: string
  /** 传入的 style */
  style?: React.CSSProperties
  /** 节点 ID，用于动画 */
  nodeId?: string
}

/**
 * 增强型节点连接点组件
 *
 * 特性：
 * 1. 悬停放大特效 - 鼠标靠近时连接点放大
 * 2. 磁吸效果 - 一定范围内连接点向鼠标方向轻微移动
 * 3. 连接动画 - 新连接建立时触发涟漪效果
 */
export const NodeHandle = memo(function NodeHandle({
  type,
  position,
  id,
  showOnGroupHover = false,
  className,
  style,
  nodeId
}: NodeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const [isNearby, setIsNearby] = useState(false)
  const [drift, setDrift] = useState({ x: 0, y: 0 })
  const [isPulsing, setIsPulsing] = useState(false)
  const animationFrameRef = useRef<number>()
  const prevEdgeCountRef = useRef(0)

  // 计算磁吸偏移和悬停状态
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    const handleMouseMove = (e: Event) => {
      const mouseEvent = e as MouseEvent
      const rect = handle.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const dx = mouseEvent.clientX - centerX
      const dy = mouseEvent.clientY - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)

      // 检查是否在磁吸范围内
      if (distance < MAGNETIC_RANGE) {
        setIsNearby(true)

        // 计算磁吸偏移（使用二次衰减让移动更自然）
        const factor = 1 - distance / MAGNETIC_RANGE
        const driftAmount = MAX_DRIFT * factor * factor

        // 限制偏移量
        const driftX = Math.sign(dx) * Math.min(Math.abs(dx), driftAmount)
        const driftY = Math.sign(dy) * Math.min(Math.abs(dy), driftAmount)

        setDrift({ x: driftX, y: driftY })
      } else {
        setIsNearby(false)
        setDrift({ x: 0, y: 0 })
      }
    }

    const handleMouseLeave = () => {
      setIsNearby(false)
      setDrift({ x: 0, y: 0 })
    }

    // 在 node 元素上监听鼠标移动
    const node = handle.closest('.react-flow__node')
    if (node) {
      node.addEventListener('mousemove', handleMouseMove)
      node.addEventListener('mouseleave', handleMouseLeave)

      return () => {
        node.removeEventListener('mousemove', handleMouseMove)
        node.removeEventListener('mouseleave', handleMouseLeave)
      }
    }
  }, [])

  // 监听连接变化，触发涟漪动画
  useEffect(() => {
    if (!nodeId) return

    // 监听自定义连接事件
    const handleConnectionEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetNodeId: string; targetHandleId: string }>
      if (customEvent.detail.targetNodeId === nodeId && customEvent.detail.targetHandleId === id) {
        setIsPulsing(true)
        setTimeout(() => setIsPulsing(false), 600)
      }
    }

    window.addEventListener('node-connected', handleConnectionEvent)

    return () => {
      window.removeEventListener('node-connected', handleConnectionEvent)
    }
  }, [nodeId, id])

  // 动画循环：平滑过渡磁吸偏移
  useEffect(() => {
    const targetDrift = drift
    let currentDrift = { x: 0, y: 0 }
    const stiffness = 0.15 // @adjustable 弹簧刚度（0.05-0.3，越大越快）

    const animate = () => {
      const dx = targetDrift.x - currentDrift.x
      const dy = targetDrift.y - currentDrift.y

      // 距离足够小时停止动画
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
        currentDrift = { ...targetDrift }
        setDrift(currentDrift)
        animationFrameRef.current = undefined
        return
      }

      // 弹簧动画
      currentDrift.x += dx * stiffness
      currentDrift.y += dy * stiffness

      setDrift(currentDrift)
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    if (drift.x !== 0 || drift.y !== 0) {
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(animate)
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [drift])

  // 计算实际点的大小
  const currentDotSize = isNearby ? DOT_SIZE_HOVER : DOT_SIZE
  const dotStyle: React.CSSProperties = {
    width: `${currentDotSize}px`,
    height: `${currentDotSize}px`,
    transform: `translate(${drift.x}px, ${drift.y}px)`,
    transition: drift.x === 0 && drift.y === 0 ? 'transform 0.2s ease-out' : 'none'
  }

  // 涟漪动画样式
  const pulseStyle = isPulsing ? {
    animation: 'handle-pulse 0.6s ease-out'
  } : {}

  // 透明度：source 类型默认隐藏，hover 或 nearby 时显示
  const opacity = type === 'source'
    ? (showOnGroupHover || isNearby ? 1 : 0.6)
    : 1

  return (
    <div
      ref={handleRef}
      className="absolute flex items-center justify-center pointer-events-none"
      style={{
        // 根据 position 设置位置
        ...(position === Position.Left && { left: '-6px', top: '50%' }),
        ...(position === Position.Right && { right: '-6px', top: '50%' }),
        ...(position === Position.Top && { left: '50%', top: '-6px' }),
        ...(position === Position.Bottom && { left: '50%', bottom: '-6px' }),
        zIndex: 10
      }}
    >
      {/* 视觉点 - 放大和磁吸效果 */}
      <div
        className={cn(
          'rounded-full border-2 bg-background shadow-sm transition-colors duration-200',
          type === 'target'
            ? 'border-blue-400 bg-blue-50 hover:bg-blue-400'
            : 'border-green-400 bg-green-50 hover:bg-green-400',
          'pointer-events-auto cursor-crosshair'
        )}
        style={{
          ...dotStyle,
          ...pulseStyle,
          opacity
        }}
      />

      {/* ReactFlow Handle - 隐形但可交互，使用更大的 hit area */}
      <Handle
        type={type}
        position={position}
        id={id}
        className={cn(
          '!w-6 !h-6 !border-0 !bg-transparent',
          '!top-1/2 !-translate-y-1/2',
          className
        )}
        style={style}
      />
    </div>
  )
})

NodeHandle.displayName = 'NodeHandle'
