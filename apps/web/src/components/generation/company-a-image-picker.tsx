'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Loader2, Search, ImageIcon, Check, Plus } from 'lucide-react'
import { apiGet } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 30

interface Poster {
  name: string
  url: string
}

interface SearchResult {
  contentcode: string
  programname: string
  programtype: number
  posters: Poster[]
}

const PROGRAM_TYPES = [
  { value: 1, label: '单集' },
  { value: 14, label: '连续剧剧头' },
]

interface CompanyAImagePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectPoster: (url: string, name: string) => void
}

interface PosterMeta {
  url: string
  name: string
  programName: string
  width?: number
  height?: number
}

export function CompanyAImagePicker({ open, onOpenChange, onSelectPoster }: CompanyAImagePickerProps) {
  const [programName, setProgramName] = useState('')
  const [contentCode, setContentCode] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<number[]>([1, 14])
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [posterMeta, setPosterMeta] = useState<Record<string, { width: number; height: number }>>({})
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const allPosters: PosterMeta[] = results.flatMap((r) =>
    r.posters.map((p) => ({
      url: p.url,
      name: p.name,
      programName: r.programname,
      ...posterMeta[p.url],
    }))
  )

  const visiblePosters = allPosters.slice(0, visibleCount)
  const totalPosters = allPosters.length

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((n) => Math.min(n + PAGE_SIZE, totalPosters))
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [totalPosters])

  const canSearch = programName.trim().length > 0 || contentCode.trim().length > 0

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) return

    setIsSearching(true)
    setHasSearched(false)
    setResults([])
    setPosterMeta({})
    setVisibleCount(PAGE_SIZE)
    try {
      const params = new URLSearchParams()
      if (programName.trim()) params.set('programname', programName.trim())
      if (contentCode.trim()) params.set('contentcode', contentCode.trim())
      if (selectedTypes.length === 1) params.set('programtype', String(selectedTypes[0]))

      const data = await apiGet<{ data: SearchResult[] }>(`/company-a/pictures?${params}`)
      setResults(data.data ?? [])
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
      setHasSearched(true)
    }
  }

  function toggleType(type: number) {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.length > 1 ? prev.filter((t) => t !== type) : prev
        : [...prev, type]
    )
  }

  function handleSelectPoster(url: string, name: string) {
    onSelectPoster(url, name)
    setLightboxIndex(null)
    onOpenChange(false)
  }

  function handleImageLoad(url: string, e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    if (img.naturalWidth) {
      setPosterMeta((prev) => ({ ...prev, [url]: { width: img.naturalWidth, height: img.naturalHeight } }))
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-3 shrink-0 border-b">
            <SheetTitle>图库搜索</SheetTitle>
          </SheetHeader>

          {/* Search form */}
          <form onSubmit={handleSearch} className="px-4 py-3 space-y-3 shrink-0 border-b">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">节目名称</Label>
              <Input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                placeholder="输入节目名称关键词"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">媒资编码</Label>
              <Input
                value={contentCode}
                onChange={(e) => setContentCode(e.target.value)}
                placeholder="输入媒资编码"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">节目类型</Label>
              <div className="flex gap-2">
                {PROGRAM_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleType(t.value)}
                    className={cn(
                      'px-3 py-1 rounded-md border text-xs font-medium transition-colors',
                      selectedTypes.includes(t.value)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {selectedTypes.includes(t.value) && <Check className="h-3 w-3 inline mr-1" />}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" size="sm" className="w-full gap-2" disabled={!canSearch || isSearching}>
              {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              搜索
            </Button>
          </form>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!hasSearched && !isSearching && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                <ImageIcon className="h-10 w-10 mb-2 opacity-20" />
                <p>输入节目名称或媒资编码开始搜索</p>
              </div>
            )}

            {hasSearched && !isSearching && allPosters.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                <ImageIcon className="h-10 w-10 mb-2 opacity-20" />
                <p>未找到相关图片</p>
              </div>
            )}

            {!isSearching && allPosters.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">共 {totalPosters} 张图片</p>
                <div className="grid grid-cols-3 gap-2">
                  {visiblePosters.map((poster, idx) => {
                    const meta = posterMeta[poster.url]
                    return (
                      <div
                        key={idx}
                        className="group relative rounded-lg overflow-hidden border bg-muted cursor-pointer"
                        style={{ aspectRatio: meta ? `${meta.width}/${meta.height}` : '1/1' }}
                        onClick={() => setLightboxIndex(idx)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={poster.url}
                          alt={poster.name}
                          className="w-full h-full object-contain transition-transform group-hover:scale-105"
                          onLoad={(e) => handleImageLoad(poster.url, e)}
                        />

                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />

                        {/* Pixel info on hover */}
                        {meta && (
                          <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/60 text-white text-[10px] leading-tight opacity-0 group-hover:opacity-100 transition-opacity">
                            {meta.width} × {meta.height}
                          </div>
                        )}

                        {/* Quick-select button */}
                        <button
                          className="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity shadow"
                          onClick={(e) => { e.stopPropagation(); handleSelectPoster(poster.url, poster.name) }}
                        >
                          <Plus className="h-3 w-3" />
                          选用
                        </button>
                      </div>
                    )
                  })}
                </div>
                {visibleCount < totalPosters && (
                  <div ref={sentinelRef} className="h-8 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Lightbox — rendered outside Sheet so z-index works */}
      {lightboxIndex !== null && allPosters[lightboxIndex] && (
        <ImageLightbox
          url={allPosters[lightboxIndex].url}
          alt={allPosters[lightboxIndex].name}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex((i) => i! - 1) : undefined}
          onNext={lightboxIndex < allPosters.length - 1 ? () => setLightboxIndex((i) => i! + 1) : undefined}
          footer={
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{allPosters[lightboxIndex].programName}</p>
                <p className="text-xs opacity-60 mt-0.5 truncate">{allPosters[lightboxIndex].name}</p>
                <p className="text-xs opacity-40 mt-0.5 tabular-nums">
                  {lightboxIndex + 1} / {allPosters.length}
                  {posterMeta[allPosters[lightboxIndex].url] && (
                    <span className="ml-2">
                      {posterMeta[allPosters[lightboxIndex].url].width} × {posterMeta[allPosters[lightboxIndex].url].height} px
                    </span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => handleSelectPoster(allPosters[lightboxIndex!].url, allPosters[lightboxIndex!].name)}
              >
                <Check className="h-3.5 w-3.5" />
                选为参考图
              </Button>
            </div>
          }
        />
      )}
    </>
  )
}
