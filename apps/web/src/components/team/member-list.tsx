'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiDelete, ApiError } from '@/lib/api-client'
import { InviteDialog } from './invite-dialog'
import { BatchInviteDialog } from './batch-invite-dialog'
import { useConfirm } from '@/hooks/use-confirm'
import { toast } from 'sonner'
import { UserPlus, Trash2, Users } from 'lucide-react'

// 本地积分系统已退役：credit_used / credit_quota / credits 等字段后端不再返回。
// 本组件只做纯成员管理（列表/添加/批量添加/移除），A 豆流水后续对接业管平台。
interface Member {
  user_id: string
  account: string
  username: string
  avatar_url: string | null
  role: string
  joined_at: string
}

interface TeamData {
  id: string
  name: string
  members: Member[]
}

const roleBadgeVariant = {
  owner: 'default',
  admin: 'secondary',
  editor: 'outline',
  viewer: 'outline',
} as const

const roleLabel: Record<string, string> = {
  owner: '组长',
  admin: '管理员',
  editor: '编辑',
  viewer: '查看',
}

export function MemberList({ teamId }: { teamId: string }) {
  const confirm = useConfirm()
  const { data, error, mutate } = useSWR<TeamData>(`/teams/${teamId}`, {
    // Skip retry on 429 (rate-limited) — prevent hammering the server when overloaded
    onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
      if (err instanceof ApiError && err.status === 429) return
      if (retryCount >= 3) return
      setTimeout(() => revalidate({ retryCount }), 5000)
    },
  })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [batchInviteOpen, setBatchInviteOpen] = useState(false)

  // Delayed mutate: give the DB a moment to commit before re-fetching
  const delayedMutate = (ms = 400) => new Promise<void>(res => setTimeout(() => { mutate(); res() }, ms))

  if (!data && !error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  async function handleRemoveMember(member: Member) {
    if (!await confirm({ title: '移除成员', description: `确定要移除 ${member.username} 吗？`, confirmText: '移除' })) return
    try {
      await apiDelete(`/teams/${teamId}/members/${member.user_id}`)
      toast.success('成员已移除')
      delayedMutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">成员列表</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setBatchInviteOpen(true)}>
              <Users className="h-4 w-4 mr-2" />
              批量添加
            </Button>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              添加成员
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">用户名</th>
                  <th className="text-left py-2 px-2 font-medium">账户</th>
                  <th className="text-left py-2 px-2 font-medium">角色</th>
                  <th className="text-left py-2 px-2 font-medium">加入时间</th>
                  <th className="text-right py-2 px-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.members.map((member) => {
                  const joinedAt = member.joined_at ? new Date(member.joined_at) : null
                  return (
                    <tr key={member.user_id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{member.username}</td>
                      <td className="py-2 px-2 text-muted-foreground">{member.account}</td>
                      <td className="py-2 px-2">
                        <Badge variant={roleBadgeVariant[member.role as keyof typeof roleBadgeVariant] ?? 'outline'}>
                          {roleLabel[member.role] ?? member.role}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {joinedAt ? `${joinedAt.getFullYear()}-${String(joinedAt.getMonth() + 1).padStart(2, '0')}-${String(joinedAt.getDate()).padStart(2, '0')}` : '-'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {member.role !== 'owner' && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="移除成员"
                              onClick={() => handleRemoveMember(member)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <InviteDialog
        teamId={teamId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => delayedMutate(600)}
      />

      {/* Batch Invite Dialog */}
      <BatchInviteDialog
        teamId={teamId}
        open={batchInviteOpen}
        onOpenChange={setBatchInviteOpen}
        onSuccess={() => delayedMutate(800)}
      />
    </>
  )
}
