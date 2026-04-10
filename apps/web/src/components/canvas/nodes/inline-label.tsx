'use client'

import { useState, useRef, useEffect } from 'react'

interface InlineLabelProps {
  nodeId: string
  label: string
  onRename: (nodeId: string, newLabel: string) => void
  className?: string
}

export function InlineLabel({ nodeId, label, onRename, className }: InlineLabelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(label)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing, label])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label) onRename(nodeId, trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
          e.stopPropagation()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] font-semibold tracking-wide text-zinc-700 uppercase bg-white border border-blue-400 rounded px-1 outline-none w-full min-w-0"
      />
    )
  }

  return (
    <span
      className={className ?? 'text-[11px] font-semibold tracking-wide text-zinc-500 uppercase cursor-text select-none'}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
      title="双击重命名"
    >
      {label}
    </span>
  )
}
