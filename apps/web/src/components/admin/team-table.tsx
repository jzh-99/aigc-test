'use client'

import { useState } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TopupDialog } from './topup-dialog'
import {
  Coins, ChevronDown, ChevronRight, Users, FolderOpen,
  Image as ImageIcon, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiPatch } from '@/lib/api-client'

interface Team {
  id: string
  name: string
  owner_id: string
  owner_username: string | null
  plan_tier: string
  team_type: 'standard' | 'company_a'
  created_at: string
  balance: number
  frozen_credits: number
  total_earned: number
  total_spent: number
  lifetime_used: number
  member_count: number
  workspace_count: number
}

interface TeamMember {
  id: string
  username: string
  email: string
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

  async function handleSwitchType(team: Team) {
    const newType = team.team_type === 'company_a' ? 'standard' : 'company_a'
    setSwitchingTeamId(team.id)
    try {
      await apiPatch(`/admin/teams/${team.id}`, { team_type: newType })
      mutate()
    } catch {
      // silently ignore
    } finally {
      setSwitchingTeamId(null)
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
                <Button size="sm" variant="outline" className="text-xs" onClick={(e) => { e.stopPropagation(); handleSwitchType(team) }} disabled={switchingTeamId === team.id}>
                  {switchingTeamId === team.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (team.team_type === 'company_a' ? '切换标准版' : '切换省台版')}
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setTopupTeam({ id: team.id, name: team.name, balance: team.balance }) }}>
                  <Coins className="h-3.5 w-3.5 mr-1" />
                  调整积分
                </Button>
              </div>

              {/* Expanded content */}
              {expandedTeam === team.id && (
                <TeamExpanded teamId={team.id} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <TopupDialog
        teamId={topupTeam?.id ?? null}
        teamName={topupTeam?.name}
        currentBalance={topupTeam?.balance}
        open={!!topupTeam}
        onOpenChange={(open) => !open && setTopupTeam(null)}
        onSuccess={() => mutate()}
      />
    </>
  )
}

function TeamExpanded({ teamId }: { teamId: string }) {
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
        {activeTab === 'members' && <TeamMembers teamId={teamId} />}
        {activeTab === 'workspaces' && <TeamWorkspaces teamId={teamId} />}
      </div>
    </div>
  )
}

function TeamMembers({ teamId }: { teamId: string }) {
  const { data, error } = useSWR<{ data: TeamMember[] }>(`/admin/teams/${teamId}/members`)

  if (!data && !error) return <Skeleton className="h-20 w-full mt-2" />

  const members = data?.data ?? []
  if (members.length === 0) return <p className="text-sm text-muted-foreground py-3">暂无成员</p>

  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="text-left py-2 px-2 font-medium">用户名</th>
          <th className="text-left py-2 px-2 font-medium">邮箱</th>
          <th className="text-left py-2 px-2 font-medium">角色</th>
          <th className="text-right py-2 px-2 font-medium">已用积分</th>
          <th className="text-right py-2 px-2 font-medium">配额</th>
          <th className="text-left py-2 px-2 font-medium">加入时间</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.id} className="border-b last:border-0">
            <td className="py-2 px-2 font-medium">{m.username}</td>
            <td className="py-2 px-2 text-muted-foreground">{m.email}</td>
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
          </tr>
        ))}
      </tbody>
    </table>
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
