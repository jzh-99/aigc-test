'use client'

import { useRef } from 'react'
import { Film, X } from 'lucide-react'
import Image from 'next/image'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { cn } from '@/lib/utils'
import type { FrameImage } from '../shared/types'

interface VideoFramesZoneProps {
  firstFrame: FrameImage | null
  lastFrame: FrameImage | null
  framePreviewIndex: 0 | 1 | null
  onFirstFrameChange: (img: FrameImage | null) => void
  onLastFrameChange: (img: FrameImage | null) => void
  onPreviewIndexChange: (idx: 0 | 1 | null) => void
  onFrameDrop: (e: React.DragEvent) => void
  onFileRead: (file: File) => Promise<FrameImage | null>
}

export function VideoFramesZone({
  firstFrame, lastFrame, framePreviewIndex,
  onFirstFrameChange, onLastFrameChange, onPreviewIndexChange,
  onFrameDrop, onFileRead,
}: VideoFramesZoneProps) {
  const firstFrameRef = useRef<HTMLInputElement>(null)
  const lastFrameRef = useRef<HTMLInputElement>(null)

  const frames = [firstFrame, lastFrame].filter(Boolean) as FrameImage[]
  const labels = firstFrame && lastFrame ? ['首帧图', '尾帧图'] : [firstFrame ? '首帧图' : '尾帧图']
  const activeIdx = framePreviewIndex === 1 && firstFrame ? 1 : 0

  return (
    <>
      <div className="flex gap-2 shrink-0">
        {/* 首帧 */}
        <div className="flex-1 flex flex-col gap-1">
          <p className="text-[11px] text-muted-foreground leading-none">首帧图（可选）</p>
          {firstFrame ? (
            <div className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group cursor-zoom-in" onClick={() => onPreviewIndexChange(0)}>
              <Image src={firstFrame.previewUrl} alt="" fill className="object-contain" sizes="200px" unoptimized />
              <button
                onClick={(e) => { e.stopPropagation(); onFirstFrameChange(null); onLastFrameChange(null) }}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
              ><X className="h-3 w-3 text-background" /></button>
            </div>
          ) : (
            <button
              onClick={() => firstFrameRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onFrameDrop}
              className="h-[90px] w-full rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1"
            >
              <Film className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">点击上传</span>
            </button>
          )}
        </div>

        {/* 尾帧 */}
        <div className="flex-1 flex flex-col gap-1">
          <p className="text-[11px] text-muted-foreground leading-none">尾帧图（可选）</p>
          {lastFrame ? (
            <div className="relative h-[90px] w-full rounded-lg overflow-hidden border bg-muted group cursor-zoom-in" onClick={() => onPreviewIndexChange(1)}>
              <Image src={lastFrame.previewUrl} alt="" fill className="object-contain" sizes="200px" unoptimized />
              <button
                onClick={(e) => { e.stopPropagation(); onLastFrameChange(null) }}
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground/60 hover:bg-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
              ><X className="h-3 w-3 text-background" /></button>
            </div>
          ) : (
            <button
              onClick={() => lastFrameRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onFrameDrop}
              disabled={!firstFrame}
              className={cn(
                'h-[90px] w-full rounded-lg border-2 border-dashed transition-all flex flex-col items-center justify-center gap-1',
                firstFrame ? 'border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 cursor-pointer' : 'border-muted-foreground/15 opacity-50 cursor-not-allowed'
              )}
            >
              <Film className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">点击上传</span>
            </button>
          )}
        </div>
      </div>

      <input ref={firstFrameRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) onFirstFrameChange(await onFileRead(f)); e.target.value = '' }} />
      <input ref={lastFrameRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) onLastFrameChange(await onFileRead(f)); e.target.value = '' }} />

      {framePreviewIndex !== null && frames[activeIdx] && (
        <ImageLightbox
          url={frames[activeIdx].previewUrl}
          alt={labels[activeIdx]}
          onClose={() => onPreviewIndexChange(null)}
          onPrev={activeIdx > 0 ? () => onPreviewIndexChange(0) : undefined}
          onNext={activeIdx < frames.length - 1 ? () => onPreviewIndexChange(1) : undefined}
          footer={<p className="text-sm text-white/80">{labels[activeIdx]}</p>}
        />
      )}
    </>
  )
}
