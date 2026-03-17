'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Loader2, Search, ImageIcon, Check } from 'lucide-react'
import { apiGet } from '@/lib/api-client'
import { cn } from '@/lib/utils'

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

export function CompanyAImagePicker({ open, onOpenChange, onSelectPoster }: CompanyAImagePickerProps) {
  const [programName, setProgramName] = useState('')
  const [contentCode, setContentCode] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<number[]>([1, 14])
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Flat list of all poster URLs for lightbox navigation
  const allPosters: { url: string; name: string; programName: string }[] = results.flatMap((r) =>
    r.posters.map((p) => ({ url: p.url, name: p.name, programName: r.programname }))
  )

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const canSearch = programName.trim().length > 0 || contentCode.trim().length > 0

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) return

    setIsSearching(true)
    setHasSearched(false)
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
    onOpenChange(false)
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

            {hasSearched && allPosters.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                <ImageIcon className="h-10 w-10 mb-2 opacity-20" />
                <p>未找到相关图片</p>
              </div>
            )}

            {allPosters.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">共 {allPosters.length} 张图片</p>
                <div className="grid grid-cols-3 gap-2">
                  {allPosters.map((poster, idx) => (
                    <div
                      key={idx}
                      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer"
                      onClick={() => setLightboxIndex(idx)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={poster.url}
                        alt={poster.name}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Lightbox */}
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
                {allPosters.length > 1 && (
                  <p className="text-xs opacity-40 mt-0.5">{lightboxIndex + 1} / {allPosters.length}</p>
                )}
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
