'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { BookOpenText, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { generatePictureBookScript, listRecentPictureBookProjects } from '@/lib/picture-book/api'
import {
  PICTURE_BOOK_ASPECT_RATIOS,
  PICTURE_BOOK_PAGE_COUNTS,
  PICTURE_BOOK_STYLES,
  type PictureBookAspectRatio,
  type PictureBookPageCount,
  type PictureBookProjectListItem,
  type PictureBookStyle,
} from '@/lib/picture-book/types'
import { PictureBookProjectCard } from './picture-book-project-card'
import { StudioReturnBar } from '@/components/toby-studio/studio-return-bar'

const POLL_INTERVAL = 3_000

export function PictureBookHome() {
  const workspaceId = useAuthStore((state) => state.activeWorkspaceId)
  const isInitialized = useAuthStore((state) => state.isInitialized)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<PictureBookStyle>('吉卜力风')
  const [pageCount, setPageCount] = useState<PictureBookPageCount>(15)
  const [aspectRatio, setAspectRatio] = useState<PictureBookAspectRatio>('16:9')
  // 提交中：防重复点击（不作为按钮 loading 视觉，按钮文案不变）
  const [submitting, setSubmitting] = useState(false)
  const recent = useSWR(
    isInitialized && workspaceId ? ['picture-book-recent', workspaceId] : null,
    () => listRecentPictureBookProjects(workspaceId!, 4),
  )

  // 列表里存在 generating 项目时启动轮询，直到全部离开 generating（退出重进也能自愈）
  const hasGenerating = (recent.data ?? []).some((project) => project.status === 'generating')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (hasGenerating) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { void recent.mutate() }, POLL_INTERVAL)
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [hasGenerating, recent])

  const handleSubmit = async () => {
    if (!workspaceId) {
      toast.error('请先选择工作区')
      return
    }
    if (!prompt.trim()) {
      toast.error('请输入绘本主题')
      return
    }
    if (submitting) return
    setSubmitting(true)
    const submittedPrompt = prompt.trim()
    let projectCreated = false

    // 后台等待大纲生成完成：项目已创建后，大纲生成是后台任务，
    // 不阻塞按钮（按钮在 onCreated 时即释放）。完成/失败时刷新卡片状态。
    const finishGeneration = (isError: boolean) => {
      void recent.mutate().then(() => {
        if (isError) {
          toast.error('绘本大纲生成失败，可在列表中查看或删除后重试')
        }
      })
    }

    try {
      await generatePictureBookScript({
        workspace_id: workspaceId,
        prompt: submittedPrompt,
        style,
        page_count: pageCount,
        aspect_ratio: aspectRatio,
        onCreated: (data) => {
          projectCreated = true
          // 项目已落库（generating）：立即在列表头部插入卡片，清空输入框，释放按钮
          const optimistic: PictureBookProjectListItem = {
            id: data.projectId,
            workspace_id: workspaceId,
            title: data.title,
            prompt: data.prompt,
            style: data.style,
            page_count: data.page_count,
            status: 'generating',
            active_step: 'script',
            cover_url: null,
            draft_saved_at: null,
            estimated_credits: 1,
            actual_credits: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          recent.mutate((current) => [optimistic, ...(current ?? [])], false)
          setPrompt('')
          // 项目创建即视为"立即生成"动作完成，按钮恢复，loading 转移到卡片
          setSubmitting(false)
        },
      })
      // 大纲生成完成（done）：刷新列表拿到落库的 script_ready 状态
      finishGeneration(false)
    } catch (error) {
      if (!projectCreated) {
        // 项目尚未创建就失败（网络/校验/409）：释放按钮并提示
        setSubmitting(false)
        toast.error(error instanceof Error ? error.message : '生成剧本失败')
      } else {
        // 项目已创建但大纲生成失败：刷新拿到 failed 状态
        finishGeneration(true)
      }
    }
  }

  return (
    <div className="-mx-4 -mt-4 min-h-[calc(100vh-4.25rem)] bg-background md:-mx-6 md:-mt-6">
      <StudioReturnBar />
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
          </div>
          <div className="space-y-4 p-5">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={submitting}
              className="min-h-36 resize-none rounded-lg border-muted-foreground/20 bg-background text-base disabled:cursor-not-allowed disabled:opacity-60"
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
                {submitting ? '创建中...' : '立即生成'}
              </Button>
            </div>
          </div>
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
