'use client'

import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentPromptEditor } from './segment-prompt-editor'
import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'

interface SegmentListProps {
  segments: ShortDramaSegment[]
  assets: ShortDramaAsset[]
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
  onSegmentUpdate,
  onSegmentAdd,
  onSegmentDelete,
  onSegmentMove,
  onGenerateVideo,
  generatingSegmentId,
  disabled,
}: SegmentListProps) {
  return (
    <div className="space-y-3">
      {segments.map((segment, index) => (
        <div key={segment.id} className="p-4 rounded-lg border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              分镜 {index + 1}: {segment.title}
            </span>
            <div className="flex items-center gap-1">
              {!disabled && (
                <>
                  <button
                    onClick={() => onSegmentMove(index, index - 1)}
                    disabled={index === 0}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onSegmentMove(index, index + 1)}
                    disabled={index === segments.length - 1}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onSegmentDelete(index)}
                    className="p-1 hover:bg-red-50 text-red-500 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          <SegmentPromptEditor
            segment={segment}
            assets={assets}
            onPromptChange={prompt => onSegmentUpdate(index, { ...segment, prompt })}
            onMentionRefsChange={(refs: ShortDramaMentionRef[]) => onSegmentUpdate(index, { ...segment, mentionRefs: refs })}
            onDurationChange={d => onSegmentUpdate(index, { ...segment, durationSeconds: d })}
            disabled={disabled}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {segment.videoUrl ? (
                <span className="text-xs text-green-600">视频已生成</span>
              ) : segment.status === 'pending' || segment.status === 'generating' ? (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />生成中
                </span>
              ) : null}
            </div>
            {!segment.videoUrl && segment.status !== 'pending' && segment.status !== 'generating' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onGenerateVideo(segment.id)}
                disabled={!!generatingSegmentId || disabled}
              >
                {generatingSegmentId === segment.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : (
                  <Video className="w-3.5 h-3.5 mr-1" />
                )}
                生成视频
              </Button>
            )}
          </div>
        </div>
      ))}

      {!disabled && (
        <Button variant="outline" onClick={onSegmentAdd} className="w-full">
          <Plus className="w-4 h-4 mr-2" />
          添加分镜
        </Button>
      )}
    </div>
  )
}
