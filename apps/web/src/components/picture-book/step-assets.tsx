'use client'

import { useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PictureBookElement, PictureBookState } from '@/lib/picture-book/types'

export function StepAssets({
  state,
  onChange,
  onGeneratePrompts,
  onGenerateImages,
  loading,
}: {
  state: PictureBookState
  onChange: (state: PictureBookState) => void
  onGeneratePrompts: () => void
  onGenerateImages: () => void
  loading?: boolean
}) {
  const [tab, setTab] = useState<'characters' | 'backgrounds'>('characters')
  const items = state.assets[tab]
  const updateItem = (id: string, patch: Partial<PictureBookElement>) => {
    onChange({
      ...state,
      assets: {
        ...state.assets,
        [tab]: items.map((item) => item.id === id ? { ...item, ...patch } : item),
      },
    })
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">角色 / 背景</h2>
          <p className="mt-1 text-sm text-muted-foreground">只先生成提示词；用户编辑后批量生成图片，支持单卡重写提示词后重新生成。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onGeneratePrompts} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            提炼提示词
          </Button>
          <Button onClick={onGenerateImages} disabled={loading || !items.length}>
            <ImagePlus className="mr-2 h-4 w-4" />
            批量生成图片
          </Button>
        </div>
      </div>

      <div className="flex gap-6 border-b">
        <button className={tab === 'characters' ? 'border-b-2 border-primary pb-3 text-sm font-semibold' : 'pb-3 text-sm text-muted-foreground'} onClick={() => setTab('characters')}>全部角色 {state.assets.characters.length}</button>
        <button className={tab === 'backgrounds' ? 'border-b-2 border-primary pb-3 text-sm font-semibold' : 'pb-3 text-sm text-muted-foreground'} onClick={() => setTab('backgrounds')}>全部场景 {state.assets.backgrounds.length}</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[130px_1fr]">
            <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">未生成</div>
              )}
            </div>
            <div className="space-y-3">
              <input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} className="w-full bg-transparent text-base font-semibold outline-none" />
              <Textarea value={item.prompt} onChange={(event) => updateItem(item.id, { prompt: event.target.value })} className="min-h-36 resize-none text-sm" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
