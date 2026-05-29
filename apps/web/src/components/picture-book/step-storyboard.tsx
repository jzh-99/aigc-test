'use client'

import { useMemo, useState } from 'react'
import { ImagePlus, Loader2, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PictureBookState, PictureBookStoryboardPage } from '@/lib/picture-book/types'
import { StoryboardAudioPlayer } from './storyboard-audio-player'
import { StoryboardAudioDialog } from './storyboard-audio-dialog'
import { StoryboardMentionEditor, type StoryboardMentionResource } from './storyboard-mention-editor'

const ASPECT_RATIO_CLASS: Record<string, string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
}

function getImageStatusText(page: PictureBookStoryboardPage, imageGenerating: boolean): string {
  if (imageGenerating) return '生成中'
  if (page.imageUrl) return '已生成'
  return '未生成'
}

function getStoryboardStatusText(page: PictureBookStoryboardPage, imageGenerating: boolean, audioGenerating: boolean): string {
  const imageText = imageGenerating ? '图片生成中' : page.imageUrl ? '图片已生成' : '图片未生成'
  const audioText = audioGenerating ? '语音生成中' : page.voice.zh && page.voice.en ? '语音已生成' : '语音未完成'
  return `${imageText} · ${audioText}`
}

export function StepStoryboard({
  state,
  onChange,
  onGenerateImages,
  onGenerateAudio,
  onGenerateOneImage,
  onGenerateOneAudio,
  loading,
  generatingImageIds = [],
  generatingAudioIds = [],
}: {
  state: PictureBookState
  onChange: (state: PictureBookState) => void
  onGenerateImages: () => void
  onGenerateAudio: (voiceZhId: string, voiceEnId: string) => void
  onGenerateOneImage: (refId: string) => void
  onGenerateOneAudio: (refId: string, voiceZhId: string, voiceEnId: string) => void
  loading?: boolean
  generatingImageIds?: string[]
  generatingAudioIds?: string[]
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [audioDialogOpen, setAudioDialogOpen] = useState(false)
  const [audioDialogRefId, setAudioDialogRefId] = useState<string | null>(null)
  const aspectClass = ASPECT_RATIO_CLASS[state.settings?.aspectRatio ?? '16:9'] ?? 'aspect-video'

  const mentionResources = useMemo<StoryboardMentionResource[]>(() => [
    ...state.assets.characters.map(item => ({ id: item.id, kind: 'character' as const, name: item.name, imageUrl: item.imageUrl })),
    ...state.assets.backgrounds.map(item => ({ id: item.id, kind: 'background' as const, name: item.name, imageUrl: item.imageUrl })),
  ], [state.assets.backgrounds, state.assets.characters])

  const totalPages = state.storyboard.length
  const imagesDone = state.storyboard.filter(p =>
    p.imageUrl && !generatingImageIds.includes(`page_${p.page}`) && p.status !== 'pending' && p.status !== 'processing',
  ).length
  const audioDone = state.storyboard.filter(p =>
    p.voice.zh && p.voice.en && !generatingAudioIds.includes(`page_${p.page}`),
  ).length

  const updatePage = (pageNumber: number, patch: Partial<PictureBookStoryboardPage>) => {
    onChange({
      ...state,
      storyboard: state.storyboard.map((page) => page.page === pageNumber ? { ...page, ...patch } : page),
    })
  }

  const updateNarration = (pageNumber: number, language: 'zh' | 'en', value: string) => {
    onChange({
      ...state,
      storyboard: state.storyboard.map((page) => page.page === pageNumber
        ? {
            ...page,
            script: {
              ...page.script,
              narration: {
                ...page.script.narration,
                [language]: value,
              },
            },
          }
        : page),
    })
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">绘本分镜</h2>
          <p className="mt-1 text-sm text-muted-foreground">每页确认画面提示词、旁白和双语语音后，再进入预览导出。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onGenerateImages} disabled={generatingImageIds.length > 0 || !state.storyboard.length}>
            {generatingImageIds.length > 0 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            批量生成图片
          </Button>
          <Button onClick={() => { setAudioDialogRefId(null); setAudioDialogOpen(true) }} disabled={generatingAudioIds.length > 0 || !state.storyboard.length}>
            {generatingAudioIds.length > 0 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
            批量生成语音
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        图片进度：{imagesDone}/{totalPages} · 语音进度：{audioDone}/{totalPages}
      </div>

      <div className="space-y-4">
        {state.storyboard.map((page) => {
          const refId = `page_${page.page}`
          const imageGenerating = generatingImageIds.includes(refId) || (page.status === 'pending' || page.status === 'processing')
          const audioGenerating = generatingAudioIds.includes(refId)

          return (
            <article key={page.page} className="overflow-hidden rounded-lg border bg-card">
              <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="bg-muted/30">
                  <div className={`relative bg-muted ${aspectClass}`}>
                    <div className="absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                      {String(page.page).padStart(2, '0')}
                    </div>
                    <div className="absolute bottom-2 right-2 z-10 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
                      {getImageStatusText(page, imageGenerating)}
                    </div>

                    {page.imageUrl ? (
                      <img
                        src={page.imageUrl}
                        alt={`Page ${page.page}`}
                        className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
                        onClick={() => setPreviewUrl(page.imageUrl ?? null)}
                      />
                    ) : imageGenerating ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-primary">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        生成中
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Page {page.page}</div>
                    )}

                    {page.imageUrl && imageGenerating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-xs text-primary backdrop-blur-sm">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        重新生成中
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2 border-t bg-card p-3">
                    <StoryboardAudioPlayer label="中" src={page.voice.zh} loading={audioGenerating && !page.voice.zh} />
                    <StoryboardAudioPlayer label="EN" src={page.voice.en} loading={audioGenerating && !page.voice.en} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t bg-card p-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onGenerateOneImage(refId)}
                      disabled={loading || imageGenerating || !page.prompt.trim()}
                    >
                      {imageGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                      {page.imageUrl ? '重新生成图' : '生成图片'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setAudioDialogRefId(refId); setAudioDialogOpen(true) }}
                      disabled={loading || audioGenerating}
                    >
                      {audioGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Volume2 className="mr-2 h-4 w-4" />}
                      {page.voice.zh || page.voice.en ? '重新生成音' : '生成语音'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-primary">Page {String(page.page).padStart(2, '0')}</div>
                    <div className="text-xs text-muted-foreground">
                      {getStoryboardStatusText(page, imageGenerating, audioGenerating)}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">画面提示词</div>
                    <StoryboardMentionEditor
                      value={page.prompt}
                      resources={mentionResources}
                      placeholder="输入画面提示词，使用 @ 引用角色或背景"
                      onChange={(value) => updatePage(page.page, { prompt: value })}
                    />
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">中文旁白</div>
                      <Textarea
                        value={page.script.narration.zh}
                        onChange={(event) => updateNarration(page.page, 'zh', event.target.value)}
                        className="min-h-28 resize-none text-sm"
                        placeholder="中文旁白"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">English Narration</div>
                      <Textarea
                        value={page.script.narration.en}
                        onChange={(event) => updateNarration(page.page, 'en', event.target.value)}
                        className="min-h-28 resize-none text-sm"
                        placeholder="English narration"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            aria-label="关闭预览"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setPreviewUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewUrl}
            alt="预览"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      <StoryboardAudioDialog
        open={audioDialogOpen}
        voiceZhId={state.settings?.voiceZhId}
        voiceEnId={state.settings?.voiceEnId}
        loading={Boolean(loading)}
        onClose={() => setAudioDialogOpen(false)}
        onConfirm={(voiceZhId, voiceEnId) => {
          setAudioDialogOpen(false)
          if (audioDialogRefId) {
            onGenerateOneAudio(audioDialogRefId, voiceZhId, voiceEnId)
          } else {
            onGenerateAudio(voiceZhId, voiceEnId)
          }
        }}
      />
    </section>
  )
}
