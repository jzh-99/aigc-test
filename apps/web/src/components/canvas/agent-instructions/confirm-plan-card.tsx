'use client'

import { useState } from 'react'
import { Zap, Clock } from 'lucide-react'
import type { PlanItem } from '@/lib/canvas/agent-types'

interface Props {
  summary?: string
  estimatedCredits?: number
  estimatedMinutes?: number
  items: PlanItem[]
  onConfirm: (selected: PlanItem[]) => void
  onModify: () => void
  onAutorun?: (selected: PlanItem[]) => void
}

export function ConfirmPlanCard({ summary, estimatedCredits, estimatedMinutes, items, onConfirm, onModify, onAutorun }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.selected])),
  )

  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }))
  const selectedItems = items.filter((item) => checked[item.id])

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      {summary && (
        <p className="text-foreground font-medium">{summary}</p>
      )}

      {(estimatedCredits || estimatedMinutes) && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {estimatedCredits ? (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              约 {estimatedCredits} 积分
            </span>
          ) : null}
          {estimatedMinutes ? (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              约 {estimatedMinutes} 分钟
            </span>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {items.map((item) => (
          <label key={item.id} className="flex items-start gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked[item.id] ?? false}
              onChange={() => toggle(item.id)}
              className="mt-0.5 shrink-0 accent-primary"
            />
            <div>
              <span className="text-foreground">{item.label}</span>
              {item.description && (
                <p className="text-xs text-muted-foreground">{item.description}</p>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onModify}
          className="text-xs border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
        >
          修改方案
        </button>
        <button
          onClick={() => onConfirm(selectedItems)}
          disabled={selectedItems.length === 0}
          className="flex-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-md py-1.5 hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          逐步确认
        </button>
        {onAutorun && (
          <button
            onClick={() => onAutorun(selectedItems)}
            disabled={selectedItems.length === 0}
            className="flex-1 text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            直接跑完 →
          </button>
        )}
      </div>
    </div>
  )
}
