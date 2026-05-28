'use client'

import { Loader2, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PictureBookState, PictureBookStoryboardPage } from '@/lib/picture-book/types'

export function StepStoryboard({
  state,
  onChange,
  onGeneratePrompts,
  onGenerateImages,
  onGenerateAudio,
  loading,
}: {
  state: PictureBookState
  onChange: (state: PictureBookState) => void
  onGeneratePrompts: () => void
  onGenerateImages: () => void
  onGenerateAudio: () => void
  loading?: boolean
}) {
  const updatePage = (pageNumber: number, patch: Partial<PictureBookStoryboardPage>) => {
    onChange({
      ...state,
      storyboard: state.storyboard.map((page) => page.page === pageNumber ? { ...page, ...patch } : page),
    })
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">绘本分镜</h2>
          <p className="mt-1 text-sm text-muted-foreground">每页先显示图片提示词和音频脚本文案；确认后批量生成图片和中英双语语音。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onGeneratePrompts} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
            生成分镜提示词
          </Button>
          <Button variant="outline" onClick={onGenerateImages} disabled={loading || !state.storyboard.length}>批量生成图片</Button>
          <Button onClick={onGenerateAudio} disabled={loading || !state.storyboard.length}>批量生成语音</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {state.storyboard.map((page) => (
          <div key={page.page} className="overflow-hidden rounded-lg border bg-card">
            <div className="aspect-[4/3] bg-muted">
              {page.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.imageUrl} alt={`Page ${page.page}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Page {page.page}</div>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div className="text-sm font-semibold text-primary">Page {String(page.page).padStart(2, '0')}</div>
              <Textarea value={page.prompt} onChange={(event) => updatePage(page.page, { prompt: event.target.value })} className="min-h-28 resize-none text-sm" placeholder="画面提示词" />
              <Textarea
                value={[page.script.narration.zh, page.script.dialogue.zh].filter(Boolean).join('\n')}
                readOnly
                className="min-h-20 resize-none text-sm"
                placeholder="中文语音脚本"
              />
              <Textarea
                value={[page.script.narration.en, page.script.dialogue.en].filter(Boolean).join('\n')}
                readOnly
                className="min-h-20 resize-none text-sm"
                placeholder="English audio script"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
