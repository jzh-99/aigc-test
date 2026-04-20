'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { apiPost, apiDelete, apiGet, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type { UserProfile } from '@aigc/types'
import { toast } from 'sonner'
import { Plus, FolderOpen, Users, Trash2, RotateCcw, Loader2 } from 'lucide-react'

interface TeamData {
  id: string
  name: string
  members: Array<{ user_id: string; username: string; account: string }>
}

interface WsMember {
  user_id: string
  account: string
  username: string
  role: string
}

interface DeletedWorkspace {
  id: string
  name: string
  deleted_at: string
}

function daysLeft(deletedAt: string): number {
  const diff = Date.now() - new Date(deletedAt).getTime()
  return Math.max(0, 7 - Math.floor(diff / (24 * 60 * 60 * 1000)))
}

interface TeamWorkspace {
  id: string
  name: string
  description: string | null
  created_at: string
  member_count: number
}

export function WorkspaceList({ teamId }: { teamId: string }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [managingWs, setManagingWs] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  // Get team data (includes members)
  const { data: teamData } = useSWR<TeamData>(`/teams/${teamId}`)

  // Get all workspaces in team (owner management view — not filtered by membership)
  const { data: wsData, mutate: mutateWorkspaces } = useSWR<{ data: TeamWorkspace[] }>(`/teams/${teamId}/workspaces`)
  const workspaces = wsData?.data ?? []

  // Workspace members (when managing)
  const { data: wsMembers, mutate: mutateWsMembers } = useSWR<{
    data: WsMember[]
  }>(managingWs ? `/workspaces/${managingWs}/members` : null)

  // Trash workspaces
  const { data: trashData, mutate: mutateTrash } = useSWR<{ data: DeletedWorkspace[] }>(
    trashOpen ? `/teams/${teamId}/trash` : null
  )

  async function handleCreate() {
    if (!newName) return
    try {
      await apiPost(`/teams/${teamId}/workspaces`, { name: newName })
      toast.success('工作区已创建')
      setCreateOpen(false)
      setNewName('')
      mutateWorkspaces()
      // Also refresh user profile so sidebar stays in sync
      const profile = await apiGet<UserProfile>('/users/me')
      useAuthStore.getState().updateUser(profile)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败')
    }
  }

  async function handleDeleteWorkspace(ws: { id: string; name: string }) {
    if (!confirm(`确定要删除工作区"${ws.name}"吗？\n\n工作区将被移入回收站，7天内可恢复。`)) return
    try {
      await apiDelete(`/teams/${teamId}/workspaces/${ws.id}`)
      toast.success(`工作区"${ws.name}"已删除`)
      mutateWorkspaces()
      const profile = await apiGet<UserProfile>('/users/me')
      useAuthStore.getState().updateUser(profile)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function handleRestoreWorkspace(ws: DeletedWorkspace) {
    setLoadingId(ws.id)
    try {
      await apiPost(`/teams/${teamId}/trash/${ws.id}/restore`, {})
      toast.success(`工作区"${ws.name}"已恢复`)
      mutateTrash()
      mutateWorkspaces()
      const profile = await apiGet<UserProfile>('/users/me')
      useAuthStore.getState().updateUser(profile)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '恢复失败')
    } finally {
      setLoadingId(null)
    }
  }

  async function handlePermanentDeleteWorkspace(ws: DeletedWorkspace) {
    if (!confirm(`确定要永久删除工作区"${ws.name}"吗？\n\n此操作不可恢复。`)) return
    setLoadingId(ws.id)
    try {
      await apiDelete(`/teams/${teamId}/trash/${ws.id}`)
      toast.success(`工作区"${ws.name}"已永久删除`)
      mutateTrash()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleAddMember(userId: string) {
    if (!managingWs) return
    try {
      await apiPost(`/workspaces/${managingWs}/members`, { user_id: userId })
      toast.success('成员已添加')
      mutateWsMembers()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '添加失败')
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!managingWs) return
    try {
      await apiDelete(`/workspaces/${managingWs}/members/${userId}`)
      toast.success('成员已移除')
      mutateWsMembers()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  return (
    <>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">工作区</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setTrashOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" />
            回收站
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            创建工作区
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {workspaces.map((ws) => (
          <Card key={ws.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-accent-blue" />
                  <div>
                    <p className="font-medium">{ws.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ws.member_count} 名成员
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setManagingWs(ws.id)}
                  >
                    <Users className="h-3.5 w-3.5 mr-1" />
                    成员
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="删除工作区"
                    onClick={() => handleDeleteWorkspace(ws)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Workspace Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建工作区</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder="工作区名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!newName}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workspace Trash Dialog */}
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>工作区回收站</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {!trashData && (
              <p className="text-sm text-muted-foreground text-center py-4">加载中...</p>
            )}
            {trashData?.data.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">回收站为空</p>
            )}
            {trashData?.data.map((ws) => (
              <div key={ws.id} className="border rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{ws.name}</p>
                  <p className="text-xs text-muted-foreground">
                    删除于 {new Date(ws.deleted_at).toLocaleDateString('zh-CN')} · 剩余 <span className="text-orange-500 font-medium">{daysLeft(ws.deleted_at)} 天</span>
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingId === ws.id}
                    onClick={() => handleRestoreWorkspace(ws)}
                  >
                    {loadingId === ws.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                    恢复
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={loadingId === ws.id}
                    onClick={() => handlePermanentDeleteWorkspace(ws)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrashOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Members Dialog */}
      <Dialog
        open={!!managingWs}
        onOpenChange={(open) => !open && setManagingWs(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>工作区成员管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">当前成员</p>
              <div className="max-h-48 overflow-y-auto">
              {wsMembers?.data?.map((m) => (
                <div
                  key={m.user_id}
                  className="flex items-center justify-between py-1.5 border-b last:border-0"
                >
                  <div>
                    <span className="text-sm">{m.username}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {m.account}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{m.role}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive"
                      onClick={() => handleRemoveMember(m.user_id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">添加团队成员</p>
              <div className="max-h-48 overflow-y-auto">
              {teamData?.members
                ?.filter(
                  (m) =>
                    !wsMembers?.data?.some((wm) => wm.user_id === m.user_id)
                )
                .map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between py-1.5 border-b last:border-0"
                  >
                    <div>
                      <span className="text-sm">{m.username}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {m.account}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddMember(m.user_id)}
                    >
                      添加
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
