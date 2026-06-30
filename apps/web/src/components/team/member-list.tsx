'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { apiDelete, apiPost, ApiError } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { InviteDialog } from './invite-dialog'
import { BatchInviteDialog } from './batch-invite-dialog'
import { useConfirm } from '@/hooks/use-confirm'
import { toast } from 'sonner'
import { Check, Copy, KeyRound, Loader2, Trash2, UserPlus, Users } from 'lucide-react'

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
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [resetPasswordResult, setResetPasswordResult] = useState<{
    username: string
    password: string
  } | null>(null)
  const [passwordCopied, setPasswordCopied] = useState(false)

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

  // 【暂时取消】团队成员「移除成员」功能。通过此开关仅隐藏移除按钮，
  // 保留 handleRemoveMember 与按钮 JSX 代码以便后续恢复，恢复方式：把 ENABLE_REMOVE_MEMBER 改回 true。
  // 说明：后端 DELETE /teams/:id/members/:uid 路由保留不动，仅前端入口下线。
  const ENABLE_REMOVE_MEMBER = false

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

  async function handleResetPassword(member: Member) {
    if (member.role === 'owner') return
    if (!await confirm({
      title: '重置密码',
      description: `确定要重置 ${member.username} 的登录密码吗？重置后该成员需要使用新密码重新登录并修改密码。`,
      confirmText: '重置',
    })) return

    setResettingUserId(member.user_id)
    try {
      const result = await apiPost<{ success: boolean; one_time_password: string }>(
        `/teams/${teamId}/members/${member.user_id}/reset-password`,
        {},
      )
      setResetPasswordResult({ username: member.username, password: result.one_time_password })
      setPasswordCopied(false)
      toast.success('密码已重置')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重置密码失败')
    } finally {
      setResettingUserId(null)
    }
  }

  async function handleCopyPassword() {
    if (!resetPasswordResult) return
    try {
      await copyTextToClipboard(resetPasswordResult.password)
      setPasswordCopied(true)
      toast.success('密码已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  function handleResetDialogOpenChange(open: boolean) {
    if (open) return
    setResetPasswordResult(null)
    setPasswordCopied(false)
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
                        {member.role !== 'owner' ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="重置密码"
                              disabled={resettingUserId === member.user_id}
                              onClick={() => handleResetPassword(member)}
                            >
                              {resettingUserId === member.user_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <KeyRound className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            {ENABLE_REMOVE_MEMBER && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="移除成员"
                                onClick={() => handleRemoveMember(member)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
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

      <Dialog open={!!resetPasswordResult} onOpenChange={handleResetDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>密码已重置</DialogTitle>
            <DialogDescription>
              请将下面的一次性密码发送给 {resetPasswordResult?.username}。关闭弹窗后将不再显示。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-4">
            <div className="text-xs text-muted-foreground mb-2">临时密码</div>
            <div className="flex items-center justify-between gap-3">
              <code className="min-w-0 break-all font-mono text-base font-semibold">
                {resetPasswordResult?.password}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={handleCopyPassword}>
                {passwordCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {passwordCopied ? '已复制' : '复制'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            该成员下次登录后会被引导修改密码，原有登录会话已失效。
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => handleResetDialogOpenChange(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
