'use client'

import { create } from 'zustand'
import type { UserProfile, UserTeam, UserWorkspace, BizMgmtMemberAccount } from '@aigc/types'

interface AuthState {
  user: UserProfile | null
  accessToken: string | null
  activeTeamId: string | null
  activeWorkspaceId: string | null
  // 当前选中的业管会员 ID；无业管身份或未选择时为 null
  currentBizMgmtUserId: string | null
  isInitialized: boolean
  isRefreshing: boolean

  // Computed
  activeTeam: () => UserTeam | null
  activeWorkspace: () => UserWorkspace | null
  activeBizMgmtMember: () => BizMgmtMemberAccount | null

  // Actions
  setAuth: (user: UserProfile, token: string) => void
  clearAuth: () => void
  setActiveTeam: (teamId: string) => void
  setActiveWorkspace: (workspaceId: string) => void
  // 选择业管身份后同步切换 team/workspace 到该身份对应范围
  setActiveBizMgmtMember: (member: BizMgmtMemberAccount) => void
  updateUser: (user: UserProfile) => void
  setInitialized: () => void
  setIsRefreshing: (isRefreshing: boolean) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  activeTeamId: null,
  activeWorkspaceId: null,
  currentBizMgmtUserId: null,
  isInitialized: false,
  isRefreshing: false,

  activeTeam: () => {
    const { user, activeTeamId } = get()
    if (!user || !activeTeamId) return null
    return user.teams.find((t) => t.id === activeTeamId) ?? null
  },

  activeWorkspace: () => {
    const team = get().activeTeam()
    const wsId = get().activeWorkspaceId
    if (!team || !wsId) return null
    return team.workspaces.find((w) => w.id === wsId) ?? null
  },

  activeBizMgmtMember: () => {
    const { user, currentBizMgmtUserId } = get()
    if (!user) return null
    // 同时兼容 camelCase / snake_case，避免后端字段风格变化导致取不到
    const members = user.bizMgmtMembers ?? user.biz_mgmt_members ?? []
    if (!currentBizMgmtUserId) return null
    return members.find((m) => (m.bizMgmtUserId ?? m.biz_mgmt_user_id) === currentBizMgmtUserId) ?? null
  },

  setAuth: (user, token) => {
    // 优先用已选中的业管身份定位 team/workspace；无选中身份时回退到第一个团队
    const selectedMember =
      user.bizMgmtMembers?.find((m) => m.isSelected) ?? user.biz_mgmt_members?.find((m) => m.is_selected)
    const firstTeam = selectedMember
      ? user.teams.find((t) => t.id === (selectedMember.teamId ?? selectedMember.team_id))
      : user.teams[0]
    const firstWs = selectedMember
      ? firstTeam?.workspaces.find((w) => w.id === (selectedMember.workspaceId ?? selectedMember.workspace_id))
      : firstTeam?.workspaces[0]
    set({
      user,
      accessToken: token,
      currentBizMgmtUserId: selectedMember ? (selectedMember.bizMgmtUserId ?? selectedMember.biz_mgmt_user_id) : null,
      activeTeamId: firstTeam?.id ?? null,
      activeWorkspaceId: firstWs?.id ?? null,
      isInitialized: true,
      isRefreshing: false,
    })
  },

  clearAuth: () => set({
    user: null,
    accessToken: null,
    activeTeamId: null,
    activeWorkspaceId: null,
    currentBizMgmtUserId: null,
    isInitialized: true,
    isRefreshing: false,
  }),

  setActiveTeam: (teamId) => {
    const { user } = get()
    const team = user?.teams.find((t) => t.id === teamId)
    const firstWs = team?.workspaces[0]
    set({
      activeTeamId: teamId,
      activeWorkspaceId: firstWs?.id ?? null,
    })
  },

  setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),

  // 选择业管身份：同步切换 team/workspace 到该身份对应范围
  setActiveBizMgmtMember: (member) => set({
    currentBizMgmtUserId: member.bizMgmtUserId ?? member.biz_mgmt_user_id,
    activeTeamId: member.teamId ?? member.team_id,
    activeWorkspaceId: member.workspaceId ?? member.workspace_id,
  }),

  updateUser: (user) => set({ user }),

  setInitialized: () => set({ isInitialized: true }),

  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
}))
