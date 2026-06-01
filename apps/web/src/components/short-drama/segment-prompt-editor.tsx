'use client'

import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'
import {
  SHORT_DRAMA_SHOT_DURATION_SECONDS,
  extractShortDramaShotDurations,
  updateShortDramaShotDuration,
} from '@aigc/types'
import {
  StoryboardMentionEditor,
  type StoryboardMentionResource,
} from '@/components/picture-book/storyboard-mention-editor'

interface SegmentPromptEditorProps {
  segment: ShortDramaSegment
  assets: ShortDramaAsset[]
  onPromptChange: (prompt: string) => void
  onMentionRefsChange: (refs: ShortDramaMentionRef[]) => void
  onPromptAndMentionRefsChange?: (prompt: string, refs: ShortDramaMentionRef[]) => void
  disabled?: boolean
}

export function SegmentPromptEditor({
  segment,
  assets,
  onPromptChange,
  onMentionRefsChange,
  onPromptAndMentionRefsChange,
  disabled,
}: SegmentPromptEditorProps) {
  const availableAssets = assets.filter(a => a.imageUrl)
  const mentionResources: StoryboardMentionResource[] = availableAssets.map(asset => ({
    id: asset.id,
    kind: asset.kind === 'character' ? 'character' : 'background',
    name: asset.name,
    imageUrl: asset.imageUrl,
  }))

  const extractMentionRefs = (prompt: string): ShortDramaMentionRef[] => {
    return availableAssets
      .filter(asset => prompt.includes(`@${asset.name}`))
      .map(asset => ({ assetId: asset.id, assetName: asset.name }))
  }

  const handlePromptChange = (prompt: string) => {
    const refs = extractMentionRefs(prompt)
    if (onPromptAndMentionRefsChange) {
      onPromptAndMentionRefsChange(prompt, refs)
      return
    }
    onPromptChange(prompt)
    onMentionRefsChange(refs)
  }

  const shotDurations = extractShortDramaShotDurations(segment.prompt)

  const handleShotDurationChange = (shotNumber: number, durationSeconds: number) => {
    const nextPrompt = updateShortDramaShotDuration(segment.prompt, shotNumber, durationSeconds)
    if (nextPrompt === segment.prompt) return
    handlePromptChange(nextPrompt)
  }

  return (
    <div className="space-y-3">
      <StoryboardMentionEditor
        value={segment.prompt}
        onChange={handlePromptChange}
        resources={mentionResources}
        placeholder="描述这个分镜的画面内容..."
        disabled={disabled}
      />

      {shotDurations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-background/40 p-2">
          <span className="text-xs text-muted-foreground">分镜时长</span>
          {shotDurations.map(shot => (
            <label
              key={shot.shotNumber}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"
            >
              <span>分镜{shot.shotNumber}</span>
              <select
                value={shot.durationSeconds}
                onChange={event => handleShotDurationChange(shot.shotNumber, Number(event.target.value))}
                disabled={disabled}
                className="bg-transparent text-xs outline-none disabled:cursor-not-allowed"
              >
                {SHORT_DRAMA_SHOT_DURATION_SECONDS.map(seconds => (
                  <option key={seconds} value={seconds}>
                    {seconds}s
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
