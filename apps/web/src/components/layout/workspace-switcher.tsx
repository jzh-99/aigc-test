'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Building2, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { apiPost } from '@/lib/api-client'
import { toast } from 'sonner'
import type { UserProfile, BizMgmtMemberAccount } from '@aigc/types'

interface WorkspaceSwitcherProps {
  collapsed?: boolean
}

export function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const { user, activeTeamId, activeWorkspaceId, setActiveTeam, setActiveWorkspace, updateUser, setActiveBizMgmtMember } = useAuthStore()

  const activeTeam = useAuthStore((s) => s.activeTeam())
  const activeWorkspace = useAuthStore((s) => s.activeWorkspace())

  if (!user || user.teams.length === 0) return null

  // 业管硬切换后：每个 team 对应一个业管公司账户（biz_mgmt_member_bindings 有 binding）。
  // 切换菜单只展示有业管绑定的 team——无 binding 的 team（如历史个人空间）不对应任何公司账户，
  // 切过去查不到业管余额/流水，不该出现在切换入口。
  const bizMgmtMembers = (user.bizMgmtMembers ?? user.biz_mgmt_members ?? []) as Array<BizMgmtMemberAccount>
  // teamId → 业管身份映射，用于切 team 时联动 select-biz-mgmt-member（切公司账户）
  const bindingByTeamId = new Map<string, BizMgmtMemberAccount>()
  for (const m of bizMgmtMembers) {
    const tid = m.teamId ?? m.team_id
    if (tid) bindingByTeamId.set(tid, m)
  }
  const switchableTeams = user.teams.filter((t) => bindingByTeamId.has(t.id))

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-2">
        <div className="h-8 w-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
          <Building2 className="h-4 w-4 text-accent-blue" />
        </div>
      </div>
    )
  }

  // 切 team = 切公司账户：联动业管身份切换。
  // 调 /auth/select-biz-mgmt-member 让后端把 is_selected 切到该团队对应的 binding，
  // 返回最新 profile（含新身份的 teams/bizMgmtMembers）后 updateUser，余额/流水自动跟着变。
  // 同 team 内切工作区不触发此联动（账户不变，只切创作隔离空间）。
  async function handleSwitchTeam(teamId: string) {
    const targetMember = bindingByTeamId.get(teamId)
    if (!targetMember) return
    const targetBizMgmtUserId = targetMember.bizMgmtUserId ?? targetMember.biz_mgmt_user_id
    if (!targetBizMgmtUserId) return

    // 已经是该身份：纯前端切换 team/workspace 即可，无需调后端
    const currentBizMgmtUserId = useAuthStore.getState().currentBizMgmtUserId
    if (currentBizMgmtUserId === targetBizMgmtUserId) {
      setActiveTeam(teamId)
      return
    }

    setSwitching(true)
    try {
      const res = await apiPost<{ user: UserProfile }>('/auth/select-biz-mgmt-member', {
        biz_mgmt_user_id: targetBizMgmtUserId,
      })
      updateUser(res.user)
      const selected =
        res.user.bizMgmtMembers?.find((m) => m.isSelected) ??
        res.user.biz_mgmt_members?.find((m) => m.is_selected)
      if (selected) setActiveBizMgmtMember(selected)
    } catch {
      toast.error('切换业管身份失败，请稍后重试')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-3 h-auto py-2 text-left"
          disabled={switching}
        >
          <div className="flex flex-col items-start truncate">
            <span className="text-xs text-muted-foreground truncate w-full">
              {activeTeam?.name ?? '选择团队'}
            </span>
            <span className="text-sm font-medium truncate w-full">
              {activeWorkspace?.name ?? '选择工作区'}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 max-h-[400px] overflow-y-auto" align="start">
        {switchableTeams.map((team) => (
          <div key={team.id} className="mb-2 last:mb-0">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3 w-3" />
              {team.name}
            </div>
            {team.workspaces.map((ws) => (
              <button
                key={ws.id}
                disabled={switching}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50',
                  activeWorkspaceId === ws.id && 'bg-muted font-medium'
                )}
                onClick={() => {
                  // 切 team（跨公司账户）联动业管身份；同 team 内切工作区只 setActiveWorkspace
                  if (activeTeamId !== team.id) {
                    void handleSwitchTeam(team.id)
                  }
                  setActiveWorkspace(ws.id)
                  setOpen(false)
                }}
              >
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{ws.name}</span>
                {activeWorkspaceId === ws.id && (
                  <Check className="ml-auto h-3.5 w-3.5 text-accent-blue" />
                )}
              </button>
            ))}
          </div>
        ))}
        {switchableTeams.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground text-center">暂无可切换的业管账户</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
