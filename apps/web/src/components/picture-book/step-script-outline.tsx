'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PictureBookState } from '@/lib/picture-book/types'

export function StepScriptOutline({ state, onChange }: { state: PictureBookState; onChange: (state: PictureBookState) => void }) {
  const [index, setIndex] = useState(0)
  const page = state.script.pages[index]

  const updatePage = (patch: Partial<typeof page>) => {
    onChange({
      ...state,
      script: {
        ...state.script,
        pages: state.script.pages.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
    })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">剧本摘要</h2>
        <Textarea
          value={state.script.summaryZh}
          onChange={(event) => onChange({ ...state, script: { ...state.script, summaryZh: event.target.value } })}
          className="mt-4 min-h-72 resize-none"
          placeholder="中文故事摘要"
        />
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">分页内容</h2>
            <p className="mt-1 text-sm text-muted-foreground">每页包含画面描述、中文台词/旁白、English narration/dialogue。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={() => setIndex(Math.min(state.script.pages.length - 1, index + 1))} disabled={index >= state.script.pages.length - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {page ? (
          <div className="mt-4 space-y-4">
            <div className="text-sm font-medium text-primary">Page {String(page.page).padStart(2, '0')}</div>
            <Textarea value={page.visualPrompt ?? ''} onChange={(event) => updatePage({ visualPrompt: event.target.value })} className="min-h-28 resize-none" placeholder="画面描述" />
            <Textarea value={page.narration.zh} onChange={(event) => updatePage({ narration: { ...page.narration, zh: event.target.value } })} className="min-h-20 resize-none" placeholder="中文旁白" />
            <Textarea value={page.narration.en} onChange={(event) => updatePage({ narration: { ...page.narration, en: event.target.value } })} className="min-h-20 resize-none" placeholder="English narration" />
            <Textarea value={page.dialogue.zh} onChange={(event) => updatePage({ dialogue: { ...page.dialogue, zh: event.target.value } })} className="min-h-20 resize-none" placeholder="中文台词" />
            <Textarea value={page.dialogue.en} onChange={(event) => updatePage({ dialogue: { ...page.dialogue, en: event.target.value } })} className="min-h-20 resize-none" placeholder="English dialogue" />
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">暂无分页内容</div>
        )}
      </section>
    </div>
  )
}
