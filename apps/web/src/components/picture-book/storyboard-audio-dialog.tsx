'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import { AudioWaveform, ChevronLeft, ChevronRight, Loader2, Search, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiFetcher } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { SystemVoiceDemoResponse, SystemVoiceItem } from '@aigc/types'

const VOICES_PER_PAGE = 12

interface StoryboardAudioDialogProps {
  open: boolean
  voiceZhId?: string
  voiceEnId?: string
  loading?: boolean
  onConfirm: (voiceZhId: string, voiceEnId: string) => void
  onClose: () => void
}

export function StoryboardAudioDialog({
  open,
  voiceZhId,
  voiceEnId,
  loading,
  onConfirm,
  onClose,
}: StoryboardAudioDialogProps) {
  const [selectedZhId, setSelectedZhId] = useState(voiceZhId ?? '')
  const [selectedEnId, setSelectedEnId] = useState(voiceEnId ?? '')
  const [activeTab, setActiveTab] = useState<'zh' | 'en'>('zh')
  const [demoLoadingId, setDemoLoadingId] = useState<string | null>(null)

  const { data: voices, isLoading: voicesLoading } = useSWR<SystemVoiceItem[]>(
    open ? '/models/system-voices?provider=minimax' : null,
    apiFetcher,
    { revalidateOnFocus: false },
  )

  useEffect(() => {
    if (voiceZhId) setSelectedZhId(voiceZhId)
    if (voiceEnId) setSelectedEnId(voiceEnId)
  }, [voiceZhId, voiceEnId])

  const zhVoices = useMemo(() => voices?.filter(v => v.language?.toLowerCase().includes('zh') || v.language?.toLowerCase().includes('中文')) ?? [], [voices])
  const enVoices = useMemo(() => voices?.filter(v => v.language?.toLowerCase().includes('en') || v.language?.toLowerCase().includes('英文')) ?? [], [voices])

  const selectedZhVoice = zhVoices.find(v => v.voice_id === selectedZhId)
  const selectedEnVoice = enVoices.find(v => v.voice_id === selectedEnId)

  async function playVoiceDemo(voice: SystemVoiceItem) {
    setDemoLoadingId(voice.id)
    try {
      const demo = await apiFetcher<SystemVoiceDemoResponse>(`/models/system-voices/${voice.id}/demo`)
      await new Audio(demo.demo_audio_url).play()
    } catch {
      toast.error('音色试听失败')
    } finally {
      setDemoLoadingId(null)
    }
  }

  function handleConfirm() {
    if (!selectedZhId) {
      toast.error('请选择中文音色')
      return
    }
    if (!selectedEnId) {
      toast.error('请选择英文音色')
      return
    }
    onConfirm(selectedZhId, selectedEnId)
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="语音音色选择"
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">选择语音音色</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setActiveTab('zh')}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'zh' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/60 text-foreground hover:bg-muted',
            )}
          >
            中文音色 {selectedZhVoice ? `· ${selectedZhVoice.name}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('en')}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'en' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/60 text-foreground hover:bg-muted',
            )}
          >
            英文音色 {selectedEnVoice ? `· ${selectedEnVoice.name}` : ''}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {voicesLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <VoiceList
              voices={activeTab === 'zh' ? zhVoices : enVoices}
              selectedVoiceId={activeTab === 'zh' ? selectedZhId : selectedEnId}
              demoLoadingId={demoLoadingId}
              onSelect={(voice) => {
                if (activeTab === 'zh') setSelectedZhId(voice.voice_id)
                else setSelectedEnId(voice.voice_id)
              }}
              onPlay={playVoiceDemo}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <div className="text-sm text-muted-foreground">
            {selectedZhVoice ? `中文：${selectedZhVoice.name}` : '未选中文音色'}
            {' · '}
            {selectedEnVoice ? `英文：${selectedEnVoice.name}` : '未选英文音色'}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleConfirm} disabled={loading || !selectedZhId || !selectedEnId}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              确认并生成
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function VoiceList({
  voices,
  selectedVoiceId,
  demoLoadingId,
  onSelect,
  onPlay,
}: {
  voices: SystemVoiceItem[]
  selectedVoiceId: string
  demoLoadingId: string | null
  onSelect: (voice: SystemVoiceItem) => void
  onPlay: (voice: SystemVoiceItem) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filteredVoices = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return voices.filter(voice => !keyword || `${voice.name} ${voice.voice_id} ${voice.language}`.toLowerCase().includes(keyword))
  }, [query, voices])

  const totalPages = Math.max(1, Math.ceil(filteredVoices.length / VOICES_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageVoices = filteredVoices.slice((currentPage - 1) * VOICES_PER_PAGE, currentPage * VOICES_PER_PAGE)

  useEffect(() => { setPage(1) }, [query])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索音色"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">共 {filteredVoices.length} 条</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
        {pageVoices.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl bg-muted/40 text-sm text-muted-foreground">暂无匹配音色</div>
        ) : (
          <div className="space-y-2">
            {pageVoices.map((voice) => {
              const selected = voice.voice_id === selectedVoiceId
              return (
                <div key={voice.id} className={cn('flex items-center gap-3 rounded-xl bg-muted/60 p-3 transition-colors', selected && 'ring-1 ring-primary/45')}>
                  <button
                    type="button"
                    aria-label={`试听${voice.name}`}
                    onClick={() => onPlay(voice)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground hover:text-primary"
                  >
                    {demoLoadingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioWaveform className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{voice.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{voice.voice_id}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(voice)}
                    disabled={selected}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                      selected ? 'bg-primary/10 text-primary' : 'bg-background text-foreground hover:bg-primary hover:text-primary-foreground',
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-5 py-2 text-sm text-muted-foreground">
          <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="rounded-md p-1.5 hover:bg-muted disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>{currentPage} / {totalPages}</span>
          <button type="button" onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="rounded-md p-1.5 hover:bg-muted disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
