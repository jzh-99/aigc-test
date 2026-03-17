'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { apiPost, apiDelete, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { RotateCcw, Trash2, Loader2 } from 'lucide-react'

interface DeletedTeam {
  id: string
  name: string
  owner_username: string | null
  deleted_at: string
}

interface DeletedWorkspace {
  id: string
  name: string
  team_id: string
  team_name: string | null
  deleted_at: string
}

interface TrashData {
  teams: DeletedTeam[]
  workspaces: DeletedWorkspace[]
}

function daysLeft(deletedAt: string): number {
  const diff = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, 7 - Math.floor(diff / (24 * 60 * 60 * 1000)))
}

interface TrashDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestored: () => void
}

export function TrashDrawer({ open, onOpenChange, onRestored }: TrashDrawerProps) {
  const { data, error, mutate } = useSWR<TrashData>(open ? '/admin/trash' : null)
  const [activeTab, setActiveTab] = useState<'teams' | 'workspaces'>('teams')
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleRestore(type: 'team' | 'workspace', id: string, name: string) {
    setLoadingId(id)
    try {
      if (type === 'team') {
        await apiPost(`/admin/trash/teams/${id}/restore`, {})
        toast.success(`团队"${name}"已恢复`)
      }
      // workspace restore via team route is handled in workspace-list
      mutate()
      onRestored()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '恢复失败')
    } finally {
      setLoadingId(null)
    }
  }

  async function handlePermanentDelete(type: 'team' | 'workspace', id: string, name: string) {
    if (!confirm(`确定要永久删除"${name}"吗？\n\n此操作不可恢复，所有数据将被彻底清除。`)) return
    setLoadingId(id)
    try {
      if (type === 'team') {
        await apiDelete(`/admin/trash/teams/${id}`)
        toast.success(`团队"${name}"已永久删除`)
      }
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setLoadingId(null)
    }
  }

  const teams = data?.teams ?? []
  const workspaces = data?.workspaces ?? []
  const isEmpty = teams.length === 0 && workspaces.length === 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>回收站</SheetTitle>
        </SheetHeader>

        <div className="mt-4">
          {/* Tabs */}
          <div className="flex gap-1 border-b mb-4">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'teams' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('teams')}
            >
              已删除团队 {teams.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({teams.length})</span>}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'workspaces' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('workspaces')}
            >
              已删除工作区 {workspaces.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({workspaces.length})</span>}
            </button>
          </div>

          {/* Content */}
          {!data && !error && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          )}

          {data && isEmpty && (
            <p className="text-sm text-muted-foreground text-center py-8">回收站为空</p>
          )}

          {activeTab === 'teams' && (
            <div className="space-y-2">
              {teams.map((team) => (
                <div key={team.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{team.name}</p>
                      {team.owner_username && (
                        <p className="text-xs text-muted-foreground">组长: {team.owner_username}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        删除于 {new Date(team.deleted_at).toLocaleDateString('zh-CN')} · 剩余 <span className="text-orange-500 font-medium">{daysLeft(team.deleted_at)} 天</span>
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loadingId === team.id}
                        onClick={() => handleRestore('team', team.id, team.name)}
                      >
                        {loadingId === team.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                        恢复
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={loadingId === team.id}
                        onClick={() => handlePermanentDelete('team', team.id, team.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {activeTab === 'teams' && teams.length === 0 && data && (
                <p className="text-sm text-muted-foreground text-center py-4">无已删除团队</p>
              )}
            </div>
          )}

          {activeTab === 'workspaces' && (
            <div className="space-y-2">
              {workspaces.map((ws) => (
                <div key={ws.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{ws.name}</p>
                      {ws.team_name && (
                        <p className="text-xs text-muted-foreground">所属团队: {ws.team_name}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        删除于 {new Date(ws.deleted_at).toLocaleDateString('zh-CN')} · 剩余 <span className="text-orange-500 font-medium">{daysLeft(ws.deleted_at)} 天</span>
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" disabled className="opacity-50 cursor-not-allowed">
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        恢复
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {activeTab === 'workspaces' && workspaces.length === 0 && data && (
                <p className="text-sm text-muted-foreground text-center py-4">无已删除工作区</p>
              )}
              {workspaces.length > 0 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  工作区恢复请进入对应团队的成员管理页面操作
                </p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
