'use client'

import { useState } from 'react'
import type { PlanItem } from '@/lib/canvas/agent-types'

interface Props {
  items: PlanItem[]
  onConfirm: (selected: PlanItem[]) => void
  onModify: () => void
}

export function ConfirmPlanCard({ items, onConfirm, onModify }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.selected])),
  )

  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }))

  const selectedItems = items.filter((item) => checked[item.id])

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      <p className="text-foreground font-medium">我为你设计了以下方案，可以修改：</p>

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
          className="flex-1 text-xs border border-border rounded-md py-1.5 hover:bg-muted transition-colors"
        >
          修改方案
        </button>
        <button
          onClick={() => onConfirm(selectedItems)}
          disabled={selectedItems.length === 0}
          className="flex-1 text-xs bg-primary text-primary-foreground rounded-md py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          确认，选参数 →
        </button>
      </div>
    </div>
  )
}
