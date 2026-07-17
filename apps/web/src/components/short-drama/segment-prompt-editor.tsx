'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { ShortDramaSegment, ShortDramaAsset, ShortDramaMentionRef } from '@aigc/types'
import {
  SHORT_DRAMA_SHOT_DURATION_SECONDS,
  extractShortDramaShotDurations,
  findShortDramaMentionedAssets,
  getShortDramaAssetMentionAliases,
  normalizeShortDramaSegmentPrompt,
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
  const latestPromptRef = useRef(segment.prompt)

  // AI 生成的分镜脚本里分镜间分隔符不稳定（有时「。 分镜」有时「。分镜」），
  // 这里对外部传入的 prompt 做一次换行标准化，保证每个「分镜N」独占一行。
  // 仅对外部值标准化；用户在编辑器内的改动经 onChange 原样冒泡，不做二次处理。
  const prompt = useMemo(() => normalizeShortDramaSegmentPrompt(segment.prompt), [segment.prompt])

  useEffect(() => {
    latestPromptRef.current = prompt
  }, [prompt])

  const availableAssets = assets.filter(a => a.imageUrl)
  const mentionResources: StoryboardMentionResource[] = availableAssets.map(asset => ({
    id: asset.id,
    kind: asset.kind === 'character' ? 'character' : asset.kind === 'requisite' ? 'requisite' : 'background',
    name: asset.name,
    aliases: getShortDramaAssetMentionAliases(asset).filter(alias => alias !== asset.name),
    imageUrl: asset.imageUrl,
  }))

  const extractMentionRefs = (prompt: string): ShortDramaMentionRef[] => {
    const mentionedAssetIds = new Set<string>()
    const refs: ShortDramaMentionRef[] = []

    for (const asset of findShortDramaMentionedAssets(prompt, availableAssets)) {
      if (!mentionedAssetIds.has(asset.id)) {
        refs.push({ assetId: asset.id, assetName: asset.name })
        mentionedAssetIds.add(asset.id)
      }
    }

    return refs
  }

  const handlePromptChange = (prompt: string) => {
    latestPromptRef.current = prompt
    const refs = extractMentionRefs(prompt)
    if (onPromptAndMentionRefsChange) {
      onPromptAndMentionRefsChange(prompt, refs)
      return
    }
    onPromptChange(prompt)
    onMentionRefsChange(refs)
  }

  const shotDurations = extractShortDramaShotDurations(prompt)

  const handleShotDurationChange = (shotNumber: number, durationSeconds: number) => {
    const currentPrompt = latestPromptRef.current
    const nextPrompt = updateShortDramaShotDuration(currentPrompt, shotNumber, durationSeconds)
    if (nextPrompt === currentPrompt) return
    handlePromptChange(nextPrompt)
  }

  return (
    <div className="space-y-3">
      <StoryboardMentionEditor
        value={prompt}
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
