'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Radio, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useModels } from '@/hooks/use-models'
import { useMusicTrackEvents } from '@/hooks/use-music'
import { createMusicTrack } from '@/lib/music/api'
import { useAuthStore } from '@/stores/auth-store'
import { resolveMusicPricingKey, type MusicModel, type MusicMode, type MusicSseEvent, type MusicTrackResponse, type MusicTrackType, type MusicVoiceCloneResponse, type MusicVoiceGender } from '@aigc/types'

const PROMPT_EXAMPLES = [
  '一首关于星空与思念的中文流行歌曲，旋律舒缓，充满情感',
  'An upbeat electronic dance track with futuristic synths',
  '轻快的儿童歌曲，关于春天和小动物，欢快可爱',
]

const STYLE_OPTIONS = ['流行音乐', '摇滚音乐', '古典音乐', '电子音乐', '乡村音乐', '爵士', '嘻哈', '民谣', '节奏布鲁斯', '迪斯科']
const MAX_STYLE_COUNT = 10
const MODEL_OPTIONS: { value: MusicModel; label: string; description: string }[] = [
  { value: 'mureka-9', label: 'mureka-9', description: '质量优先，适合成品歌曲' },
  { value: 'mureka-8', label: 'mureka-8', description: '速度更快，适合快速试作' },
]

const MUSIC_PRICING_LABELS = {
  inspiration_song: '灵感模式生成歌曲',
  instrumental: '纯音乐',
  custom_song: '自定义模式生成歌曲',
} as const

interface Props {
  voices: MusicVoiceCloneResponse[]
  onOpenVoiceDialog: () => void
  onCreated: (track: MusicTrackResponse) => void
}

function count(value: string) {
  return [...value].length
}

