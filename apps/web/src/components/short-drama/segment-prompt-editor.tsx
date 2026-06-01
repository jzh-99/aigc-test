'use client'

import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'
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

  return (
    <div className="space-y-3">
      <StoryboardMentionEditor
        value={segment.prompt}
        onChange={handlePromptChange}
        resources={mentionResources}
        placeholder="描述这个分镜的画面内容..."
        disabled={disabled}
      />

    </div>
  )
}
