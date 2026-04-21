'use client'

import { useState } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TopupDialog } from './topup-dialog'
import { AdminPasswordDialog } from './admin-password-dialog'
import { TrashDrawer } from './trash-drawer'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Coins, ChevronDown, ChevronRight, Users, FolderOpen,
  Image as ImageIcon, Loader2, Trash2, KeyRound, Trash,
  Edit2, RotateCcw, Check, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, apiDelete, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'

interface Team {
  id: string
  name: string
  owner_id: string
  owner_username: string | null
  plan_tier: string
  team_type: 'standard' | 'company_a' | 'avatar_enabled'
  created_at: string
  balance: number
  frozen_credits: number
  total_earned: number
  total_spent: number
  lifetime_used: number
  member_count: number
  workspace_count: number
  allow_member_topup: boolean
}

interface TeamMember {
  id: string
  username: string
  account: string
  role: string
  credit_quota: number | null
  credit_used: number
  joined_at: string
}

interface TeamWorkspace {
  id: string
  name: string
  created_at: string
  member_count: number
  batch_total: number
  batch_completed: number
  batch_failed: number
}

interface WsBatch {
  id: string
  prompt: string
  status: string
  quantity: number
  completed_count: number
  failed_count: number
  estimated_credits: number
  actual_credits: number
  created_at: string
  thumbnail_urls: string[]
  user?: { id: string; username: string }
}

