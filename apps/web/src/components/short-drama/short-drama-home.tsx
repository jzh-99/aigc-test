'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { SHORT_DRAMA_ASPECT_RATIOS, SHORT_DRAMA_EPISODE_COUNTS, SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT } from '@aigc/types'
import type { ShortDramaAspectRatio } from '@aigc/types'
import { ShortDramaStyleDialog } from './short-drama-style-dialog'
import { ShortDramaProjectCard } from './short-drama-project-card'
import { StudioReturnBar } from '@/components/toby-studio/studio-return-bar'
import {
  createShortDramaProject,
  listRecentShortDramaProjects,
  type ShortDramaProjectListItem,
} from '@/lib/short-drama/api'

type DramaSelectOption<T extends string | number> = {
  value: T
  label: string
}

export function ShortDramaHome() {
  const router = useRouter()
  const workspaceId = useAuthStore(s => s.activeWorkspaceId)

  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('真人都市')
  const [aspectRatio, setAspectRatio] = useState<ShortDramaAspectRatio>('9:16')
  const [episodeCount, setEpisodeCount] = useState(10)
  const [episodeInput, setEpisodeInput] = useState('10')
  const [submitting, setSubmitting] = useState(false)
  const parsedEpisodeCount = Number(episodeInput)
  const isEpisodeCountValid =
    Number.isInteger(parsedEpisodeCount) &&
    parsedEpisodeCount > 0 &&
    parsedEpisodeCount <= SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT

  const { data: recentProjects, isLoading: loadingProjects } = useSWR<ShortDramaProjectListItem[]>(
    workspaceId ? ['short-drama-recent', workspaceId] : null,
    () => listRecentShortDramaProjects(workspaceId!),
    { revalidateOnFocus: true }
  )

  const handleSubmit = async () => {
    if (!prompt.trim() || !workspaceId) return
    if (!isEpisodeCountValid) {
      toast.error(`集数需为 1-${SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT} 的整数`)
      return
    }
    setSubmitting(true)
    try {
      const result = await createShortDramaProject({
        workspaceId,
        prompt: prompt.trim(),
        style,
        aspectRatio,
        episodeCount: parsedEpisodeCount,
      })
      toast.success('项目创建成功')
      router.push(`/toby-studio/short-drama/${result.projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEpisodeInputChange = (value: string) => {
    const normalized = value.replace(/\D/g, '')
    setEpisodeInput(normalized)
    const nextCount = Number(normalized)
    if (
      Number.isInteger(nextCount) &&
      nextCount > 0 &&
      nextCount <= SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT
    ) {
      setEpisodeCount(nextCount)
    }
  }

  const handleEpisodePresetChange = (value: string) => {
    const nextCount = Number(value)
    setEpisodeCount(nextCount)
    setEpisodeInput(value)
  }

  const handleEpisodeInputBlur = () => {
    if (!episodeInput) {
      setEpisodeInput(String(episodeCount))
    }
  }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <StudioReturnBar />
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">AI 短剧</h1>
          <p className="text-muted-foreground mt-1">输入创意，AI 帮你生成完整短剧</p>
        </div>

        <div className="space-y-4 p-6 rounded-xl border bg-card">
          <Textarea
            placeholder="描述你的短剧创意，例如：一个普通外卖员意外获得超能力，在都市中行侠仗义的故事..."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="min-h-[120px] resize-none"
            maxLength={2000}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">视觉风格</label>
              <ShortDramaStyleDialog value={style} onChange={setStyle}>
                <button
                  type="button"
                  className="group flex h-11 w-full items-center justify-between rounded-full border border-transparent bg-[#f6f4f8] px-4 text-left text-sm font-semibold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(70,56,98,0.08)] transition-all hover:bg-white hover:shadow-[0_16px_34px_rgba(70,56,98,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
                >
                  <span className="truncate">{style || '选择风格'}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:-rotate-180" />
                </button>
              </ShortDramaStyleDialog>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">画面比例</label>
              <DramaPillSelect
                value={aspectRatio}
                options={SHORT_DRAMA_ASPECT_RATIOS.map(r => ({ value: r, label: r }))}
                onChange={value => setAspectRatio(value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">集数</label>
              <EpisodeCountSelect
                value={episodeCount}
                inputValue={episodeInput}
                valid={isEpisodeCountValid}
                onPresetChange={handleEpisodePresetChange}
                onInputChange={handleEpisodeInputChange}
                onInputBlur={handleEpisodeInputBlur}
              />
              {episodeInput && !isEpisodeCountValid && (
                <p className="text-xs text-red-500">
                  请输入 1-{SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT} 的整数
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              创建项目后将消耗少量积分用于 AI 文本生成
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting || !workspaceId || !isEpisodeCountValid}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />创建中...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />开始创作</>
              )}
            </Button>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">最近项目</h2>
          {loadingProjects ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              加载中...
            </div>
          ) : !recentProjects || recentProjects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              还没有短剧项目，开始你的第一个创作吧
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map(project => (
                <ShortDramaProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DramaPillSelect<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: DramaSelectOption<T>[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex h-11 w-full items-center justify-between rounded-full border border-transparent bg-[#f6f4f8] px-4 text-sm font-semibold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(70,56,98,0.08)] transition-all hover:bg-white hover:shadow-[0_16px_34px_rgba(70,56,98,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 data-[state=open]:bg-white"
        >
          <span>{selected?.label ?? value}</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-data-[state=open]:-rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-[220px] rounded-[2rem] border-0 bg-white/95 p-3 shadow-[0_28px_70px_rgba(35,31,51,0.18)] backdrop-blur"
      >
        <div className="space-y-1">
          {options.map(option => (
            <DramaMenuItem
              key={String(option.value)}
              selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </DramaMenuItem>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EpisodeCountSelect({
  value,
  inputValue,
  valid,
  onPresetChange,
  onInputChange,
  onInputBlur,
}: {
  value: number
  inputValue: string
  valid: boolean
  onPresetChange: (value: string) => void
  onInputChange: (value: string) => void
  onInputBlur: () => void
}) {
  const [open, setOpen] = useState(false)
  const isPresetValue = SHORT_DRAMA_EPISODE_COUNTS.includes(value as (typeof SHORT_DRAMA_EPISODE_COUNTS)[number])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`group inline-flex h-11 w-full items-center justify-between rounded-full border border-transparent bg-[#f6f4f8] px-4 text-sm font-semibold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(70,56,98,0.08)] transition-all hover:bg-white hover:shadow-[0_16px_34px_rgba(70,56,98,0.12)] focus-visible:outline-none focus-visible:ring-2 data-[state=open]:bg-white ${
            valid ? 'focus-visible:ring-violet-200' : 'ring-2 ring-red-100 focus-visible:ring-red-200'
          }`}
        >
          <span>{valid ? `${value} 集` : '自定义集数'}</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-data-[state=open]:-rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-44 rounded-[1.75rem] border-0 bg-white/95 p-2.5 shadow-[0_24px_60px_rgba(36,34,46,0.18)] backdrop-blur"
      >
        <div className="space-y-1">
          {SHORT_DRAMA_EPISODE_COUNTS.map(count => (
            <DramaMenuItem
              key={count}
              selected={count === value && isPresetValue}
              muted={count !== value}
              onClick={() => {
                onPresetChange(String(count))
                setOpen(false)
              }}
            >
              {count.toString().padStart(2, '0')} 集
            </DramaMenuItem>
          ))}

          <div className="flex min-w-0 items-center gap-2 px-1 pt-1">
            <span className="h-1 w-1 rounded-full bg-slate-200" />
            <div className="flex h-9 min-w-0 flex-1 items-center rounded-xl bg-[#f4f3f6] px-2.5">
              <input
                type="text"
                inputMode="numeric"
                value={inputValue}
                onChange={e => onInputChange(e.target.value)}
                onBlur={onInputBlur}
                className="w-0 min-w-0 flex-1 bg-transparent text-center text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="自定义"
                aria-label="自定义集数"
              />
              <span className="shrink-0 text-sm text-slate-500">集</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DramaMenuItem({
  selected,
  muted = false,
  onClick,
  children,
}: {
  selected: boolean
  muted?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid h-9 w-full grid-cols-[22px_1fr] items-center rounded-xl px-1.5 text-sm transition-colors ${
        selected ? 'bg-[#f2f1f4] text-slate-950' : 'text-slate-500 hover:bg-[#f7f6f8]'
      }`}
    >
      <span className="flex justify-center">
        {selected ? <Check className="h-3.5 w-3.5 text-slate-950" /> : <span className="h-1 w-1 rounded-full bg-slate-200" />}
      </span>
      <span className={`text-center ${muted ? 'font-normal' : 'font-medium'}`}>{children}</span>
    </button>
  )
}
