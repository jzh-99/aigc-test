'use client'

import { Textarea } from '@/components/ui/textarea'
import { DurationTag } from './duration-tag'
import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'

interface SegmentPromptEditorProps {
  segment: ShortDramaSegment
  assets: ShortDramaAsset[]
  onPromptChange: (prompt: string) => void
  onMentionRefsChange: (refs: ShortDramaMentionRef[]) => void
  onDurationChange: (duration: number) => void
  disabled?: boolean
}

export function SegmentPromptEditor({
  segment,
  assets,
  onPromptChange,
  onMentionRefsChange,
  onDurationChange,
  disabled,
}: SegmentPromptEditorProps) {
  const availableAssets = assets.filter(a => a.imageUrl)

  const handleAddMention = (asset: ShortDramaAsset) => {
    if (segment.mentionRefs.some(r => r.assetId === asset.id)) return
    onMentionRefsChange([...segment.mentionRefs, { assetId: asset.id, assetName: asset.name }])
  }

  const handleRemoveMention = (assetId: string) => {
    onMentionRefsChange(segment.mentionRefs.filter(r => r.assetId !== assetId))
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={segment.prompt}
        onChange={e => onPromptChange(e.target.value)}
        placeholder="描述这个分镜的画面内容..."
        className="min-h-[80px] text-sm resize-none"
        disabled={disabled}
      />

      <div className="flex flex-wrap gap-1.5">
        {segment.mentionRefs.map(ref => (
          <span
            key={ref.assetId}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full"
          >
            @{ref.assetName}
            {!disabled && (
              <button onClick={() => handleRemoveMention(ref.assetId)} className="hover:text-red-500">×</button>
            )}
          </span>
        ))}
        {!disabled && availableAssets.length > 0 && (
          <div className="relative group">
            <button className="px-2 py-0.5 text-xs bg-muted rounded-full hover:bg-muted/80">
              + 引用素材
            </button>
            <div className="absolute top-full left-0 mt-1 bg-popover border rounded-md shadow-md p-2 hidden group-hover:block z-10 min-w-[150px] max-h-[200px] overflow-y-auto">
              {availableAssets.map(asset => (
                <button
                  key={asset.id}
                  onClick={() => handleAddMention(asset)}
                  className="block w-full text-left px-2 py-1 text-xs hover:bg-muted rounded"
                >
                  {asset.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <DurationTag
        value={segment.durationSeconds}
        onChange={onDurationChange}
        disabled={disabled}
      />
    </div>
  )
}
