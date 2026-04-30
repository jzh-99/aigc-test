'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'

const ENTRIES = [
  {
    icon: '🎬',
    label: '制作视频',
    desc: '剧本 → 分镜 → 角色 → 视频',
    name: '未命名视频项目',
  },
  {
    icon: '🖼️',
    label: '生成图片',
    desc: '描述你想要的图片',
    name: '未命名图片项目',
  },
  {
    icon: '🎨',
    label: '自由创作',
    desc: '空白画布，自由搭建',
    name: '未命名画布',
  },
]

export default function CanvasIndexPage() {
  const router = useRouter()
  const token = useAuthStore((s) => s.accessToken)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const [checking, setChecking] = useState(true)
  const [creating, setCreating] = useState<number | null>(null)

  useEffect(() => {
    if (!isInitialized || !token) return
    const qs = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
    fetch(`/api/v1/canvases${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((canvases: Array<{ id: string }>) => {
        if (canvases.length > 0) {
          router.replace('/canvas/gallery')
        } else {
          setChecking(false)
        }
      })
      .catch(() => setChecking(false))
  }, [isInitialized, token, activeWorkspaceId, router])

  async function createCanvas(idx: number) {
    if (!token || creating !== null) return
    setCreating(idx)
    try {
      const res = await fetch('/api/v1/canvases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: ENTRIES[idx].name,
          ...(activeWorkspaceId ? { workspace_id: activeWorkspaceId } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      const canvas = await res.json()
      router.push(`/canvas/editor/${canvas.id}`)
    } catch {
      toast.error('创建画布失败')
      setCreating(null)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">你想做什么？</h1>
        <p className="text-muted-foreground">选择一个方向开始创作</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
        {ENTRIES.map((entry, idx) => (
          <button
            key={idx}
            onClick={() => createCanvas(idx)}
            disabled={creating !== null}
            className="flex flex-col items-start gap-2 p-5 rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all text-left disabled:opacity-60"
          >
            <span className="text-3xl">{entry.icon}</span>
            <div>
              <div className="font-semibold">{entry.label}</div>
              <div className="text-sm text-muted-foreground mt-0.5">{entry.desc}</div>
            </div>
            {creating === idx && <Loader2 className="w-4 h-4 animate-spin text-primary mt-1" />}
          </button>
        ))}

        <button
          disabled
          className="flex flex-col items-start gap-2 p-5 rounded-xl border bg-card opacity-40 cursor-not-allowed text-left"
        >
          <span className="text-3xl">📦</span>
          <div>
            <div className="font-semibold">批量生产</div>
            <div className="text-sm text-muted-foreground mt-0.5">即将推出</div>
          </div>
        </button>
      </div>

      <a href="/canvas/gallery" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        查看全部画布 →
      </a>
    </div>
  )
}
