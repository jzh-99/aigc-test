'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fetchWithAuth } from '@/lib/api-client'

interface TrashProject {
  id: string
  name: string
  deleted_at: string
}

interface Props {
  open: boolean
  workspaceId?: string | null
  onClose: () => void
  onChanged: () => void
}

function daysRemaining(deletedAt: string) {
  const deleted = new Date(deletedAt).getTime()
  const expire = deleted + 7 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expire - Date.now()) / (24 * 60 * 60 * 1000)))
}

export function VideoStudioTrashDrawer({ open, workspaceId, onClose, onChanged }: Props) {
  const [items, setItems] = useState<TrashProject[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!open || !workspaceId) return
    setLoading(true)
    try {
      const data = await fetchWithAuth<TrashProject[]>(`/video-studio/projects/trash?workspace_id=${workspaceId}`)
      setItems(Array.isArray(data) ? data : [])
    } catch {
      toast.error('加载回收站失败')
    } finally {
      setLoading(false)
    }
  }, [open, workspaceId])

  useEffect(() => { load() }, [load])

  const restore = async (id: string) => {
    await fetchWithAuth(`/video-studio/projects/${id}/restore`, { method: 'POST' })
    toast.success('项目已恢复')
    await load()
    onChanged()
  }

  const purge = async (id: string) => {
    if (!confirm('永久删除会同时清理项目资产，且无法恢复。确认继续？')) return
    await fetchWithAuth(`/video-studio/projects/${id}/permanent`, { method: 'DELETE' })
    toast.success('项目已永久删除')
    await load()
    onChanged()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div className="h-full w-96 bg-background shadow-xl border-l flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold">项目回收站</h2>
            <p className="text-xs text-muted-foreground">删除 7 天后自动永久清理</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">回收站为空</div>
          ) : items.map((item) => (
            <div key={item.id} className="border rounded-lg p-3 space-y-3">
              <div>
                <p className="font-medium text-sm truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">剩余 {daysRemaining(item.deleted_at)} 天</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => restore(item.id)}>
                  <RotateCcw className="w-3.5 h-3.5" />恢复
                </Button>
                <Button size="sm" variant="destructive" className="flex-1 gap-1" onClick={() => purge(item.id)}>
                  <Trash2 className="w-3.5 h-3.5" />永久删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
