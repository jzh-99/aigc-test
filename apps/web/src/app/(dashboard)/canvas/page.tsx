'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PlusCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'

type Canvas = {
  id: string
  name: string
  preview_urls?: string[]
  created_at?: string
}

export default function CanvasGalleryPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const fetchCanvases = useCallback(async () => {
    if (!token) return
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
  }, [token, activeWorkspaceId])

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

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">我的画布</h1>
          <p className="text-muted-foreground mt-1">创建和管理你的 AI 创意画布</p>
        </div>
        <Button onClick={createNewCanvas} disabled={creating} size="lg" className="gap-2" data-testid="canvas-create-button">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
          新建画布
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border rounded-lg overflow-hidden bg-card animate-pulse">
              <div className="aspect-video bg-muted" />
              <div className="p-3 border-t space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            </div>
          ))
        ) : canvases.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
            <PlusCircle className="w-12 h-12 mx-auto opacity-30 mb-4" />
            <p className="text-lg font-medium">还没有画布</p>
            <p className="text-sm text-muted-foreground mt-1">点击上方"新建画布"开始创建</p>
          </div>
        ) : (
          canvases.map((canvas) => (
            <Link
              data-testid={`canvas-card-${canvas.id}`}
              key={canvas.id}
              href={`/canvas/editor/${canvas.id}`}
              className="group border rounded-lg overflow-hidden hover:shadow-lg transition-shadow bg-card"
            >
              <div className="aspect-video bg-muted overflow-hidden">
                {canvas.preview_urls && canvas.preview_urls.length > 0 ? (
                  <div className="grid grid-cols-2 w-full h-full">
                    {Array.from({ length: 2 }).map((_, i) => {
                      const url = canvas.preview_urls![i]
                      return url ? (
                        <img
                          key={i}
                          src={url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div key={i} className="w-full h-full bg-muted-foreground/5" />
                      )
                    })}
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <PlusCircle className="w-8 h-8 opacity-20" />
                  </div>
                )}
              </div>
              <div className="p-3 border-t">
                <h3 className="font-medium truncate group-hover:text-primary transition-colors">{canvas.name}</h3>
                {canvas.created_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(canvas.created_at).toLocaleDateString('zh-CN')}
                  </p>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
