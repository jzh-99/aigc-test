'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface TrashCanvas {
  id: string
  name: string
  deleted_at: string
}

interface Props {
  open: boolean
  workspaceId?: string | null
  token?: string | null
  onClose: () => void
  onChanged: () => void
}

function daysRemaining(deletedAt: string) {
  const deleted = new Date(deletedAt).getTime()
  const expire = deleted + 7 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expire - Date.now()) / (24 * 60 * 60 * 1000)))
}

async function request(path: string, token?: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  })
  if (!res.ok) throw new Error('request failed')
  return res.json().catch(() => null)
}

export function CanvasTrashDrawer({ open, workspaceId, token, onClose, onChanged }: Props) {
  const [items, setItems] = useState<TrashCanvas[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!open || !token) return
    setLoading(true)
    try {
      const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
      const data = await request(`/canvases/trash${qs}`, token)
      setItems(Array.isArray(data) ? data : [])
    } catch {
      toast.error('加载回收站失败')
    } finally {
      setLoading(false)
    }
  }, [open, token, workspaceId])

  useEffect(() => { load() }, [load])

  const restore = async (id: string) => {
    await request(`/canvases/${id}/restore`, token, { method: 'POST' })
    toast.success('画布已恢复')
    await load()
    onChanged()
  }

  const purge = async (id: string) => {
    if (!confirm('永久删除会同时清理画布资产，且无法恢复。确认继续？')) return
    await request(`/canvases/${id}/permanent`, token, { method: 'DELETE' })
    toast.success('画布已永久删除')
    await load()
    onChanged()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#03050f]/42 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-[25rem] flex-col overflow-hidden border-l border-violet-100/16 bg-[#080b22]/78 text-white shadow-[inset_1px_0_0_rgba(255,255,255,0.08),-28px_0_80px_rgba(3,5,22,0.48)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_8%,rgba(173,144,255,0.18),transparent_28%),radial-gradient(circle_at_92%_18%,rgba(77,160,255,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.012)_42%,rgba(7,10,31,0.2))]" />
        <div className="relative z-10 flex items-start justify-between border-b border-white/10 px-5 py-5">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-100/42">Canvas Trash</p>
            <div>
              <h2 className="font-serif text-2xl font-normal leading-none text-white">画布回收站</h2>
              <p className="mt-2 text-xs font-medium text-violet-100/46">删除 7 天后自动永久清理</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[0.06] text-violet-100/54 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:border-white/24 hover:bg-white/[0.11] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="关闭回收站"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative z-10 flex-1 space-y-3 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-violet-100/72" />
            </div>
          ) : items.length === 0 ? (
            <div className="creative-glass-card relative flex min-h-[13rem] flex-col items-center justify-center overflow-hidden rounded-[24px] px-5 py-10 text-center">
              <div className="creative-glass-sheen" />
              <div className="creative-glass-icon relative mb-4 grid h-14 w-14 place-items-center overflow-hidden rounded-[18px]">
                <Trash2 className="h-7 w-7 text-white/62" />
              </div>
              <p className="text-sm font-semibold text-white">回收站为空</p>
              <p className="mt-2 text-xs font-medium leading-5 text-violet-100/46">删除的画布会在这里保留 7 天</p>
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="creative-glass-card relative overflow-hidden rounded-[20px] p-4">
              <div className="creative-glass-sheen" />
              <div className="relative space-y-3">
                <div>
                  <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                  <p className="mt-1 text-xs font-medium text-violet-100/48">剩余 {daysRemaining(item.deleted_at)} 天</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 flex-1 gap-1 rounded-full border-white/14 bg-white/[0.06] text-violet-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:border-white/24 hover:bg-white/[0.12] hover:text-white"
                    onClick={() => restore(item.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-9 flex-1 gap-1 rounded-full border border-rose-200/20 bg-rose-400/18 text-rose-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:bg-rose-400/28 hover:text-white"
                    onClick={() => purge(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    永久删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
