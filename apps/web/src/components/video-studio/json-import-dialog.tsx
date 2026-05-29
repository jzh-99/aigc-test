'use client'

import { useState } from 'react'
import { FileJson } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Props<T> {
  label?: string
  validate: (parsed: unknown) => T | null
  onImport: (data: T) => void
  hint?: string
}

export function JsonImportDialog<T>({ label = '导入 JSON', validate, onImport, hint }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const handleImport = () => {
    setError('')
    let parsed: unknown
    try {
      // strip markdown code fences if present
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      parsed = JSON.parse(stripped)
    } catch {
      setError('JSON 格式错误，请检查语法')
      return
    }
    const result = validate(parsed)
    if (!result) {
      setError('数据结构不符合要求，请对照提示检查字段')
      return
    }
    onImport(result)
    setOpen(false)
    setText('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setText(''); setError('') } }}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center justify-center gap-1.5 text-xs border border-dashed border-border py-2 rounded-lg text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
          <FileJson className="w-3.5 h-3.5" />
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {hint && (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{hint}</p>
          )}
          <textarea
            className="w-full h-64 p-3 text-xs font-mono bg-muted/50 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="粘贴 JSON 内容（支持 ```json 代码块格式）…"
            value={text}
            onChange={(e) => { setText(e.target.value); setError('') }}
            spellCheck={false}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="text-xs px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={!text.trim()}
              className="text-xs px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              导入
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
