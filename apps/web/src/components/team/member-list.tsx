'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { apiPatch, apiPost, apiDelete, ApiError } from '@/lib/api-client'
import { InviteDialog } from './invite-dialog'
import { toast } from 'sonner'
import { UserPlus, Trash2, Edit2, RotateCcw } from 'lucide-react'

interface Member {
  user_id: string
  account: string
  username: string
  avatar_url: string | null
  role: string
  credit_quota: number | null
  credit_used: number
  quota_period: string | null
  quota_reset_at: string | null
  joined_at: string
}

interface TeamData {
  id: string
  name: string
  members: Member[]
  credits: { balance: number; frozen_credits: number }
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

const periodLabel: Record<string, string> = {
  weekly: '每周',
  monthly: '每月',
}

export function MemberList({ teamId }: { teamId: string }) {
  const { data, error, mutate } = useSWR<TeamData>(`/teams/${teamId}`)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [quotaValue, setQuotaValue] = useState('')
  const [periodValue, setPeriodValue] = useState<string>('none')

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

  async function handleUpdateQuota() {
    if (!editingMember) return
    const quota = quotaValue === '' ? null : parseInt(quotaValue, 10)
    const period = periodValue === 'none' ? null : periodValue
    try {
      await apiPatch(`/teams/${teamId}/members/${editingMember.user_id}`, {
        credit_quota: quota,
        quota_period: period,
      })
      toast.success('配额已更新')
      setEditingMember(null)
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    }
  }

  async function handleResetCredits(member: Member) {
    if (!confirm(`确定要重置 ${member.username} 的已用积分吗？`)) return
    try {
      await apiPost(`/teams/${teamId}/members/${member.user_id}/reset-credits`, {})
      toast.success(`${member.username} 的已用积分已重置为 0`)
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重置失败')
    }
  }

  async function handleRemoveMember(member: Member) {
    if (!confirm(`确定要移除 ${member.username} 吗？`)) return
    try {
      await apiDelete(`/teams/${teamId}/members/${member.user_id}`)
      toast.success('成员已移除')
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  function formatResetInfo(member: Member): string | null {
    if (!member.quota_period) return null
    const label = periodLabel[member.quota_period] ?? member.quota_period
    if (member.quota_reset_at) {
      const d = new Date(member.quota_reset_at)
      return `${label}重置 · 下次 ${d.getMonth() + 1}/${d.getDate()}`
    }
    return `${label}重置`
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">成员列表</CardTitle>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            邀请成员
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">用户名</th>
                  <th className="text-left py-2 px-2 font-medium">账户</th>
                  <th className="text-left py-2 px-2 font-medium">角色</th>
                  <th className="text-right py-2 px-2 font-medium">配额</th>
                  <th className="text-right py-2 px-2 font-medium">已用 / 剩余</th>
                  <th className="text-right py-2 px-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.members.map((member) => {
                  const remaining = member.credit_quota !== null
                    ? Math.max(0, member.credit_quota - member.credit_used)
                    : null
                  const nearLimit = member.credit_quota !== null && remaining !== null && remaining <= 0
                  const resetInfo = formatResetInfo(member)

                  return (
                    <tr key={member.user_id} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{member.username}</td>
                      <td className="py-2 px-2 text-muted-foreground">{member.account}</td>
                      <td className="py-2 px-2">
                        <Badge variant={roleBadgeVariant[member.role as keyof typeof roleBadgeVariant] ?? 'outline'}>
                          {roleLabel[member.role] ?? member.role}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div>
                          {member.credit_quota === null ? '无限制' : member.credit_quota.toLocaleString()}
                        </div>
                        {resetInfo && (
                          <div className="text-[10px] text-muted-foreground">{resetInfo}</div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={nearLimit ? 'text-destructive font-medium' : ''}>
                          {member.credit_used.toLocaleString()}
                        </span>
                        {remaining !== null && (
                          <span className="text-muted-foreground"> / {remaining.toLocaleString()}</span>
                        )}
                        {nearLimit && (
                          <div className="text-[10px] text-destructive">已达上限</div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {member.role !== 'owner' && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="编辑配额"
                              onClick={() => {
                                setEditingMember(member)
                                setQuotaValue(member.credit_quota?.toString() ?? '')
                                setPeriodValue(member.quota_period ?? 'none')
                              }}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {member.credit_used > 0 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="重置已用积分"
                                onClick={() => handleResetCredits(member)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
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

      {/* Edit Quota Dialog */}
      <Dialog
        open={!!editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑配额 — {editingMember?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">积分额度上限</label>
              <Input
                type="number"
                placeholder="留空为无限制"
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                成员在一个周期内最多可使用的积分数。留空表示不限制（受团队总余额约束）。
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">重置周期</label>
              <Select value={periodValue} onValueChange={setPeriodValue}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不自动重置</SelectItem>
                  <SelectItem value="weekly">每周自动重置</SelectItem>
                  <SelectItem value="monthly">每月自动重置</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                自动重置会在周期到期时将"已用积分"清零。不影响团队总余额。
              </p>
            </div>
            {editingMember && editingMember.credit_used > 0 && (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                当前已用: <span className="font-medium">{editingMember.credit_used.toLocaleString()}</span>
                {editingMember.credit_quota !== null && (
                  <span className="text-muted-foreground"> / {editingMember.credit_quota.toLocaleString()}</span>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingMember(null)}>取消</Button>
            <Button onClick={handleUpdateQuota}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Dialog */}
      <InviteDialog
        teamId={teamId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => mutate()}
      />
    </>
  )
}
