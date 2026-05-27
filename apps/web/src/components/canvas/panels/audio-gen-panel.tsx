import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import { AudioWaveform, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Music, Search, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { apiFetcher } from '@/lib/api-client'
import { getPriceByResolution } from '@/components/generation/shared/schema-utils'
import type { ModelItem, SystemVoiceDemoResponse, SystemVoiceItem } from '@aigc/types'
import {
  calculateTtsCredits,
  countTtsCharacters,
  insertAtCursor,
  INTERJECTION_OPTIONS,
  parseAudioTagSegments,
  TTS_MAX_TEXT_LENGTH,
  toPauseTag,
  validatePauseSeconds,
} from './audio-tts-utils'

const PAUSE_OPTIONS = [
  { label: '0.25s', value: 0.25 },
  { label: '0.5s', value: 0.5 },
  { label: '1.0s', value: 1 },
  { label: '1.5s', value: 1.5 },
] as const

const VOICES_PER_PAGE = 20

interface AudioGenPanelProps {
  textDraft: string
  setTextDraft: (value: string) => void
  flushTextDraft: () => void
  model: string
  voiceId: string
  speed: number
  pitch: number
  volume: number
  executing: boolean
  models?: ModelItem[]
  onModelChange: (value: string) => void
  onUpdateCfg: (patch: Record<string, unknown>) => void
  onExecute: () => void
}

export function AudioGenPanel({
  textDraft,
  setTextDraft,
  flushTextDraft,
  model,
  voiceId,
  speed,
  pitch,
  volume,
  executing,
  models,
  onModelChange,
  onUpdateCfg,
  onExecute,
}: AudioGenPanelProps) {
  const [pauseOpen, setPauseOpen] = useState(false)
  const [interjectionOpen, setInterjectionOpen] = useState(false)
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false)
  const [demoLoadingId, setDemoLoadingId] = useState<string | null>(null)

  const currentDbModel = models?.find((item) => item.code === model)
  const unitPrice = currentDbModel ? getPriceByResolution(currentDbModel, 'default', currentDbModel.credit_cost) : 0
  const characterCount = countTtsCharacters(textDraft)
  const estimatedCredits = calculateTtsCredits(characterCount, unitPrice)

  const { data: voices, isLoading: voicesLoading, error: voicesError } = useSWR<SystemVoiceItem[]>(
    '/models/system-voices?provider=minimax',
    apiFetcher,
    { revalidateOnFocus: false },
  )
  const selectedVoice = voices?.find((voice) => voice.voice_id === voiceId)

  function updateText(nextText: string) {
    setTextDraft(nextText)
    onUpdateCfg({ text: nextText })
  }

  async function playVoiceDemo(voice: SystemVoiceItem) {
    setDemoLoadingId(voice.id)
    try {
      const demo = voice.demo_audio_url
        ? { demo_audio_url: voice.demo_audio_url }
        : await apiFetcher<SystemVoiceDemoResponse>(`/models/system-voices/${voice.id}/demo`)
      await new Audio(demo.demo_audio_url).play()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '音色试听失败')
    } finally {
      setDemoLoadingId(null)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_220px_180px] divide-x divide-border">
      <div className="flex min-w-0 flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-muted-foreground">合成文本</label>
          <span className={cn('font-mono text-[10px]', characterCount > TTS_MAX_TEXT_LENGTH ? 'text-destructive' : 'text-muted-foreground')}>
            {characterCount}/{TTS_MAX_TEXT_LENGTH}
          </span>
        </div>
        <AudioTagEditor
          value={textDraft}
          placeholder="输入要合成的文本..."
          onChange={updateText}
          onBlur={flushTextDraft}
        />
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-background/90 p-2 shadow-sm">
          <DropdownButton
            label="停顿"
            open={pauseOpen}
            setOpen={setPauseOpen}
            items={[
              ...PAUSE_OPTIONS.map((item) => ({
                label: item.label,
                onSelect: () => updateText(insertAtCursor(textDraft, toPauseTag(item.value), textDraft.length, textDraft.length)),
              })),
              {
                label: '自定义',
                onSelect: () => {
                  const rawValue = window.prompt('请输入停顿时长，范围 0.01 到 99.99 秒，最多两位小数')
                  if (rawValue == null) return
                  const seconds = validatePauseSeconds(rawValue)
                  if (seconds == null) {
                    toast.error('停顿时长需在 0.01 到 99.99 秒之间，最多两位小数')
                    return
                  }
                  updateText(insertAtCursor(textDraft, toPauseTag(seconds), textDraft.length, textDraft.length))
                },
              },
            ]}
          />
          <DropdownButton
            label="语气词"
            open={interjectionOpen}
            setOpen={setInterjectionOpen}
            items={INTERJECTION_OPTIONS.map((item) => ({
              label: item.label,
              onSelect: () => updateText(insertAtCursor(textDraft, item.value, textDraft.length, textDraft.length)),
            }))}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 p-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">模型</label>
          <div className="flex flex-col gap-1">
            {(models ?? []).map((item) => {
              const active = item.code === model
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => onModelChange(item.code)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors',
                    active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-transparent bg-muted/40 text-foreground hover:bg-muted',
                  )}
                >
                  <Music className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-[10px] text-muted-foreground">{getPriceByResolution(item, 'default', item.credit_cost)}/千字</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">音色</label>
          {voicesLoading && <VoiceSummarySkeleton />}
          {voicesError && <div className="rounded-lg bg-destructive/10 p-2 text-[10px] text-destructive">音色加载失败</div>}
          {!voicesLoading && !voicesError && (
            <VoiceSummary
              voice={selectedVoice}
              onChoose={() => setVoiceDialogOpen(true)}
              onPlay={selectedVoice ? () => playVoiceDemo(selectedVoice) : undefined}
              loading={selectedVoice?.id === demoLoadingId}
            />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 p-3">
        <RangeControl label="语速" min={0.5} max={2} step={0.05} value={speed} onChange={(value) => onUpdateCfg({ speed: value })} />
        <RangeControl label="音调" min={-12} max={12} step={1} value={pitch} onChange={(value) => onUpdateCfg({ pitch: value })} />
        <RangeControl label="音量" min={1} max={10} step={0.5} value={volume} onChange={(value) => onUpdateCfg({ volume: value })} />
        <button
          data-testid="canvas-execute-audio"
          type="button"
          onClick={onExecute}
          disabled={executing || characterCount === 0 || characterCount > TTS_MAX_TEXT_LENGTH || !voiceId}
          className="mt-auto flex w-full items-center justify-center gap-1 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {executing ? <><Loader2 className="h-3 w-3 animate-spin" />提交中</> : <><Wand2 className="h-3 w-3" />执行 · {estimatedCredits}积分</>}
        </button>
      </div>

      {voiceDialogOpen && (
        <VoiceSelectDialog
          voices={voices ?? []}
          selectedVoiceId={voiceId}
          demoLoadingId={demoLoadingId}
          onClose={() => setVoiceDialogOpen(false)}
          onSelect={(voice) => {
            onUpdateCfg({ voiceId: voice.voice_id, voiceSourceId: voice.id })
            setVoiceDialogOpen(false)
          }}
          onPlay={playVoiceDemo}
        />
      )}
    </div>
  )
}

function AudioTagEditor({
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const isComposingRef = useRef(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || document.activeElement === editor) return
    renderAudioEditorContent(editor, value)
  }, [value])

  function syncValueFromEditor() {
    const editor = editorRef.current
    if (!editor) return
    const nextValue = getAudioEditorPlainText(editor).slice(0, TTS_MAX_TEXT_LENGTH)
    if (nextValue !== value) onChange(nextValue)
    if (nextValue.length !== getAudioEditorPlainText(editor).length) {
      renderAudioEditorContent(editor, nextValue)
      placeCaretAtEnd(editor)
    }
  }

  function handleDeleteToken(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    const container = range.startContainer
    const offset = range.startOffset
    const parent = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement
    const tokenElement = parent?.closest('[data-audio-token]')
    if (tokenElement) {
      event.preventDefault()
      removeTokenFromValue(tokenElement as HTMLElement)
      return
    }

    let neighbor: ChildNode | null | undefined
    if (container.nodeType === Node.ELEMENT_NODE) {
      neighbor = event.key === 'Backspace'
        ? container.childNodes[offset - 1]
        : container.childNodes[offset]
    } else {
      if (event.key === 'Backspace' && offset === 0) {
        neighbor = container.previousSibling
      } else if (event.key === 'Delete' && offset === (container.textContent?.length ?? 0)) {
        neighbor = container.nextSibling
      }
    }

    // 跳过浏览器可能插入的零宽字符文本节点或 BR
    if (neighbor && !(neighbor instanceof HTMLElement && neighbor.dataset.audioToken)) {
      const next = event.key === 'Backspace' ? neighbor.previousSibling : neighbor.nextSibling
      if (next instanceof HTMLElement && next.dataset.audioToken) {
        neighbor = next
      }
    }

    if (neighbor instanceof HTMLElement && neighbor.dataset.audioToken) {
      event.preventDefault()
      removeTokenFromValue(neighbor)
    }
  }

  function removeTokenFromValue(tokenEl: HTMLElement) {
    const editor = editorRef.current
    if (!editor) return
    const tokenText = tokenEl.dataset.audioToken ?? ''
    if (!tokenText) return
    let charIndex = 0
    for (const child of Array.from(editor.childNodes)) {
      if (child === tokenEl) break
      if (child.nodeType === Node.TEXT_NODE) {
        charIndex += child.textContent?.length ?? 0
      } else if (child instanceof HTMLElement && child.dataset.audioToken) {
        charIndex += child.dataset.audioToken.length
      } else {
        charIndex += child.textContent?.length ?? 0
      }
    }
    const before = value.slice(0, charIndex)
    const after = value.slice(charIndex + tokenText.length)
    const nextValue = before + after
    onChange(nextValue)
    // 编辑器聚焦时 useEffect 不会重新渲染 DOM，需要手动同步
    renderAudioEditorContent(editor, nextValue)
    placeCaretAtEnd(editor)
  }

  return (
    <div className="relative">
      <div
        ref={editorRef}
        data-testid="audio-tag-editor"
        role="textbox"
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[190px] w-full whitespace-pre-wrap break-words rounded-xl border border-border/80 bg-background p-3 text-sm leading-7 text-foreground shadow-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          syncValueFromEditor()
          onBlur()
        }}
        onInput={() => {
          if (!isComposingRef.current) syncValueFromEditor()
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
          syncValueFromEditor()
        }}
        onKeyDown={handleDeleteToken}
      />
      {value.length === 0 && !focused && (
        <div className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">{placeholder}</div>
      )}
    </div>
  )
}

