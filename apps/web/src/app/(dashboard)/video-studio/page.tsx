'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Clapperboard, Film, Loader2, Clock, Trash2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { VideoStudioTrashDrawer } from '@/components/video-studio/video-studio-trash-drawer'
import { useAuthStore } from '@/stores/auth-store'
import { fetchWithAuth } from '@/lib/api-client'

interface Project {
  id: string
  name: string
  created_at: string
  updated_at: string
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function VideoStudioPage() {
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [trashOpen, setTrashOpen] = useState(false)

  useEffect(() => {
    if (!isInitialized) return
    if (!workspaceId) { setLoading(false); return }
    fetchWithAuth<Project[]>(`/video-studio/projects?workspace_id=${workspaceId}`)
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [isInitialized, workspaceId])

  const deleteProject = async (id: string) => {
    if (!confirm('删除后项目会进入回收站，7 天内可恢复。确认删除？')) return
    try {
      await fetchWithAuth(`/video-studio/projects/${id}`, { method: 'DELETE' })
      setProjects((items) => items.filter((item) => item.id !== id))
      toast.success('项目已移入回收站')
    } catch {
      toast.error('删除项目失败')
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clapperboard className="w-6 h-6" />
            视频工坊
          </h1>
          <p className="text-sm text-muted-foreground mt-1">从故事描述到成片，AI 全程辅助</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTrashOpen(true)} className="gap-2">
            <Archive className="w-4 h-4" />
            回收站
          </Button>
          <Link
            href="/video-studio/new"
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建项目
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中…
        </div>
      ) : projects.length === 0 ? (
        <>
          <div className="border-2 border-dashed rounded-2xl p-16 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Film className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">还没有视频项目</p>
              <p className="text-sm text-muted-foreground mt-1">创建你的第一个项目，AI 帮你从剧本到成片</p>
            </div>
            <Link
              href="/video-studio/new"
              className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              开始创作
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: '✍️', title: 'AI 剧本创作', desc: '描述故事，AI 生成完整剧本、角色和场景' },
              { icon: '🎞️', title: '智能分镜', desc: '自动拆分分镜，生成每个镜头的画面提示词' },
              { icon: '🎬', title: '一键成片', desc: '从参考图到视频，逐镜头生成，支持批量导出' },
            ].map((f) => (
              <div key={f.title} className="border rounded-xl p-4 space-y-2">
                <span className="text-2xl">{f.icon}</span>
                <p className="font-semibold text-sm">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="relative group border rounded-xl hover:bg-muted/40 transition-colors">
              <Link
                href={`/video-studio/wizard?id=${p.id}&name=${encodeURIComponent(p.name)}`}
                className="block p-4 space-y-3"
              >
                <div className="w-full aspect-video rounded-lg bg-muted flex items-center justify-center">
                  <Film className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{p.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {timeAgo(p.updated_at)}
                  </p>
                </div>
              </Link>
              <button
                onClick={(e) => { e.preventDefault(); deleteProject(p.id) }}
                className="absolute right-2 top-2 rounded-md bg-background/90 p-1.5 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100"
                title="删除项目"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Link
            href="/video-studio/new"
            className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-border transition-colors aspect-video"
          >
            <Plus className="w-6 h-6" />
            <span className="text-sm">新建项目</span>
          </Link>
        </div>
      )}
      <VideoStudioTrashDrawer
        open={trashOpen}
        workspaceId={workspaceId}
        onClose={() => setTrashOpen(false)}
        onChanged={() => {
          if (!workspaceId) return
          fetchWithAuth<Project[]>(`/video-studio/projects?workspace_id=${workspaceId}`)
            .then((data) => setProjects(Array.isArray(data) ? data : []))
            .catch(() => {})
        }}
      />
    </div>
  )
}