const statusLabels: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'warning' | 'outline' | 'processing' }> = {
  pending: { label: '等待中', variant: 'outline' },
  processing: { label: '生成中', variant: 'processing' },
  completed: { label: '已完成', variant: 'success' },
  partial_complete: { label: '部分完成', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

export function TeamTable() {
  const { data, error, mutate } = useSWR<{ data: Team[] }>('/admin/teams')
  const [topupTeam, setTopupTeam] = useState<{ id: string; name: string; balance: number } | null>(null)
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [switchingTeamId, setSwitchingTeamId] = useState<string | null>(null)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)

  async function handleChangeType(team: Team, newType: 'standard' | 'company_a' | 'avatar_enabled') {
    if (newType === team.team_type) return
    setSwitchingTeamId(team.id)
    mutate(
      (prev) => prev
        ? { data: prev.data.map(t => t.id === team.id ? { ...t, team_type: newType } : t) }
        : prev,
      false
    )
    try {
      await apiPatch(`/admin/teams/${team.id}`, { team_type: newType })
    } catch (err) {
      mutate()
      toast.error(err instanceof ApiError ? err.message : '切换失败')
    } finally {
      setSwitchingTeamId(null)
    }
  }

  async function handleDeleteTeam(team: Team) {
    if (!confirm(`确定要删除团队"${team.name}"吗？\n\n团队及其工作区将被移入回收站，7天内可恢复。`)) return
    setDeletingTeamId(team.id)
    try {
      await apiDelete(`/admin/teams/${team.id}`)
      toast.success(`团队"${team.name}"已删除，可在回收站恢复`)
      mutate()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeletingTeamId(null)
    }
  }

  async function handleToggleMemberTopup(team: Team, val: boolean) {
    mutate(
      (prev) => prev
        ? { data: prev.data.map(t => t.id === team.id ? { ...t, allow_member_topup: val } : t) }
        : prev,
      false
    )
    try {
      await apiPatch(`/admin/teams/${team.id}`, { allow_member_topup: val })
    } catch (err) {
      mutate()
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    }
  }

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

  return (
    <>
      <div className="space-y-3">
        {data?.data.map((team) => (
          <Card key={team.id}>
            <CardContent className="p-0">
              {/* Team row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
              >
                {expandedTeam === team.id
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{team.name}</span>
                    {team.team_type === 'company_a' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-400 text-blue-600">省台</Badge>
                    )}
                    {team.team_type === 'avatar_enabled' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-purple-400 text-purple-600">专业版</Badge>
                    )}
                    {team.owner_username && (
                      <span className="text-xs text-muted-foreground">组长: {team.owner_username}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{team.member_count} 成员</span>
                    <span className="inline-flex items-center gap-1"><FolderOpen className="h-3 w-3" />{team.workspace_count} 工作区</span>
                    <span>余额: <span className="font-medium text-foreground">{team.balance.toLocaleString()}</span></span>
                    {team.frozen_credits > 0 && <span>冻结: {team.frozen_credits}</span>}
                    <span>累计已用: {team.lifetime_used.toLocaleString()}</span>
                  </div>
                </div>
                <Select
                  value={team.team_type}
                  onValueChange={(v) => handleChangeType(team, v as 'standard' | 'company_a' | 'avatar_enabled')}
                  disabled={switchingTeamId === team.id}
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs" onClick={(e) => e.stopPropagation()}>
                    {switchingTeamId === team.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <SelectValue />
                    }
                  </SelectTrigger>
                  <SelectContent onClick={(e) => e.stopPropagation()}>
                    <SelectItem value="standard" className="text-xs">标准版</SelectItem>
                    <SelectItem value="company_a" className="text-xs">省台版</SelectItem>
                    <SelectItem value="avatar_enabled" className="text-xs">专业版</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setTopupTeam({ id: team.id, name: team.name, balance: team.balance }) }}>
                  <Coins className="h-3.5 w-3.5 mr-1" />
                  调整积分
                </Button>
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-muted-foreground">成员充值</span>
                  <Switch
                    checked={team.allow_member_topup ?? false}
                    onCheckedChange={(val) => handleToggleMemberTopup(team, val)}
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  title="删除团队"
                  disabled={deletingTeamId === team.id}
                  onClick={(e) => { e.stopPropagation(); handleDeleteTeam(team) }}
                >
                  {deletingTeamId === team.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>

              {/* Expanded content */}
              {expandedTeam === team.id && (
                <TeamExpanded teamId={team.id} ownerId={team.owner_id} onPasswordChange={(uid) => setPasswordUserId(uid)} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Floating trash button */}
      <Button
        variant="outline"
        size="sm"
        className="fixed bottom-6 right-6 gap-2 shadow-md"
        onClick={() => setTrashOpen(true)}
      >
        <Trash className="h-4 w-4" />
        回收站
      </Button>

      <TopupDialog
        teamId={topupTeam?.id ?? null}
        teamName={topupTeam?.name}
        currentBalance={topupTeam?.balance}
        open={!!topupTeam}
        onOpenChange={(open) => !open && setTopupTeam(null)}
        onSuccess={() => mutate()}
      />

      <AdminPasswordDialog
        userId={passwordUserId}
        open={!!passwordUserId}
        onOpenChange={(open) => !open && setPasswordUserId(null)}
      />

      <TrashDrawer
        open={trashOpen}
        onOpenChange={setTrashOpen}
        onRestored={() => mutate()}
      />
    </>
  )
}

function TeamExpanded({ teamId, ownerId, onPasswordChange }: { teamId: string; ownerId: string; onPasswordChange: (uid: string) => void }) {
  const [activeTab, setActiveTab] = useState<'members' | 'workspaces'>('members')

  return (
    <div className="border-t">
      <div className="flex gap-1 px-4 pt-2">
        <button
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors',
            activeTab === 'members' ? 'border-accent-blue text-accent-blue' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('members')}
        >
          <Users className="h-3 w-3 inline mr-1" />成员
        </button>
        <button
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors',
            activeTab === 'workspaces' ? 'border-accent-blue text-accent-blue' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('workspaces')}
        >
          <FolderOpen className="h-3 w-3 inline mr-1" />工作区
        </button>
      </div>
      <div className="px-4 pb-4">
        {activeTab === 'members' && <TeamMembers teamId={teamId} onPasswordChange={onPasswordChange} />}
        {activeTab === 'workspaces' && <TeamWorkspaces teamId={teamId} />}
      </div>
    </div>
  )
}

function TeamMembers({ teamId, onPasswordChange }: { teamId: string; onPasswordChange: (uid: string) => void }) {
  const { data, error, mutate } = useSWR<{ data: TeamMember[] }>(`/admin/teams/${teamId}/members`)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [quotaValue, setQuotaValue] = useState('')
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [resettingId, setResettingId] = useState<string | null>(null)

  if (!data && !error) return <Skeleton className="h-20 w-full mt-2" />

  const members = data?.data ?? []
  if (members.length === 0) return <p className="text-sm text-muted-foreground py-3">暂无成员</p>

  function openEdit(m: TeamMember) {
    setEditingMember(m)
    setQuotaValue(m.credit_quota !== null && m.credit_quota !== undefined ? String(m.credit_quota) : '')
  }

  async function handleSaveQuota() {
    if (!editingMember) return
    setQuotaSaving(true)
    try {
      const quota = quotaValue.trim() === '' ? null : Number(quotaValue)
      if (quotaValue.trim() !== '' && (isNaN(quota!) || quota! < 0)) {
        toast.error('请输入有效的积分上限（正整数或留空表示无限）')
        return
      }
      await apiPatch(`/admin/teams/${teamId}/members/${editingMember.id}`, { credit_quota: quota })
      toast.success('积分上限已更新')
      setEditingMember(null)
      setTimeout(() => mutate(), 300)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    } finally {
      setQuotaSaving(false)
    }
  }

  async function handleResetUsage(m: TeamMember) {
    if (!confirm(`确定要将「${m.username}」的用量重置为 0 吗？`)) return
    setResettingId(m.id)
    try {
      await apiPost(`/admin/teams/${teamId}/members/${m.id}/reset-credits`, {})
      toast.success(`已重置 ${m.username} 的用量`)
      setTimeout(() => mutate(), 300)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重置失败')
    } finally {
      setResettingId(null)
    }
  }

  return (
    <>
      <table className="w-full text-xs mt-2">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="text-left py-2 px-2 font-medium">用户名</th>
            <th className="text-left py-2 px-2 font-medium">账户</th>
            <th className="text-left py-2 px-2 font-medium">角色</th>
            <th className="text-right py-2 px-2 font-medium">已用积分</th>
            <th className="text-right py-2 px-2 font-medium">积分上限</th>
            <th className="text-left py-2 px-2 font-medium">加入时间</th>
            <th className="text-right py-2 px-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="py-2 px-2 font-medium">{m.username}</td>
              <td className="py-2 px-2 text-muted-foreground">{m.account}</td>
              <td className="py-2 px-2">
                <Badge variant={m.role === 'owner' ? 'default' : 'outline'} className="text-[10px]">
                  {m.role === 'owner' ? '组长' : m.role === 'editor' ? '编辑' : m.role}
                </Badge>
              </td>
              <td className="py-2 px-2 text-right font-medium">{(m.credit_used ?? 0).toLocaleString()}</td>
              <td className="py-2 px-2 text-right text-muted-foreground">
                {m.credit_quota !== null && m.credit_quota !== undefined ? m.credit_quota.toLocaleString() : '无限'}
              </td>
              <td className="py-2 px-2 text-muted-foreground">
                {new Date(m.joined_at).toLocaleDateString('zh-CN')}
              </td>
              <td className="py-2 px-2 text-right">
                <div className="flex items-center justify-end gap-0.5">
                  {/* 修改积分上限 */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="修改积分上限"
                    onClick={() => openEdit(m)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  {/* 刷新用量（重置 credit_used） */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="刷新用量（重置已用积分为0）"
                    disabled={resettingId === m.id}
                    onClick={() => handleResetUsage(m)}
                  >
                    {resettingId === m.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RotateCcw className="h-3 w-3" />
                    }
                  </Button>
                  {/* 修改密码 */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="修改密码"
                    onClick={() => onPasswordChange(m.id)}
                  >
                    <KeyRound className="h-3 w-3" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 修改积分上限 Dialog */}
      <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>修改积分上限</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              成员：<span className="font-medium text-foreground">{editingMember?.username}</span>
              （当前已用：{(editingMember?.credit_used ?? 0).toLocaleString()}）
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">积分上限（留空表示无限制）</label>
              <Input
                type="number"
                min={0}
                placeholder="留空 = 无限制"
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveQuota()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMember(null)}>取消</Button>
            <Button onClick={handleSaveQuota} disabled={quotaSaving}>
              {quotaSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TeamWorkspaces({ teamId }: { teamId: string }) {
  const { data, error } = useSWR<{ data: TeamWorkspace[] }>(`/admin/teams/${teamId}/workspaces`)
  const [expandedWs, setExpandedWs] = useState<string | null>(null)

  if (!data && !error) return <Skeleton className="h-20 w-full mt-2" />

  const workspaces = data?.data ?? []
  if (workspaces.length === 0) return <p className="text-sm text-muted-foreground py-3">暂无工作区</p>

  return (
    <div className="space-y-2 mt-2">
      {workspaces.map((ws) => (
        <div key={ws.id} className="border rounded-md">
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => setExpandedWs(expandedWs === ws.id ? null : ws.id)}
          >
            {expandedWs === ws.id
              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground" />
            }
            <span className="text-sm font-medium">{ws.name}</span>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">{ws.member_count} 成员</span>
            <span className="text-xs text-muted-foreground">{ws.batch_total} 次生成</span>
            {ws.batch_completed > 0 && (
              <Badge variant="success" className="text-[10px]">{ws.batch_completed} 完成</Badge>
            )}
            {ws.batch_failed > 0 && (
              <Badge variant="destructive" className="text-[10px]">{ws.batch_failed} 失败</Badge>
            )}
          </div>
          {expandedWs === ws.id && (
            <WorkspaceBatches workspaceId={ws.id} />
          )}
        </div>
      ))}
    </div>
  )
}

function WorkspaceBatches({ workspaceId }: { workspaceId: string }) {
  const { data, error } = useSWR<{ data: WsBatch[]; cursor: string | null }>(`/admin/workspaces/${workspaceId}/batches?limit=20`)

  if (!data && !error) return <Skeleton className="h-16 w-full mx-3 mb-3" />

  const batches = data?.data ?? []
  if (batches.length === 0) return <p className="text-xs text-muted-foreground px-3 pb-3">暂无生成记录</p>

  return (
    <div className="border-t px-3 pb-3 space-y-2 pt-2">
      {batches.map((b) => {
        const status = statusLabels[b.status] ?? statusLabels.pending
        const time = new Date(b.created_at)
        return (
          <div key={b.id} className="flex items-start gap-2 text-xs">
            {/* Thumbnail */}
            {b.thumbnail_urls.length > 0 ? (
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
                <Image src={b.thumbnail_urls[0]} alt="" fill className="object-cover" sizes="40px" unoptimized />
              </div>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs">{b.prompt}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={status.variant} className="text-[9px] px-1 py-0">{status.label}</Badge>
                <span className="text-muted-foreground">{b.completed_count}/{b.quantity}</span>
                {b.user && <span className="text-muted-foreground">by {b.user.username}</span>}
                <span className="text-muted-foreground">
                  {time.toLocaleDateString('zh-CN')} {time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
            <span className="text-muted-foreground shrink-0">{b.actual_credits || b.estimated_credits} 积分</span>
          </div>
        )
      })}
    </div>
  )
}
