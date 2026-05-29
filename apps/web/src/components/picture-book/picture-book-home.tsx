'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowRight, BookOpenText, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { generatePictureBookScript, listRecentPictureBookProjects } from '@/lib/picture-book/api'
import { PICTURE_BOOK_ASPECT_RATIOS, PICTURE_BOOK_PAGE_COUNTS, PICTURE_BOOK_STYLES, type PictureBookAspectRatio, type PictureBookPageCount, type PictureBookStyle } from '@/lib/picture-book/types'
import { PictureBookProjectCard } from './picture-book-project-card'

export function PictureBookHome() {
  const router = useRouter()
  const workspaceId = useAuthStore((state) => state.activeWorkspaceId)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<PictureBookStyle>('吉卜力风')
  const [pageCount, setPageCount] = useState<PictureBookPageCount>(15)
  const [aspectRatio, setAspectRatio] = useState<PictureBookAspectRatio>('16:9')
  const [submitting, setSubmitting] = useState(false)
  const [streamText, setStreamText] = useState('')
  const recent = useSWR(
    workspaceId ? ['picture-book-recent', workspaceId] : null,
    () => listRecentPictureBookProjects(workspaceId!, 4),
  )

  const handleSubmit = async () => {
    if (!workspaceId) {
      toast.error('请先选择工作区')
      return
    }
    if (!prompt.trim()) {
      toast.error('请输入绘本主题')
      return
    }
    setSubmitting(true)
    setStreamText('')
    try {
      const result = await generatePictureBookScript({
        workspace_id: workspaceId,
        prompt: prompt.trim(),
        style,
        page_count: pageCount,
        aspect_ratio: aspectRatio,
        onChunk: (text) => setStreamText((prev) => prev + text),
      })
      router.push(`/toby-studio/picture-book/${result.projectId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成剧本失败')
    } finally {
      setSubmitting(false)
      setStreamText('')
    }
  }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <section className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-10 pt-12 md:px-6 md:pt-16">
        <div className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-lg border bg-card shadow-sm">
          <BookOpenText className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-center text-3xl font-semibold tracking-normal md:text-4xl">Toby AI绘本</h1>

        <div className="mt-8 w-full max-w-4xl rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 生成绘本
            </div>
            {/* <Link href="/toby-studio/picture-book/projects" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-foreground">
              全部 · 我的绘本
              <ArrowRight className="h-4 w-4" />
            </Link> */}
          </div>
          <div className="space-y-4 p-5">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-36 resize-none rounded-lg border-muted-foreground/20 bg-background text-base"
              placeholder="输入绘本主题，例如：一只怕黑的小狗第一次学会帮朋友点亮夜晚"
            />
            <div className="grid gap-3 md:grid-cols-[1fr_160px_160px_150px]">
              <Select value={style} onValueChange={(value) => setStyle(value as PictureBookStyle)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="绘本风格" />
                </SelectTrigger>
                <SelectContent>
                  {PICTURE_BOOK_STYLES.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(pageCount)} onValueChange={(value) => setPageCount(Number(value) as PictureBookPageCount)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="页数" />
                </SelectTrigger>
                <SelectContent>
                  {PICTURE_BOOK_PAGE_COUNTS.map((item) => (
                    <SelectItem key={item} value={String(item)}>{item} 页</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as PictureBookAspectRatio)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="绘本比例" />
                </SelectTrigger>
                <SelectContent>
                  {PICTURE_BOOK_ASPECT_RATIOS.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button className="h-11 gap-2" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                立即生成
              </Button>
            </div>
          </div>
          {submitting && streamText && (
            <div className="border-t px-5 py-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">AI 正在生成剧本...</p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-foreground/80">{streamText}</pre>
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">我的绘本</h2>
          <Link href="/toby-studio/picture-book/projects" className="text-sm font-medium text-primary hover:text-foreground">全部</Link>
        </div>
        {recent.isLoading ? (
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-64 animate-pulse rounded-lg border bg-muted" />
            ))}
          </div>
        ) : recent.data?.length ? (
          <div className="grid gap-4 md:grid-cols-4">
            {recent.data.slice(0, 4).map((project) => (
              <PictureBookProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            还没有绘本项目，输入主题后生成第一份草稿。
          </div>
        )}
      </section>
    </div>
  )
}
