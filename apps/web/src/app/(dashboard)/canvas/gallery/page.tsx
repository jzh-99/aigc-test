'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PlusCircle, Loader2, Trash2, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { CanvasTrashDrawer } from '@/components/canvas/canvas-trash-drawer'

type Canvas = {
  id: string
  name: string
  preview_urls?: string[]
  created_at?: string
}

export default function CanvasGalleryPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const fetchCanvases = useCallback(async () => {
    if (!isInitialized) return
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const qs = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
      const res = await fetch(`/api/v1/canvases${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      setCanvases(await res.json())
    } catch {
      toast.error('加载画布列表失败')
    } finally {
      setLoading(false)
    }
  }, [isInitialized, token, activeWorkspaceId])

  useEffect(() => {
    fetchCanvases()
  }, [fetchCanvases])

  async function createNewCanvas() {
    if (!token) return
    setCreating(true)
    try {
      const res = await fetch('/api/v1/canvases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: '未命名画布',
          ...(activeWorkspaceId ? { workspace_id: activeWorkspaceId } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to create')
      const canvas: Canvas = await res.json()
      toast.success('画布创建成功')
      router.push(`/canvas/editor/${canvas.id}`)
    } catch {
      toast.error('创建画布失败')
    } finally {
      setCreating(false)
    }
  }

  async function deleteCanvas(id: string) {
    if (!token) return
    if (!confirm('删除后画布会进入回收站，7 天内可恢复。确认删除？')) return
    try {
      const res = await fetch(`/api/v1/canvases/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete')
      setCanvases((items) => items.filter((item) => item.id !== id))
      toast.success('画布已移入回收站')
    } catch {
      toast.error('删除画布失败')
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-5 py-10 text-white sm:px-8 lg:px-12 lg:py-14">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_12%,rgba(173,144,255,0.18),transparent_24%),radial-gradient(circle_at_78%_4%,rgba(77,160,255,0.14),transparent_28%),linear-gradient(180deg,rgba(5,7,22,0.02)_0%,rgba(5,7,22,0.18)_100%)]" />
      <div className="pointer-events-none absolute left-[14%] top-[16%] h-[22rem] w-[48rem] -rotate-12 rounded-full border border-violet-200/10 opacity-20 blur-[1px]" />

      <div className="relative z-10 mx-auto max-w-[1660px] space-y-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-violet-100/45">Canvas Gallery</p>
            <div>
              <h3 className="font-serif text-[2rem] font-normal leading-none text-white drop-shadow-[0_14px_34px_rgba(6,8,30,0.58)] sm:text-[2rem]">
                全部画布
              </h3>
              <p className="mt-3 text-base font-medium text-violet-100/58">浏览和管理你的所有 AI 创意画布</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setTrashOpen(true)}
              size="lg"
              className="h-11 gap-2 rounded-full border-white/15 bg-white/[0.06] px-5 text-violet-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl transition hover:border-white/28 hover:bg-white/[0.12] hover:text-white"
            >
              <Archive className="h-4 w-4" />
              回收站
            </Button>
            <Button
              onClick={createNewCanvas}
              disabled={creating}
              size="lg"
              className="h-11 gap-2 rounded-full border border-violet-100/28 bg-[#a78bfa]/88 px-6 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_18px_42px_rgba(88,70,210,0.32)] transition hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_22px_54px_rgba(88,70,210,0.42)]"
              data-testid="canvas-create-button"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              新建画布
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="creative-glass-card relative overflow-hidden rounded-[24px] p-3 animate-pulse">
                <div className="aspect-video rounded-[18px] bg-white/10" />
                <div className="space-y-2 px-1 pb-1 pt-4">
                  <div className="h-4 w-3/4 rounded-full bg-white/12" />
                  <div className="h-3 w-1/3 rounded-full bg-white/8" />
                </div>
              </div>
            ))
          ) : canvases.length === 0 ? (
            <div className="creative-glass-card col-span-full relative flex min-h-[18rem] flex-col items-center justify-center overflow-hidden rounded-[28px] px-6 py-14 text-center">
              <div className="creative-glass-sheen" />
              <div className="creative-glass-icon relative mb-5 grid h-16 w-16 place-items-center overflow-hidden rounded-[20px]">
                <PlusCircle className="h-8 w-8 text-white/78" />
              </div>
              <p className="text-xl font-semibold text-white">还没有画布</p>
              <p className="mt-2 text-sm font-medium text-violet-100/56">点击上方"新建画布"开始创建</p>
            </div>
          ) : (
            canvases.map((canvas) => (
              <div key={canvas.id} className="creative-glass-card group relative overflow-hidden rounded-[24px] p-3 transition duration-300">
                <div className="creative-glass-sheen" />
                <Link
                  data-testid={`canvas-card-${canvas.id}`}
                  href={`/canvas/editor/${canvas.id}`}
                  className="relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <div className="aspect-video overflow-hidden rounded-[18px] bg-white/[0.06]">
                    {canvas.preview_urls && canvas.preview_urls.length > 0 ? (
                      <div className="grid h-full w-full grid-cols-2">
                        {Array.from({ length: 2 }).map((_, i) => {
                          const url = canvas.preview_urls![i]
                          return url ? (
                            <img
                              key={i}
                              src={url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div key={i} className="h-full w-full bg-white/[0.04]" />
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.16),transparent_30%),linear-gradient(145deg,rgba(167,139,250,0.12),rgba(77,160,255,0.08))]">
                        <PlusCircle className="h-8 w-8 text-white/28" />
                      </div>
                    )}
                  </div>
                  <div className="px-1 pb-1 pt-4">
                    <h3 className="truncate text-base font-semibold text-white transition-colors group-hover:text-violet-100">{canvas.name}</h3>
                    {canvas.created_at && (
                      <p className="mt-1 text-xs font-medium text-violet-100/48">
                        {new Date(canvas.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    )}
                  </div>
                </Link>
                <button
                  onClick={(e) => { e.preventDefault(); deleteCanvas(canvas.id) }}
                  className="absolute right-5 top-5 rounded-full border border-white/15 bg-[#080b22]/72 p-2 text-white/58 opacity-0 shadow-[0_12px_30px_rgba(3,5,22,0.38)] backdrop-blur-xl transition hover:border-rose-200/35 hover:bg-rose-400/16 hover:text-rose-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  title="删除画布"
                  aria-label="删除画布"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
        <CanvasTrashDrawer
          open={trashOpen}
          workspaceId={activeWorkspaceId}
          token={token}
          onClose={() => setTrashOpen(false)}
          onChanged={fetchCanvases}
        />
      </div>
    </div>
  )
}
