'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { ZoomIn, ZoomOut, X, ChevronLeft, ChevronRight } from 'lucide-react'

interface ImageLightboxProps {
  url: string
  alt?: string
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  footer?: React.ReactNode
}

interface Point {
  x: number
  y: number
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const ZOOM_STEP = 0.25
const ZERO_POINT: Point = { x: 0, y: 0 }

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

export function ImageLightbox({ url, alt = '', onClose, onPrev, onNext, footer }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState<Point>(ZERO_POINT)
  const [isDragging, setIsDragging] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef<Point | null>(null)
  const pointerIdRef = useRef<number | null>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const getBounds = useCallback((targetScale: number) => {
    const container = containerRef.current
    const img = imgRef.current
    if (!container || !img) return { maxX: 0, maxY: 0 }

    const containerRect = container.getBoundingClientRect()
    const baseWidth = img.offsetWidth
    const baseHeight = img.offsetHeight

    if (!baseWidth || !baseHeight) return { maxX: 0, maxY: 0 }

    const scaledWidth = baseWidth * targetScale
    const scaledHeight = baseHeight * targetScale

    return {
      maxX: Math.max(0, (scaledWidth - containerRect.width) / 2),
      maxY: Math.max(0, (scaledHeight - containerRect.height) / 2),
    }
  }, [])

  const clampTranslate = useCallback((point: Point, targetScale = scale) => {
    const { maxX, maxY } = getBounds(targetScale)
    return {
      x: Math.min(maxX, Math.max(-maxX, point.x)),
      y: Math.min(maxY, Math.max(-maxY, point.y)),
    }
  }, [getBounds, scale])

  const stopDragging = useCallback(() => {
    setIsDragging(false)
    dragStartRef.current = null
    pointerIdRef.current = null
  }, [])

  const zoom = useCallback((delta: number) => {
    setScale((s) => clampScale(Math.round((s + delta) * 100) / 100))
  }, [])

  // Reset view when image changes
  useEffect(() => {
    setScale(1)
    setTranslate(ZERO_POINT)
    stopDragging()
  }, [url, stopDragging])

  // Keep translate state valid for current scale
  useEffect(() => {
    if (scale <= 1) {
      setTranslate((prev) => (samePoint(prev, ZERO_POINT) ? prev : ZERO_POINT))
      stopDragging()
      return
    }

    setTranslate((prev) => {
      const next = clampTranslate(prev, scale)
      return samePoint(prev, next) ? prev : next
    })
  }, [scale, clampTranslate, stopDragging])

  // Re-clamp translate on viewport changes
  useEffect(() => {
    const onResize = () => {
      setTranslate((prev) => {
        const next = scale <= 1 ? ZERO_POINT : clampTranslate(prev, scale)
        return samePoint(prev, next) ? prev : next
      })
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scale, clampTranslate])

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      setScale((s) => clampScale(Math.round((s + delta) * 100) / 100))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keyboard: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return
    if (pointerIdRef.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    e.preventDefault()
    pointerIdRef.current = e.pointerId
    dragStartRef.current = {
      x: e.clientX - translate.x,
      y: e.clientY - translate.y,
    }

    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [scale, translate])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    if (pointerIdRef.current !== e.pointerId) return
    if (!dragStartRef.current) return

    e.preventDefault()
    const next = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    }

    setTranslate((prev) => {
      const clamped = clampTranslate(next)
      return samePoint(prev, clamped) ? prev : clamped
    })
  }, [isDragging, clampTranslate])

  const handlePointerUpOrCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    stopDragging()
  }, [stopDragging])

  const pct = Math.round(scale * 100)
  const cursor = scale <= 1 ? 'default' : (isDragging ? 'grabbing' : 'grab')

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 px-4 py-2 shrink-0">
        <button
          onClick={() => zoom(-ZOOM_STEP)}
          disabled={scale <= MIN_SCALE}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={() => setScale(1)}
          className="min-w-[52px] text-sm font-medium text-white/70 hover:text-white transition-colors"
          title="重置缩放"
        >
          {pct}%
        </button>
        <button
          onClick={() => zoom(ZOOM_STEP)}
          disabled={scale >= MAX_SCALE}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Image area with side nav arrows */}
      <div className="flex-1 relative flex items-center justify-center min-h-0">
        {/* Prev button */}
        {onPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev() }}
            className="absolute left-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <div
          ref={containerRef}
          className="flex-1 h-full overflow-hidden flex items-center justify-center"
          style={{ cursor, touchAction: scale > 1 ? 'none' : 'auto' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.15s ease',
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              display: 'block',
              transformOrigin: 'center center',
              userSelect: 'none',
            }}
            draggable={false}
            onLoad={() => {
              setTranslate((prev) => {
                const next = scale <= 1 ? ZERO_POINT : clampTranslate(prev, scale)
                return samePoint(prev, next) ? prev : next
              })
            }}
          />
        </div>

        {/* Next button */}
        {onNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext() }}
            className="absolute right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Optional footer */}
      {footer && (
        <div className="shrink-0 px-4 py-3 text-white/80 border-t border-white/10">
          {footer}
        </div>
      )}
    </div>
  )
}
