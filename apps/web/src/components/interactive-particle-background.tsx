'use client'

import React, { useEffect, useRef, useState } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  color: string
}

interface MagneticButtonProps {
  x: number
  y: number
  targetX: number
  targetY: number
  strength: number
}

const ParticleBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [buttonPos, setButtonPos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const [isButtonActive, setIsButtonActive] = useState(false)

  // 粒子系统参数
  const particlesRef = useRef<Particle[]>([])
  const particleCount = 80 // @adjustable: 粒子数量
  const attractionRadius = 150 // @adjustable: 鼠标影响半径
  const friction = 0.95 // @adjustable: 摩擦系数

  // 磁吸按钮参数
  const magneticStrength = 0.08 // @adjustable: 磁吸强度
  const buttonSize = 60 // @adjustable: 按钮大小

  // 初始化粒子
  const initParticles = () => {
    const particles: Particle[] = []
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.8 + 0.2,
        color: '#ffffff'
      })
    }
    particlesRef.current = particles
  }

  // 根据鼠标位置计算颜色
  const getMouseColor = (mouseX: number, mouseY: number): string => {
    const hue = (mouseX / window.innerWidth) * 360
    const saturation = 70 + (mouseY / window.innerHeight) * 30
    const lightness = 50 + (mouseY / window.innerHeight) * 20
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  }

  // 磁吸物理计算
  const applyMagneticForce = (buttonX: number, buttonY: number, mouseX: number, mouseY: number): MagneticButtonProps => {
    const dx = mouseX - buttonX
    const dy = mouseY - buttonY
    const distance = Math.sqrt(dx * dx + dy * dy)

    // 计算磁吸力（只在一定距离内生效）
    let targetX = buttonX
    let targetY = buttonY
    let strength = 0

    if (distance < 200) { // @adjustable: 磁吸触发距离
      const force = Math.max(0, 1 - distance / 200)
      strength = force * magneticStrength

      // 磁吸力方向指向鼠标，但有一个最大偏移限制
      const maxOffset = 30 // @adjustable: 最大偏移距离
      targetX = buttonX + (dx / distance) * Math.min(maxOffset, force * maxOffset)
      targetY = buttonY + (dy / distance) * Math.min(maxOffset, force * maxOffset)
    }

    return { x: buttonX, y: buttonY, targetX, targetY, strength }
  }

  // 动画循环
  const animate = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 调整画布大小
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // 清空画布
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const mouseX = mousePos.x
    const mouseY = mousePos.y
    const mouseColor = getMouseColor(mouseX, mouseY)

    // 更新和绘制粒子
    particlesRef.current.forEach((particle, index) => {
      // 计算与鼠标的距离
      const dx = mouseX - particle.x
      const dy = mouseY - particle.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // 鼠标吸引力
      if (distance < attractionRadius) {
        const force = (1 - distance / attractionRadius) * 0.5
        particle.vx += (dx / distance) * force
        particle.vy += (dy / distance) * force

        // 根据距离鼠标的远近调整颜色
        const colorInfluence = 1 - distance / attractionRadius
        const baseColor = mouseColor.match(/\d+/g)
        if (baseColor) {
          const [h, s, l] = baseColor
          particle.color = `hsla(${h}, ${s}%, ${l}%, ${particle.opacity * colorInfluence})`
        }
      }

      // 应用摩擦力
      particle.vx *= friction
      particle.vy *= friction

      // 更新位置
      particle.x += particle.vx
      particle.y += particle.vy

      // 边界反弹
      if (particle.x < 0 || particle.x > canvas.width) {
        particle.vx *= -0.8
        particle.x = Math.max(0, Math.min(canvas.width, particle.x))
      }
      if (particle.y < 0 || particle.y > canvas.height) {
        particle.vy *= -0.8
        particle.y = Math.max(0, Math.min(canvas.height, particle.y))
      }

      // 绘制粒子
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
      ctx.fillStyle = particle.color
      ctx.fill()

      // 粒子间连线（距离较近时）
      for (let j = index + 1; j < particlesRef.current.length; j++) {
        const other = particlesRef.current[j]
        const dx2 = particle.x - other.x
        const dy2 = particle.y - other.y
        const distance2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

        if (distance2 < 100) { // @adjustable: 连线距离阈值
          ctx.beginPath()
          ctx.moveTo(particle.x, particle.y)
          ctx.lineTo(other.x, other.y)
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * (1 - distance2 / 100)})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      }
    })

    // 磁吸按钮动画
    const magneticResult = applyMagneticForce(
      buttonPos.x,
      buttonPos.y,
      mouseX,
      mouseY
    )

    // 使用 lerp (线性插值) 实现平滑的磁吸效果
    const lerpFactor = 0.2 // @adjustable: 平滑度
    const newX = magneticResult.x + (magneticResult.targetX - magneticResult.x) * lerpFactor
    const newY = magneticResult.y + (magneticResult.targetY - magneticResult.y) * lerpFactor

    setButtonPos({ x: newX, y: newY })
    setIsButtonActive(magneticResult.strength > 0.01)

    // 绘制磁吸按钮
    const gradient = ctx.createRadialGradient(newX, newY, 0, newX, newY, buttonSize / 2)
    gradient.addColorStop(0, isButtonActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.7)')
    gradient.addColorStop(1, isButtonActive ? 'rgba(100, 200, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)')

    ctx.beginPath()
    ctx.arc(newX, newY, buttonSize / 2, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()

    // 按钮边框
    ctx.beginPath()
    ctx.arc(newX, newY, buttonSize / 2, 0, Math.PI * 2)
    ctx.strokeStyle = isButtonActive ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)'
    ctx.lineWidth = 2
    ctx.stroke()

    // 按钮内部图标
    ctx.fillStyle = isButtonActive ? '#1e40af' : '#374151'
    ctx.beginPath()
    ctx.arc(newX, newY, buttonSize / 4, 0, Math.PI * 2)
    ctx.fill()

    requestAnimationFrame(animate)
  }

  // 事件处理
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    const handleResize = () => {
      initParticles()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('resize', handleResize)

    initParticles()
    animate()

    // 支持减少动画偏好
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleReducedMotion = () => {
      if (mediaQuery.matches) {
        // 减少动画效果
        particlesRef.current = particlesRef.current.map(p => ({
          ...p,
          vx: 0,
          vy: 0
        }))
      }
    }

    handleReducedMotion()
    mediaQuery.addEventListener('change', handleReducedMotion)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', handleResize)
      mediaQuery.removeEventListener('change', handleReducedMotion)
    }
  }, [])

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center, #0f172a 0%, #000000 100%)'
        }}
      />
    </div>
  )
}

export default ParticleBackground