function renderAudioEditorContent(editor: HTMLElement, value: string) {
  editor.innerHTML = ''
  for (const segment of parseAudioTagSegments(value)) {
    if (segment.type === 'text') {
      editor.appendChild(document.createTextNode(segment.text))
      continue
    }
    const token = document.createElement('span')
    token.dataset.audioToken = segment.text
    token.dataset.testid = 'audio-tag-token'
    token.contentEditable = 'false'
    token.className = cn(
      'mx-0.5 inline-flex items-center rounded-md border px-2 py-0.5 font-semibold align-baseline shadow-sm',
      segment.type === 'pause'
        ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200'
        : 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200',
    )
    token.textContent = segment.type === 'pause' ? `<#${segment.label}#>` : segment.label
    editor.appendChild(token)
  }
}

function getAudioEditorPlainText(editor: HTMLElement): string {
  let text = ''
  editor.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (!(node instanceof HTMLElement)) return
    text += node.dataset.audioToken ?? node.innerText
  })
  return text.replace(/\u00a0/g, ' ')
}

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function DropdownButton({
  label,
  open,
  setOpen,
  items,
}: {
  label: string
  open: boolean
  setOpen: (value: boolean) => void
  items: Array<{ label: string; onSelect: () => void }>
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; minWidth: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!open) return

    const updateMenuPosition = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const viewportInset = 8
      const maxHeight = Math.min(288, window.innerHeight - viewportInset * 2)
      const menuHeight = Math.min(items.length * 40 + 12, maxHeight)
      const belowTop = rect.bottom + 6
      const aboveTop = rect.top - menuHeight - 6
      const hasEnoughSpaceBelow = belowTop + menuHeight <= window.innerHeight - viewportInset
      const top = hasEnoughSpaceBelow ? belowTop : Math.max(viewportInset, aboveTop)
      const left = Math.min(rect.left, window.innerWidth - 176 - viewportInset)
      setMenuStyle({
        top,
        left: Math.max(viewportInset, left),
        minWidth: Math.max(rect.width, 176),
        maxHeight,
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [items.length, open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex min-w-24 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition-colors',
          open
            ? 'border-primary/45 bg-primary/10 text-primary'
            : 'border-border bg-background text-foreground hover:border-primary/35 hover:bg-primary/5',
        )}
      >
        {label}
        <ChevronsUpDown className={cn('h-4 w-4', open ? 'text-primary' : 'text-muted-foreground')} />
      </button>
      {open && menuStyle && createPortal(
        <div
          className="fixed z-[120] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl shadow-foreground/10"
          style={menuStyle}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onSelect()
                setOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-popover-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

function VoiceSummary({
  voice,
  loading,
  onChoose,
  onPlay,
}: {
  voice?: SystemVoiceItem
  loading: boolean
  onChoose: () => void
  onPlay?: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-2">
      <button
        type="button"
        aria-label="试听当前音色"
        disabled={!onPlay}
        onClick={onPlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground hover:text-primary disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioWaveform className="h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{voice?.name ?? '请选择音色'}</div>
        <div className="truncate text-[10px] text-muted-foreground">{voice?.language ?? '暂无音色'}</div>
      </div>
      <button
        type="button"
        onClick={onChoose}
        className="rounded-md bg-background px-2 py-1 text-[10px] text-foreground hover:bg-muted"
      >
        选择
      </button>
    </div>
  )
}

function VoiceSummarySkeleton() {
  return <div className="h-[52px] animate-pulse rounded-lg bg-muted/50" />
}

function VoiceSelectDialog({
  voices,
  selectedVoiceId,
  demoLoadingId,
  onClose,
  onSelect,
  onPlay,
}: {
  voices: SystemVoiceItem[]
  selectedVoiceId: string
  demoLoadingId: string | null
  onClose: () => void
  onSelect: (voice: SystemVoiceItem) => void
  onPlay: (voice: SystemVoiceItem) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const filteredVoices = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return voices.filter((voice) => {
      return !keyword || `${voice.name} ${voice.voice_id} ${voice.language}`.toLowerCase().includes(keyword)
    })
  }, [query, voices])
  const totalPages = Math.max(1, Math.ceil(filteredVoices.length / VOICES_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageVoices = filteredVoices.slice((currentPage - 1) * VOICES_PER_PAGE, currentPage * VOICES_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [query])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-8 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="音色选择" className="flex h-[78vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">音色选择</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="rounded-lg bg-background px-4 py-2 text-sm font-medium shadow-sm">音色库</div>
          <div className="ml-auto flex min-w-[300px] items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索音色库"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {pageVoices.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl bg-muted/40 text-sm text-muted-foreground">暂无匹配音色</div>
          ) : (
            <div className="space-y-2">
              {pageVoices.map((voice) => {
                const selected = voice.voice_id === selectedVoiceId
                return (
                  <div key={voice.id} className={cn('flex items-center gap-4 rounded-xl bg-muted/60 p-3', selected && 'ring-1 ring-primary/45')}>
                    <button
                      type="button"
                      aria-label={`试听${voice.name}`}
                      onClick={() => onPlay(voice)}
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground hover:text-primary"
                    >
                      {demoLoadingId === voice.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <AudioWaveform className="h-5 w-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{voice.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{voice.voice_id}</div>
                    </div>
                    <span className="rounded bg-background px-2 py-1 text-xs text-muted-foreground">{voice.language}</span>
                    <button
                      type="button"
                      onClick={() => onSelect(voice)}
                      disabled={selected}
                      className={cn(
                        'rounded-full px-5 py-2 text-sm font-medium',
                        selected ? 'bg-muted text-muted-foreground' : 'bg-background text-foreground hover:bg-primary hover:text-primary-foreground',
                      )}
                    >
                      {selected ? '已选' : '选择'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center border-t border-border px-5 py-3 text-sm text-muted-foreground">
          <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="rounded-md p-2 hover:bg-muted disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="mx-3">第 {currentPage} / {totalPages} 页</span>
          <button type="button" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="rounded-md p-2 hover:bg-muted disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-auto">共 {filteredVoices.length} 条</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <label className="font-medium text-muted-foreground">{label}</label>
        <span className="font-mono text-muted-foreground">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </div>
  )
}
