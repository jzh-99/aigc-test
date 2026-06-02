'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ChevronDown, Film, Loader2, Sparkles } from 'lucide-react'
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
    () => listRecentShortDramaProjects(workspaceId!, 4),
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
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-lg border bg-card shadow-[0_24px_70px_rgba(36,31,58,0.08)] dark:border-[#201b49] dark:bg-[#090817] dark:shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
            <div className="border-b bg-[linear-gradient(135deg,#fbfbff_0%,#f6f1ff_55%,#edf8ff_100%)] p-5 md:p-6 dark:border-[#201b49] dark:bg-[linear-gradient(135deg,#151133_0%,#111a38_55%,#071d27_100%)]">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-background/75 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm dark:border-[#302858] dark:bg-white/5">
                    <Film className="h-3.5 w-3.5 text-violet-500" />
                    TOBY SHORT DRAMA
                  </div>
                  <h1 className="text-3xl font-semibold tracking-normal text-foreground md:text-4xl">AI 短剧</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">把一个故事种子扩展成角色、素材、分集和视频片段，适合连续剧式创作。</p>
                </div>
                <div className="shrink-0 rounded-full border bg-background/75 px-4 py-2 text-xs font-medium text-muted-foreground shadow-sm dark:border-[#302858] dark:bg-white/5">
                  创意 → 大纲 → 素材 → 分集
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5 md:p-6">
              <Textarea
                placeholder="描述你的短剧创意，例如：一个普通外卖员意外获得超能力，在都市中行侠仗义的故事..."
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="min-h-[168px] resize-none rounded-lg border-border bg-muted/35 p-4 text-sm shadow-inner focus-visible:ring-primary/25 dark:border-[#201b49] dark:bg-[#070615]"
                maxLength={2000}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">视觉风格</label>
                  <ShortDramaStyleDialog value={style} onChange={setStyle}>
                    <button
                      type="button"
                      className="group flex h-12 w-full items-center justify-between rounded-lg border bg-background px-4 text-left text-sm font-semibold text-foreground shadow-sm transition-all hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-[#201b49] dark:bg-[#0d0b1d]"
                    >
                      <span className="truncate">{style || '选择风格'}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-rotate-180" />
                    </button>
                  </ShortDramaStyleDialog>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">画面比例</label>
                  <DramaPillSelect
                    value={aspectRatio}
                    options={SHORT_DRAMA_ASPECT_RATIOS.map(r => ({ value: r, label: r }))}
                    onChange={value => setAspectRatio(value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">集数</label>
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

              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  创建项目后将消耗少量积分用于 AI 文本生成
                </p>
                <Button
                  onClick={handleSubmit}
                  disabled={!prompt.trim() || submitting || !workspaceId || !isEpisodeCountValid}
                  className="h-11 gap-2 rounded-lg px-5 font-semibold"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />创建中...</>
                  ) : (
                    <><Sparkles className="h-4 w-4" />开始创作</>
                  )}
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-muted/25 p-4 shadow-[0_24px_70px_rgba(36,31,58,0.06)] dark:border-[#201b49] dark:bg-[#090817] dark:shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">最近项目</h2>
                <p className="mt-1 text-xs text-muted-foreground">展示最近 4 个短剧项目</p>
              </div>
              <Link href="/toby-studio/short-drama/projects" className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-primary/50 hover:text-primary dark:border-[#302858] dark:bg-white/5">
                全部
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {loadingProjects ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-[148px] animate-pulse rounded-lg border bg-card dark:border-[#201b49] dark:bg-[#0d0b1d]" />
                ))}
              </div>
            ) : !recentProjects || recentProjects.length === 0 ? (
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground dark:border-[#302858] dark:bg-[#0d0b1d]">
                还没有短剧项目，开始你的第一个创作吧
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {recentProjects.slice(0, 4).map(project => (
                  <ShortDramaProjectCard key={project.id} project={project} />
                ))}
              </div>
            )}
          </section>
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
          className="group flex h-11 w-full items-center justify-between rounded-lg border bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 data-[state=open]:border-primary/35 dark:border-[#201b49] dark:bg-[#0d0b1d]"
        >
          <span>{selected?.label ?? value}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:-rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-32 rounded-lg border bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_42px_rgba(35,31,51,0.16)] backdrop-blur dark:border-[#302858] dark:shadow-[0_18px_42px_rgba(0,0,0,0.36)]"
      >
        <div className="space-y-0.5">
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
          className={`group inline-flex h-11 w-full items-center justify-between rounded-lg border bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 data-[state=open]:border-primary/35 dark:border-[#201b49] dark:bg-[#0d0b1d] ${
            valid ? 'focus-visible:ring-primary/25' : 'ring-2 ring-destructive/20 focus-visible:ring-destructive/30'
          }`}
        >
          <span>{valid ? `${value} 集` : '自定义集数'}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:-rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-36 rounded-lg border bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_42px_rgba(36,34,46,0.16)] backdrop-blur dark:border-[#302858] dark:shadow-[0_18px_42px_rgba(0,0,0,0.36)]"
      >
        <div className="space-y-0.5">
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

          <div className="px-1 pt-1">
            <div className="flex h-8 min-w-0 items-center rounded-md bg-muted px-2 dark:bg-white/5">
              <input
                type="text"
                inputMode="numeric"
                value={inputValue}
                onChange={e => onInputChange(e.target.value)}
                onBlur={onInputBlur}
                className="w-0 min-w-0 flex-1 bg-transparent text-center text-xs font-medium text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="自定义"
                aria-label="自定义集数"
              />
              <span className="shrink-0 text-xs text-muted-foreground">集</span>
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
      className={`relative flex h-8 w-full items-center justify-center rounded-md px-6 text-sm transition-colors ${
        selected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted dark:hover:bg-white/5'
      }`}
    >
      <span className="absolute left-2 flex justify-center">
        {selected ? <Check className="h-3.5 w-3.5 text-foreground" /> : <span className="h-1 w-1 rounded-full bg-muted-foreground/35" />}
      </span>
      <span className={`text-center ${muted ? 'font-normal' : 'font-medium'}`}>{children}</span>
    </button>
  )
}
