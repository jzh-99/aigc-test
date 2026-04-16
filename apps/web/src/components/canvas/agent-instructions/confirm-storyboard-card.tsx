'use client'

import { useState } from 'react'
import type { StoryboardItem } from '@/lib/canvas/agent-types'

interface Props {
  items: StoryboardItem[]
  onConfirm: (items: StoryboardItem[]) => void
  onModify: () => void
}

export function ConfirmStoryboardCard({ items, onConfirm, onModify }: Props) {
  const [drafts, setDrafts] = useState<StoryboardItem[]>(items)

  const update = (id: string, content: string) =>
    setDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)))

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      <p className="text-foreground font-medium">分镜文案草稿，可直接编辑后确认：</p>

      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {drafts.map((item) => (
          <div key={item.id} className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
            <textarea
              value={item.content}
              onChange={(e) => update(item.id, e.target.value)}
              rows={4}
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 resize-y outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onModify}
          className="flex-1 text-xs border border-border rounded-md py-1.5 hover:bg-muted transition-colors"
        >
          重新规划
        </button>
        <button
          onClick={() => onConfirm(drafts)}
          className="flex-1 text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors"
        >
          确认，写入节点 →
        </button>
      </div>
    </div>
  )
}
