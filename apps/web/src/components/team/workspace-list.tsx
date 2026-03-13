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
import { apiPost, apiDelete, apiGet } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type { UserProfile } from '@aigc/types'
import { toast } from 'sonner'
import { Plus, FolderOpen, Users, Trash2 } from 'lucide-react'

interface TeamData {
  id: string
  name: string
  members: Array<{ user_id: string; username: string; email: string }>
}

interface WsMember {
  user_id: string
  email: string
  username: string
  role: string
}

export function WorkspaceList({ teamId }: { teamId: string }) {
  const user = useAuthStore((s) => s.user)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [managingWs, setManagingWs] = useState<string | null>(null)

  // Get team data (includes members)
  const { data: teamData } = useSWR<TeamData>(`/teams/${teamId}`)

  // Get workspaces from user's team
  const workspaces =
    user?.teams.find((t) => t.id === teamId)?.workspaces ?? []

  // Workspace members (when managing)
  const { data: wsMembers, mutate: mutateWsMembers } = useSWR<{
    data: WsMember[]
  }>(managingWs ? `/workspaces/${managingWs}/members` : null)

  async function handleCreate() {
    if (!newName) return
    try {
      await apiPost(`/teams/${teamId}/workspaces`, { name: newName })
      toast.success('工作区已创建')
      setCreateOpen(false)
      setNewName('')
      // Refresh user profile to get new workspace
      const profile = await apiGet<UserProfile>('/users/me')
      useAuthStore.getState().updateUser(profile)
    } catch {
      toast.error('创建失败')
    }
  }

  async function handleAddMember(userId: string) {
    if (!managingWs) return
    try {
      await apiPost(`/workspaces/${managingWs}/members`, { user_id: userId })
      toast.success('成员已添加')
      mutateWsMembers()
    } catch {
      toast.error('添加失败')
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!managingWs) return
    try {
      await apiDelete(`/workspaces/${managingWs}/members/${userId}`)
      toast.success('成员已移除')
      mutateWsMembers()
    } catch {
      toast.error('移除失败')
    }
  }

  return (
    <>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">工作区</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          创建工作区
        </Button>
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
                      角色: {ws.role}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setManagingWs(ws.id)}
                >
                  <Users className="h-3.5 w-3.5 mr-1" />
                  成员
                </Button>
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
              {wsMembers?.data?.map((m) => (
                <div
                  key={m.user_id}
                  className="flex items-center justify-between py-1.5 border-b last:border-0"
                >
                  <div>
                    <span className="text-sm">{m.username}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {m.email}
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
            <div>
              <p className="text-sm font-medium mb-2">添加团队成员</p>
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
                        {m.email}
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
        </DialogContent>
      </Dialog>
    </>
  )
}