export function MusicCreatePanel({ voices, onOpenVoiceDialog, onCreated }: Props) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const { models: musicModels, isLoading: musicModelsLoading } = useModels('music', workspaceId)
  const [mode, setMode] = useState<MusicMode>('inspiration')
  const [instrumental, setInstrumental] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [customStyle, setCustomStyle] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [voiceCloneId, setVoiceCloneId] = useState<string>('none')
  const [voiceGender, setVoiceGender] = useState<MusicVoiceGender>('auto')
  const [model, setModel] = useState<MusicModel>('mureka-9')
  const [submitting, setSubmitting] = useState(false)
  const [generatingTrackId, setGeneratingTrackId] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const isBusy = submitting || Boolean(generatingTrackId)

  const readyVoices = useMemo(() => voices.filter((voice) => voice.status === 'ready'), [voices])
  const trackType: MusicTrackType = mode === 'inspiration' && instrumental ? 'instrumental' : 'song'
  const pricingKey = resolveMusicPricingKey(mode, trackType)
  const musicPricingPreview = useMemo(() => {
    const selectedModel = musicModels.find((item) => item.code === model)
    const matchedRule = selectedModel?.params_pricing.find((rule) => rule.resolution === pricingKey)
    return matchedRule?.unit_price ?? null
  }, [model, musicModels, pricingKey])

  const handleTrackEvent = useCallback((event: MusicSseEvent) => {
    if (event.track) onCreated(event.track)
    if (event.event === 'completed') {
      setGeneratingTrackId(null)
    } else if (event.event === 'failed') {
      setGeneratingTrackId(null)
    }
  }, [onCreated])

  useMusicTrackEvents(generatingTrackId, handleTrackEvent)

  function toggleStyle(style: string) {
    setStyles((current) => current.includes(style) ? current.filter((item) => item !== style) : [...current, style].slice(0, MAX_STYLE_COUNT))
  }

  function addCustomStyle() {
    const value = customStyle.trim()
    if (!value) return
    if (count(value) > 24) {
      toast.error('单个风格不能超过 24 字')
      return
    }
    setStyles((current) => current.includes(value) ? current : [...current, value].slice(0, MAX_STYLE_COUNT))
    setCustomStyle('')
  }

  function removeStyle(style: string) {
    setStyles((current) => current.filter((item) => item !== style))
  }

  function selectVoiceClone(value: string) {
    setVoiceCloneId(value)
    if (value !== 'none') setVoiceGender('auto')
  }

  function selectVoiceGender(value: MusicVoiceGender) {
    setVoiceGender(value)
    if (value !== 'auto') setVoiceCloneId('none')
  }

  async function submit() {
    if (!workspaceId || isBusy || submittingRef.current) return
    if (mode === 'inspiration' && !prompt.trim()) {
      toast.error('请输入灵感提示词')
      return
    }
    if (mode === 'custom') {
      if (!title.trim()) return toast.error('请输入歌曲标题')
      if (count(title.trim()) > 20) return toast.error('标题不能超过 20 字')
      if (!lyrics.trim()) return toast.error('请输入歌词')
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = await createMusicTrack({
        idempotency_key: `music_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        workspace_id: workspaceId,
        mode,
        track_type: trackType,
        model,
        prompt: prompt.trim() || undefined,
        title: mode === 'custom' ? title.trim() : undefined,
        lyrics: mode === 'custom' ? lyrics.trim() : undefined,
        styles: mode === 'custom' ? styles : [],
        voice_clone_id: voiceCloneId !== 'none' ? voiceCloneId : null,
        voice_gender: voiceCloneId !== 'none' ? 'auto' : voiceGender,
      })
      toast.success('音乐任务已提交')
      if (response.track) {
        onCreated(response.track)
        setGeneratingTrackId(response.track.id)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音乐任务提交失败')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-[radial-gradient(circle_at_16%_12%,rgba(168,85,247,0.22),transparent_34%),linear-gradient(135deg,rgba(14,165,233,0.12),rgba(168,85,247,0.14)_45%,rgba(15,23,42,0.04))] p-5 shadow-[0_18px_60px_rgba(79,70,229,0.12)] dark:border-primary/35 dark:bg-[radial-gradient(circle_at_16%_12%,rgba(168,85,247,0.32),transparent_34%),linear-gradient(135deg,rgba(14,165,233,0.14),rgba(168,85,247,0.18)_48%,rgba(2,6,23,0.55))] dark:shadow-[0_22px_70px_rgba(124,58,237,0.22)]">
        <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full border border-primary/20 bg-primary/10 blur-sm" />
        <div className="pointer-events-none absolute bottom-3 right-5 hidden h-14 items-end gap-1 opacity-30 sm:flex">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className="w-1 rounded-full bg-primary" style={{ height: `${12 + ((index * 11) % 44)}px` }} />
          ))}
        </div>
        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-background/45 px-3 py-1 text-primary shadow-sm backdrop-blur dark:bg-background/20">
            <Radio className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">Toby AI Music</span>
          </div>
          <div className="flex items-end justify-between gap-4">
            <h1 className="max-w-[13em] text-3xl font-semibold tracking-normal text-foreground md:text-4xl">
              创造你的专属音乐
            </h1>
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-inner sm:flex">
              <Wand2 className="h-5 w-5" />
            </div>
          </div>
          <p className="max-w-[25rem] text-sm leading-6 text-muted-foreground">
            描述你想要的音乐风格、主题和情感，Toby AI 将为你创作独一无二的歌曲
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        <Button type="button" variant={mode === 'inspiration' ? 'default' : 'ghost'} onClick={() => setMode('inspiration')}>
          灵感模式
        </Button>
        <Button type="button" variant={mode === 'custom' ? 'default' : 'ghost'} onClick={() => setMode('custom')}>
          自定义模式
        </Button>
      </div>

      <div className="mt-5 space-y-5">
        {mode === 'inspiration' ? (
          <>
            <div className="flex items-center justify-between rounded-lg border px-3 py-3">
              <div>
                <div className="text-sm font-medium">纯音乐</div>
                <div className="text-xs text-muted-foreground">开启后不生成歌词</div>
              </div>
              <Switch checked={instrumental} onCheckedChange={setInstrumental} />
            </div>
            <div className="space-y-2">
              <Label>灵感提示词</Label>
              <Textarea
                value={prompt}
                placeholder="例如：一首关于星空与思念的中文流行歌曲，旋律舒缓，充满情感"
                onChange={(event) => setPrompt(event.target.value.slice(0, 1024))}
                rows={7}
              />
              <div className="text-right text-xs text-muted-foreground">{count(prompt)} / 1024</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROMPT_EXAMPLES.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal rounded-lg border-primary/25 bg-primary/8 px-3.5 py-2 text-left leading-5 text-foreground shadow-sm hover:border-primary/45 hover:bg-primary/14 dark:border-primary/35 dark:bg-primary/15 dark:hover:bg-primary/25"
                  onClick={() => setPrompt(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label>歌曲标题</Label>
              <Input
                value={title}
                maxLength={20}
                placeholder="请输入歌曲标题，例如：晚风、民谣"
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className="text-right text-xs text-muted-foreground">{count(title)} / 20</div>
            </div>
            <div className="space-y-2">
              <Label>歌词</Label>
              <Textarea
                value={lyrics}
                placeholder={'请输入完整歌词，可按段落换行\n例如：晚风轻轻吹过田野\n稻香飘散在每个角落'}
                onChange={(event) => setLyrics(event.target.value.slice(0, 3000))}
                rows={9}
              />
              <div className="text-right text-xs text-muted-foreground">{count(lyrics)} / 3000</div>
            </div>
            <div className="space-y-3">
              <Label>风格标签（可选，最多 10 个）</Label>
              <div className="rounded-xl border bg-card p-3 shadow-sm dark:border-[#4a3d91] dark:bg-[#0d0b24] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="mb-3 flex min-h-8 flex-wrap gap-2">
                  {styles.length ? styles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => removeStyle(style)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary hover:bg-primary/15 dark:border-[#6f5bff]/70 dark:bg-[#2a2360] dark:text-[#d9d3ff] dark:hover:border-[#9d8cff] dark:hover:bg-[#332a75]"
                    >
                      {style}
                      <X className="h-3.5 w-3.5 opacity-70" />
                    </button>
                  )) : (
                    <span className="flex h-9 items-center text-sm text-muted-foreground dark:text-[#8d86b9]">暂未选择风格标签</span>
                  )}
                </div>
                <Input
                  value={customStyle}
                  placeholder="支持自定义提示词标签后，按 Enter 添加"
                  onChange={(event) => setCustomStyle(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addCustomStyle())}
                  className="h-14 rounded-xl px-5 text-base dark:border-[#463a8a] dark:bg-[#151331] dark:text-[#f4f1ff] dark:placeholder:text-[#9f98c5] dark:focus-visible:ring-[#7565ff]"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {STYLE_OPTIONS.map((style) => {
                    const selected = styles.includes(style)
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() => toggleStyle(style)}
                        className={selected
                          ? 'h-9 rounded-full border border-primary bg-primary/12 px-4 text-sm text-foreground shadow-sm dark:border-[#7565ff] dark:bg-[#2a2360] dark:text-[#f4f1ff]'
                          : 'h-9 rounded-full border bg-background px-4 text-sm text-foreground transition-colors hover:border-primary hover:bg-accent dark:border-[#332c68] dark:bg-[#080719] dark:text-[#f4f1ff] dark:hover:border-[#7565ff] dark:hover:bg-[#171331]'
                        }
                      >
                        {style}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {!instrumental && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>我的音色</Label>
                <Button type="button" variant="outline" size="sm" onClick={onOpenVoiceDialog}>
                  <Upload className="mr-2 h-4 w-4" />
                  上传我的音色
                </Button>
              </div>
              <Select value={voiceCloneId} onValueChange={selectVoiceClone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不使用我的音色</SelectItem>
                  {readyVoices.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">选择具体音色后，音色性别将自动重置为"自动"。</p>
            </div>

            <div className="space-y-2">
              <Label>音色性别</Label>
              <Select value={voiceGender} onValueChange={(value) => selectVoiceGender(value as MusicVoiceGender)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="male">男声</SelectItem>
                  <SelectItem value="female">女声</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">选择男声或女声后，将不再使用我的音色。</p>
            </div>
          </>
        )}

        <div className="space-y-3">
          <Label>生成模型</Label>
          <Select value={model} onValueChange={(value) => setModel(value as MusicModel)}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="请选择生成模型" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label} · {item.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {MODEL_OPTIONS.find((item) => item.value === model)?.description}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm dark:border-primary/30 dark:bg-primary/10">
          <span className="text-muted-foreground">预计消耗</span>
          <span className="font-semibold text-foreground">
            {musicModelsLoading
              ? '价格加载中'
              : musicPricingPreview == null
                ? `${MUSIC_PRICING_LABELS[pricingKey]}价格未配置`
                : `${musicPricingPreview} A豆 · ${MUSIC_PRICING_LABELS[pricingKey]}`}
          </span>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={submit}
          disabled={isBusy || !workspaceId || (!musicModelsLoading && musicPricingPreview == null)}
          aria-busy={isBusy}
        >
          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {submitting ? '正在提交任务...' : generatingTrackId ? '正在生成音乐...' : mode === 'inspiration' && instrumental ? '生成纯音乐' : '生成歌曲'}
        </Button>
      </div>
    </section>
  )
}
