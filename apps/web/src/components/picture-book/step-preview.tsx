'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { PictureBookState } from '@/lib/picture-book/types'
import { StoryboardAudioPlayer } from './storyboard-audio-player'

export function StepPreview({ state }: { state: PictureBookState }) {
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">预览与导出</h2>
          <p className="mt-1 text-sm text-muted-foreground">切换中英文查看文字和语音结果。</p>
        </div>
        <div className="inline-flex rounded-lg border p-1">
          <Button size="sm" variant={language === 'zh' ? 'default' : 'ghost'} onClick={() => setLanguage('zh')}>中文</Button>
          <Button size="sm" variant={language === 'en' ? 'default' : 'ghost'} onClick={() => setLanguage('en')}>English</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {state.storyboard.map((page) => {
          const audioUrl = page.voice?.[language]
          const pageText = [page.script.narration[language], page.script.dialogue[language]].filter(Boolean).join(' ')
          return (
            <div key={page.page} className="flex min-h-[508px] flex-col overflow-hidden rounded-lg border bg-card">
              <div className="aspect-[4/3] bg-muted">
                {page.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={page.imageUrl} alt={`Page ${page.page}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">未生成图片</div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="text-sm font-semibold">Page {String(page.page).padStart(2, '0')}</div>
                <p className="mt-3 line-clamp-4 min-h-24 text-sm leading-6 text-muted-foreground">
                  {pageText}
                </p>
                <div className="mt-auto pt-5">
                  {audioUrl ? (
                    <StoryboardAudioPlayer label={language === 'zh' ? '中文配音' : 'English voice'} src={audioUrl} variant="preview" />
                  ) : (
                    <div className="flex h-[66px] items-center justify-center rounded-xl border border-dashed bg-muted/30 text-xs text-muted-foreground">
                      未生成语音
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
