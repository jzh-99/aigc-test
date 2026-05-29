'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PictureBookState } from '@/lib/picture-book/types'

function chineseOnlyText(value: string | undefined): string {
  const text = value ?? ''
  if (!/[\u4e00-\u9fff]/.test(text)) return ''
  return text
    .split('\n')
    .filter(line => /[\u4e00-\u9fff]/.test(line))
    .join('\n')
}

export function StepScriptOutline({ state, onChange, locked = false }: { state: PictureBookState; onChange: (state: PictureBookState) => void; locked?: boolean }) {
  const [index, setIndex] = useState(0)
  const [narrationLang, setNarrationLang] = useState<'zh' | 'en'>('zh')
  const page = state.script.pages[index]

  const updatePage = (patch: Partial<typeof page>) => {
    if (locked) return
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
        <h2 className="text-lg font-semibold">完整故事</h2>
        <Textarea
          value={state.script.summaryZh}
          onChange={(event) => {
            if (!locked) onChange({ ...state, script: { ...state.script, summaryZh: event.target.value } })
          }}
          readOnly={locked}
          className="mt-4 min-h-72 resize-none"
          placeholder="中文完整故事"
        />
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">分页内容</h2>
            <p className="mt-1 text-sm text-muted-foreground">每页分为环境描述和本页剧情，以及支持中英文切换的旁白。</p>
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
            <div className="space-y-2">
              <div className="text-sm font-semibold">环境描述和本页剧情</div>
              <Textarea
                value={chineseOnlyText(page.visualPrompt)}
                onChange={(event) => updatePage({ visualPrompt: event.target.value })}
                readOnly={locked}
                className="min-h-32 resize-none"
                placeholder="环境描述和本页剧情"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">旁白</div>
                <div className="inline-flex rounded-lg border bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setNarrationLang('zh')}
                    className={narrationLang === 'zh' ? 'rounded-md bg-background px-3 py-1 text-xs font-semibold text-foreground shadow-sm' : 'px-3 py-1 text-xs text-muted-foreground'}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    onClick={() => setNarrationLang('en')}
                    className={narrationLang === 'en' ? 'rounded-md bg-background px-3 py-1 text-xs font-semibold text-foreground shadow-sm' : 'px-3 py-1 text-xs text-muted-foreground'}
                  >
                    English
                  </button>
                </div>
              </div>
              <Textarea
                value={page.narration[narrationLang]}
                onChange={(event) => updatePage({ narration: { ...page.narration, [narrationLang]: event.target.value } })}
                readOnly={locked}
                className="min-h-28 resize-none"
                placeholder={narrationLang === 'zh' ? '中文旁白' : 'English narration'}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">暂无分页内容</div>
        )}
      </section>
    </div>
  )
}
