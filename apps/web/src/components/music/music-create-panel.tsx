'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Music, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { createMusicTrack } from '@/lib/music/api'
import { useAuthStore } from '@/stores/auth-store'
import type { MusicModel, MusicMode, MusicVoiceCloneResponse, MusicVoiceGender } from '@aigc/types'

const PROMPT_EXAMPLES = [
  '一首关于星空与思念的中文流行歌曲，旋律舒缓，充满情感',
  'An upbeat electronic dance track with futuristic synths',
  '轻快的儿童歌曲，关于春天和小动物，欢快可爱',
]

const STYLE_OPTIONS = ['流行', '摇滚', '古典', '电子', '乡村', '爵士', '嘻哈', '民谣', '节奏布鲁斯', 'R&B']

interface Props {
  voices: MusicVoiceCloneResponse[]
  onOpenVoiceDialog: () => void
  onCreated: () => void
}

function count(value: string) {
  return [...value].length
}

export function MusicCreatePanel({ voices, onOpenVoiceDialog, onCreated }: Props) {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [mode, setMode] = useState<MusicMode>('inspiration')
  const [instrumental, setInstrumental] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [customStyle, setCustomStyle] = useState('')
  const [styles, setStyles] = useState<string[]>(['流行'])
  const [voiceCloneId, setVoiceCloneId] = useState<string>('none')
  const [voiceGender, setVoiceGender] = useState<MusicVoiceGender>('auto')
  const [model, setModel] = useState<MusicModel>('mureka-9')
  const [submitting, setSubmitting] = useState(false)

  const readyVoices = useMemo(() => voices.filter((voice) => voice.status === 'ready'), [voices])

  function toggleStyle(style: string) {
    setStyles((current) => current.includes(style) ? current.filter((item) => item !== style) : [...current, style].slice(0, 12))
  }

  function addCustomStyle() {
    const value = customStyle.trim()
    if (!value) return
    if (count(value) > 24) {
      toast.error('单个风格不能超过 24 字')
      return
    }
    setStyles((current) => current.includes(value) ? current : [...current, value].slice(0, 12))
    setCustomStyle('')
  }

  async function submit() {
    if (!workspaceId || submitting) return
    if (mode === 'inspiration' && !prompt.trim()) {
      toast.error('请输入灵感提示词')
      return
    }
    if (mode === 'custom') {
      if (!title.trim()) return toast.error('请输入歌曲标题')
      if (count(title.trim()) > 20) return toast.error('标题不能超过 20 字')
      if (!lyrics.trim()) return toast.error('请输入歌词')
    }
    setSubmitting(true)
    try {
      await createMusicTrack({
        idempotency_key: `music_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        workspace_id: workspaceId,
        mode,
        track_type: mode === 'inspiration' && instrumental ? 'instrumental' : 'song',
        model,
        prompt: prompt.trim() || undefined,
        title: mode === 'custom' ? title.trim() : undefined,
        lyrics: mode === 'custom' ? lyrics.trim() : undefined,
        styles,
        voice_clone_id: voiceCloneId === 'none' ? null : voiceCloneId,
        voice_gender: voiceGender,
      })
      toast.success('音乐任务已提交')
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音乐任务提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Wand2 className="h-5 w-5" />
          <span className="text-sm font-medium">Toby AI Music</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">创造你的专属音乐</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          描述你想要的音乐风格、主题和情感，Toby AI 将为你创作独一无二的歌曲
        </p>
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
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 1024))} rows={7} />
              <div className="text-right text-xs text-muted-foreground">{count(prompt)} / 1024</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PROMPT_EXAMPLES.map((item) => (
                <Button key={item} type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={() => setPrompt(item)}>
                  {item}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label>歌曲标题</Label>
              <Input value={title} maxLength={20} onChange={(event) => setTitle(event.target.value)} />
              <div className="text-right text-xs text-muted-foreground">{count(title)} / 20</div>
            </div>
            <div className="space-y-2">
              <Label>歌词</Label>
              <Textarea value={lyrics} onChange={(event) => setLyrics(event.target.value.slice(0, 3000))} rows={9} />
              <div className="text-right text-xs text-muted-foreground">{count(lyrics)} / 3000</div>
            </div>
            <div className="space-y-3">
              <Label>风格</Label>
              <div className="flex flex-wrap gap-2">
                {STYLE_OPTIONS.map((style) => (
                  <Button key={style} type="button" size="sm" variant={styles.includes(style) ? 'default' : 'outline'} onClick={() => toggleStyle(style)}>
                    {style}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={customStyle} onChange={(event) => setCustomStyle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addCustomStyle())} />
                <Button type="button" variant="outline" onClick={addCustomStyle}>添加</Button>
              </div>
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label>我的音色</Label>
          <Select value={voiceCloneId} onValueChange={(value) => value === 'upload' ? onOpenVoiceDialog() : setVoiceCloneId(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不使用我的音色</SelectItem>
              {readyVoices.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>)}
              {readyVoices.length === 0 && <SelectItem value="upload">暂无音色，上传自己的音频文件生成音色</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>音色性别</Label>
          <Select value={voiceGender} onValueChange={(value) => setVoiceGender(value as MusicVoiceGender)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动</SelectItem>
              <SelectItem value="male">男声</SelectItem>
              <SelectItem value="female">女声</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label>生成模型</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['mureka-9', 'mureka-8'] as MusicModel[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setModel(item)}
                className={model === item ? 'rounded-lg border border-primary bg-primary/10 p-4 text-left' : 'rounded-lg border bg-background p-4 text-left hover:border-primary/60'}
              >
                <div className="flex items-center gap-2 font-medium"><Music className="h-4 w-4" />{item}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item === 'mureka-9' ? '质量优先，适合成品歌曲' : '速度更快，适合快速试作'}</div>
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" size="lg" onClick={submit} disabled={submitting || !workspaceId}>
          <Sparkles className="mr-2 h-4 w-4" />
          {submitting ? '提交中...' : mode === 'inspiration' && instrumental ? '生成纯音乐' : '生成歌曲'}
        </Button>
      </div>
    </section>
  )
}

