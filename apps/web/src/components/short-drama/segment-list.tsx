'use client'

import { Loader2, Plus, Trash2, ChevronLeft, ChevronRight, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentPromptEditor } from './segment-prompt-editor'
import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'

interface SegmentListProps {
  segments: ShortDramaSegment[]
  assets: ShortDramaAsset[]
  selectedIndex: number
  onSelectSegment: (index: number) => void
  onSegmentUpdate: (index: number, segment: ShortDramaSegment) => void
  onSegmentAdd: () => void
  onSegmentDelete: (index: number) => void
  onSegmentMove: (from: number, to: number) => void
  onGenerateVideo: (segmentId: string) => void
  generatingSegmentId: string | null
  disabled?: boolean
}

export function SegmentList({
  segments,
  assets,
  selectedIndex,
  onSelectSegment,
  onSegmentUpdate,
  onSegmentAdd,
  onSegmentDelete,
  onSegmentMove,
  onGenerateVideo,
  generatingSegmentId,
  disabled,
}: SegmentListProps) {
  const selectedSegment = segments[selectedIndex] ?? segments[0]
  const selectedSafeIndex = selectedSegment ? Math.max(0, segments.findIndex(segment => segment.id === selectedSegment.id)) : 0

  const getSegmentThumb = (segment: ShortDramaSegment): string | null => {
    const ref = segment.mentionRefs
      .map(item => assets.find(asset => asset.id === item.assetId && asset.imageUrl))
      .find(Boolean)
    return ref?.imageUrl ?? null
  }

  if (!selectedSegment) {
    return (
      <div className="rounded-2xl border bg-card/80 p-6 text-center">
        <p className="text-sm text-muted-foreground">暂无分镜</p>
        {!disabled && (
          <Button variant="outline" onClick={onSegmentAdd} className="mt-4">
            <Plus className="w-4 h-4 mr-2" />
            添加分镜
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">片段 {String(selectedSafeIndex + 1).padStart(2, '0')}</div>
            <h3 className="truncate text-lg font-semibold">{selectedSegment.title}</h3>
          </div>
          <div className="flex items-center gap-1">
            {!disabled && (
              <>
                <button
                  onClick={() => onSegmentMove(selectedSafeIndex, selectedSafeIndex - 1)}
                  disabled={selectedSafeIndex === 0}
                  className="flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  title="前移"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  前移
                </button>
                <button
                  onClick={() => onSegmentMove(selectedSafeIndex, selectedSafeIndex + 1)}
                  disabled={selectedSafeIndex === segments.length - 1}
                  className="flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  title="后移"
                >
                  后移
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onSegmentDelete(selectedSafeIndex)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
                  title="删除分镜"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <SegmentPromptEditor
          segment={selectedSegment}
          assets={assets}
          onPromptChange={prompt => onSegmentUpdate(selectedSafeIndex, { ...selectedSegment, prompt })}
          onMentionRefsChange={(refs: ShortDramaMentionRef[]) => onSegmentUpdate(selectedSafeIndex, { ...selectedSegment, mentionRefs: refs })}
          onPromptAndMentionRefsChange={(prompt: string, refs: ShortDramaMentionRef[]) =>
            onSegmentUpdate(selectedSafeIndex, { ...selectedSegment, prompt, mentionRefs: refs })
          }
          disabled={disabled}
        />

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {selectedSegment.videoUrl ? '视频已生成' : selectedSegment.status === 'pending' || selectedSegment.status === 'generating' ? (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <Loader2 className="w-3 h-3 animate-spin" />生成中
              </span>
            ) : `预计 ${selectedSegment.durationSeconds}s`}
          </div>
          {!selectedSegment.videoUrl && selectedSegment.status !== 'pending' && selectedSegment.status !== 'generating' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onGenerateVideo(selectedSegment.id)}
              disabled={!!generatingSegmentId || disabled}
            >
              {generatingSegmentId === selectedSegment.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Video className="w-3.5 h-3.5 mr-1" />
              )}
              生成视频
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card/80 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">分镜序列</span>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={onSegmentAdd} className="h-7 px-2 text-xs">
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加
            </Button>
          )}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {segments.map((segment, index) => {
            const thumb = getSegmentThumb(segment)
            const active = index === selectedSafeIndex
            return (
              <button
                key={segment.id}
                type="button"
                onClick={() => onSelectSegment(index)}
                className={`w-28 shrink-0 rounded-xl border p-1 text-left transition ${
                  active ? 'border-primary bg-primary/10' : 'bg-background/50 hover:border-primary/40'
                }`}
              >
                <div className="aspect-video overflow-hidden rounded-lg bg-muted">
                  {thumb ? (
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                      片段 {index + 1}
                    </div>
                  )}
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  片段 {String(index + 1).padStart(2, '0')} · {segment.durationSeconds}s
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
