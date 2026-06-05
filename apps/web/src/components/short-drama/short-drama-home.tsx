'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardPaste,
  FileText,
  Film,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import {
  SHORT_DRAMA_ASPECT_RATIOS,
  SHORT_DRAMA_EPISODE_COUNTS,
  SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT,
  SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS,
} from '@aigc/types'
import type { ShortDramaAspectRatio } from '@aigc/types'
import { ShortDramaStyleDialog } from './short-drama-style-dialog'
import { ShortDramaProjectCard } from './short-drama-project-card'
import { StudioReturnBar } from '@/components/toby-studio/studio-return-bar'
import {
  createShortDramaProject,
  listRecentShortDramaProjects,
  uploadShortDramaScript,
  type ShortDramaProjectListItem,
} from '@/lib/short-drama/api'

type DramaSelectOption<T extends string | number> = {
  value: T
  label: string
}

type ShortDramaCreateMode = 'idea' | 'upload'

export function ShortDramaHome() {
  const router = useRouter()
  const workspaceId = useAuthStore(s => s.activeWorkspaceId)

  const [mode, setMode] = useState<ShortDramaCreateMode>('idea')
  const [prompt, setPrompt] = useState('')
  const [originalScript, setOriginalScript] = useState('')
  const [scriptFileName, setScriptFileName] = useState('')
  const [style, setStyle] = useState('真人都市')
  const [aspectRatio, setAspectRatio] = useState<ShortDramaAspectRatio>('9:16')
  const [episodeCount, setEpisodeCount] = useState(10)
  const [episodeInput, setEpisodeInput] = useState('10')
  const [submitting, setSubmitting] = useState(false)
  const [parsingScript, setParsingScript] = useState(false)
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [pasteDraft, setPasteDraft] = useState('')
  const parsedEpisodeCount = Number(episodeInput)
  const isEpisodeCountValid =
    Number.isInteger(parsedEpisodeCount) &&
    parsedEpisodeCount > 0 &&
    parsedEpisodeCount <= SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT
  const normalizedOriginalScript = originalScript.trim()
  const isOriginalScriptTooLong = normalizedOriginalScript.length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS
  const canSubmit = mode === 'idea'
    ? Boolean(prompt.trim())
    : Boolean(normalizedOriginalScript) && !isOriginalScriptTooLong

  const { data: recentProjects, isLoading: loadingProjects } = useSWR<ShortDramaProjectListItem[]>(
    workspaceId ? ['short-drama-recent', workspaceId] : null,
    () => listRecentShortDramaProjects(workspaceId!, 4),
    { revalidateOnFocus: true }
  )

  const handleSubmit = async () => {
    if (!canSubmit || !workspaceId) return
    if (mode === 'idea' && !isEpisodeCountValid) {
      return
    }
    if (mode === 'upload' && isOriginalScriptTooLong) {
      return
    }
    setSubmitting(true)
    try {
      const result = await createShortDramaProject({
        workspaceId,
        prompt: mode === 'idea' ? prompt.trim() : '',
        source: mode,
        originalScript: mode === 'upload' ? normalizedOriginalScript : undefined,
        style,
        aspectRatio,
        episodeCount: mode === 'upload' ? 1 : parsedEpisodeCount,
      })
      toast.success('项目创建成功')
      router.push(`/toby-studio/short-drama/${result.projectId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleScriptFileChange = async (file: File | null) => {
    if (!file) return
    setParsingScript(true)
    try {
      const result = await uploadShortDramaScript(file)
      setOriginalScript(result.text)
      setScriptFileName(file.name)
      toast.success('原始剧本已解析')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '文件解析失败')
    } finally {
      setParsingScript(false)
    }
  }

  const handleOpenPasteDialog = () => {
    setPasteDraft(originalScript)
    setPasteDialogOpen(true)
  }

  const handleConfirmPaste = () => {
    const nextScript = pasteDraft.trim()
    if (!nextScript) {
      toast.error('原始剧本不能为空')
      return
    }
    if (nextScript.length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS) {
      toast.error(`原始剧本不能超过 ${SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS} 字`)
      return
    }
    setOriginalScript(nextScript)
    setScriptFileName('')
    setPasteDialogOpen(false)
  }

  const handleEpisodeInputChange = (value: string) => {
    const normalized = value.replace(/\D/g, '')
    setEpisodeInput(normalized)
    const nextCount = Number(normalized)
    if (
      Number.isInteger(nextCount) &&
      nextCount > 0 &&
      nextCount <= SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT
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
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">短剧Agent，一站式智能创作专属剧组！</p>
                </div>
                <div className="shrink-0 rounded-full border bg-background/75 px-4 py-2 text-xs font-medium text-muted-foreground shadow-sm dark:border-[#302858] dark:bg-white/5">
                  创意 → 大纲 → 素材 → 分集
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5 md:p-6">
              <div className="-mx-5 -mt-5 border-b bg-background/70 px-5 pt-4 dark:border-[#201b49] dark:bg-[#090817]/85 md:-mx-6 md:-mt-6 md:px-6">
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    onClick={() => setMode('idea')}
                    className={`relative inline-flex h-12 items-center gap-2 px-3 text-sm font-semibold transition-colors ${
                      mode === 'idea' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                    创意生成
                    {mode === 'idea' && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('upload')}
                    className={`relative inline-flex h-12 items-center gap-2 px-3 text-sm font-semibold transition-colors ${
                      mode === 'upload' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    上传剧本
                    {mode === 'upload' && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
                  </button>
                </div>
              </div>

              {mode === 'idea' ? (
                <Textarea
                  placeholder="描述你的短剧创意，例如：一个普通外卖员意外获得超能力，在都市中行侠仗义的故事..."
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  className="min-h-[168px] resize-none rounded-lg border-border bg-muted/35 p-4 text-sm shadow-inner focus-visible:ring-primary/25 dark:border-[#201b49] dark:bg-[#070615]"
                  maxLength={2000}
                />
              ) : (
                <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30 shadow-inner transition-colors focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/15 dark:border-[#201b49] dark:bg-[#070615]">
                  <div className="relative">
                    <Textarea
                      value={originalScript}
                      onChange={e => {
                        setOriginalScript(e.target.value)
                        if (scriptFileName) setScriptFileName('')
                      }}
                      className="min-h-[260px] resize-none border-0 bg-transparent p-4 text-sm shadow-none focus-visible:ring-0"
                    />
                    {!originalScript && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                        <div className="pointer-events-auto flex flex-col items-center gap-4 text-center">
                          <div>
                            <p className="text-sm font-semibold text-foreground">原始剧本</p>
                            <p className="mt-1 text-xs text-muted-foreground">支持 txt/docx，最多 10 万字</p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-[#302858] dark:bg-[#0d0b1d]">
                              {parsingScript ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              上传文件
                              <input
                                type="file"
                                accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                className="hidden"
                                disabled={parsingScript}
                                onChange={event => {
                                  const file = event.target.files?.[0] ?? null
                                  void handleScriptFileChange(file)
                                  event.target.value = ''
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={handleOpenPasteDialog}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-[#302858] dark:bg-[#0d0b1d]"
                            >
                              <ClipboardPaste className="h-4 w-4" />
                              粘贴文本
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {originalScript && (
                      <label className="absolute right-3 top-3 inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-background/90 px-3 text-xs font-semibold text-foreground shadow-sm backdrop-blur transition-colors hover:border-primary/40 hover:text-primary dark:border-[#302858] dark:bg-[#0d0b1d]/90">
                        {parsingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        上传文件
                        <input
                          type="file"
                          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          disabled={parsingScript}
                          onChange={event => {
                            const file = event.target.files?.[0] ?? null
                            void handleScriptFileChange(file)
                            event.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex h-9 items-center justify-between gap-3 border-t bg-background/75 px-3 text-xs backdrop-blur dark:border-[#201b49] dark:bg-[#090817]/85">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {scriptFileName || '原始剧本'}
                    </span>
                    <span className={isOriginalScriptTooLong ? 'shrink-0 text-red-500' : 'shrink-0 text-muted-foreground'}>
                      {normalizedOriginalScript.length.toLocaleString()} / {SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS.toLocaleString()} 字
                    </span>
                  </div>
                  <div className="border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground dark:border-[#201b49] dark:bg-[#090817]/70">
                    系统按每集约 2 分钟节奏生成，过长内容会自动压缩归并
                  </div>
                  {isOriginalScriptTooLong && (
                    <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-950/60 dark:bg-red-950/20">
                      请精简后再确认剧本
                    </div>
                  )}
                </div>
              )}

              <Dialog open={pasteDialogOpen} onOpenChange={setPasteDialogOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>粘贴原始剧本</DialogTitle>
                    <DialogDescription>
                      粘贴后会回显到原始剧本区域，最多 10 万字。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Textarea
                      value={pasteDraft}
                      onChange={event => setPasteDraft(event.target.value)}
                      placeholder="在这里粘贴原始剧本文本..."
                      className="min-h-[320px] resize-none rounded-lg border-border bg-muted/35 p-4 text-sm focus-visible:ring-primary/25 dark:border-[#201b49] dark:bg-[#070615]"
                      autoFocus
                    />
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className={pasteDraft.trim().length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS ? 'text-red-500' : 'text-muted-foreground'}>
                        {pasteDraft.trim().length.toLocaleString()} / {SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS.toLocaleString()} 字
                      </span>
                      {pasteDraft.trim().length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS && (
                        <span className="text-red-500">请精简后再确定</span>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPasteDialogOpen(false)}>
                      取消
                    </Button>
                    <Button
                      onClick={handleConfirmPaste}
                      disabled={!pasteDraft.trim() || pasteDraft.trim().length > SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS}
                    >
                      确定
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className={`grid grid-cols-1 gap-4 ${mode === 'upload' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
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

                {mode === 'idea' && (
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
                        请输入 1-{SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT} 的整数
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  创建项目后将消耗少量积分用于 AI 文本生成
                </p>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting || !workspaceId || (mode === 'idea' && !isEpisodeCountValid) || parsingScript}
                  className="h-11 gap-2 rounded-lg px-5 font-semibold"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />创建中...</>
                  ) : (
                    <><Sparkles className="h-4 w-4" />{mode === 'upload' ? '确认剧本' : '开始创作'}</>
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
