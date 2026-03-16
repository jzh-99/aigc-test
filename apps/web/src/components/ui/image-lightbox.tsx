'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { ZoomIn, ZoomOut, X } from 'lucide-react'

interface ImageLightboxProps {
  url: string
  alt?: string
  onClose: () => void
  footer?: React.ReactNode
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const ZOOM_STEP = 0.25

export function ImageLightbox({ url, alt = '', onClose, footer }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const zoom = useCallback((delta: number) => {
    setScale((s) => clampScale(Math.round((s + delta) * 100) / 100))
  }, [])

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

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pct = Math.round(scale * 100)

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

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center cursor-zoom-in"
        style={{ cursor: scale >= MAX_SCALE ? 'zoom-out' : 'default' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          style={{
            transform: `scale(${scale})`,
            transition: 'transform 0.15s ease',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
          draggable={false}
        />
      </div>

      {/* Optional footer */}
      {footer && (
        <div className="shrink-0 px-4 py-3 text-white/80">
          {footer}
        </div>
      )}
    </div>
  )
}
