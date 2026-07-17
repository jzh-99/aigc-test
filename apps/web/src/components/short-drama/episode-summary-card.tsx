'use client'

import { useEffect, useState } from 'react'
import { Pencil, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ShortDramaEpisodeSummary, ShortDramaState } from '@aigc/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translateError } from '@/lib/error-messages'
import { saveShortDramaProject } from '@/lib/short-drama/api'

interface EpisodeSummaryCardProps {
  projectId: string
  episodeNumber: number
  summary: string
  canEdit: boolean
  state: ShortDramaState
  onStateChange: () => void
}

/**
 * 分集概述卡片，展示在每集剧本上方。
 * 剧本未生成时可编辑；父组件通过 canEdit 控制隐式锁定。
 */
export function EpisodeSummaryCard({
  projectId,
  episodeNumber,
  summary,
  canEdit,
  state,
  onStateChange,
}: EpisodeSummaryCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(summary)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!canEdit && editing) {
      setDraft(summary)
      setEditing(false)
    }
  }, [canEdit, editing, summary])

  const handleStartEdit = () => {
    if (!canEdit) return
    setDraft(summary)
    setEditing(true)
  }

  const handleCancel = () => {
    if (saving) return
    setDraft(summary)
    setEditing(false)
  }

  const handleSave = async () => {
    if (saving) return
    if (!canEdit) {
      setEditing(false)
      toast.error('分集剧本已生成，概述已锁定')
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.error('分集概述不能为空')
      return
    }

    const nextSummaries: ShortDramaEpisodeSummary[] = state.script.episodeSummaries.map(item =>
      item.episodeNumber === episodeNumber
        ? { ...item, summary: trimmed }
        : item
    )

    setSaving(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          script: {
            ...state.script,
            episodeSummaries: nextSummaries,
          },
        },
      })
      setEditing(false)
      onStateChange()
      toast.success('分集概述已保存')
    } catch (err) {
      toast.error(translateError(err instanceof Error ? err.message : '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-violet-300">分集概述</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={saving}
              title="取消编辑"
              aria-label="取消编辑分集概述"
              className="h-6 px-2 text-xs"
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleSave}
              disabled={saving || !draft.trim()}
              title="保存概述"
              aria-label="保存分集概述"
              className="h-6 px-2 text-xs"
            >
              {saving ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Save className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
        <Textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          className="min-h-[60px] resize-none rounded-md border-violet-500/30 bg-black/20 p-2 text-xs leading-5 text-foreground"
          autoFocus
          disabled={saving}
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-violet-300">分集概述</span>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleStartEdit}
            title="编辑概述"
            aria-label="编辑分集概述"
            className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
        {summary || '（待生成）'}
      </p>
    </div>
  )
}
