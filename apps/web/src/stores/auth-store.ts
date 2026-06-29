'use client'

import { create } from 'zustand'
import { mutate } from 'swr'
import type { UserProfile, UserTeam, UserWorkspace, BizMgmtMemberAccount } from '@aigc/types'

// 用户手动切换的团队/工作区持久化 key。刷新页面后从 localStorage 恢复，
// 让用户回到上次手动选择的工作区，而不是每次都回到业管身份默认工作区。
const ACTIVE_WORKSPACE_STORAGE_KEY = 'aigc-active-workspace'

interface PersistedActiveWorkspace {
  teamId: string | null
  workspaceId: string | null
}

/** 读取持久化的团队/工作区（SSR 安全：window 不存在时返回 null）。 */
function loadPersistedActiveWorkspace(): PersistedActiveWorkspace | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedActiveWorkspace
    if (parsed && typeof parsed === 'object' && 'teamId' in parsed && 'workspaceId' in parsed) {
      return parsed
    }
  } catch {
    // localStorage 损坏或被禁用，忽略，回退到默认行为
  }
  return null
}

/** 持久化团队/工作区（SSR 安全 + 容错）。 */
function savePersistedActiveWorkspace(value: PersistedActiveWorkspace): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 写入失败（隐私模式/配额满）忽略，不影响内存切换
  }
}

/** 切换身份/工作区后，刷新所有依赖当前选中身份的 SWR 数据（余额等）。 */
function refreshIdentityDependentData(): void {
  // 余额 SWR key 与 useBizMgmtBalance 完全一致，直接 mutate 触发重取
  void mutate('/credits/biz-mgmt/balance')
}

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
    const fallbackTeam = selectedMember
      ? user.teams.find((t) => t.id === (selectedMember.teamId ?? selectedMember.team_id))
      : user.teams[0]
    const fallbackWs = selectedMember
      ? fallbackTeam?.workspaces.find((w) => w.id === (selectedMember.workspaceId ?? selectedMember.workspace_id))
      : fallbackTeam?.workspaces[0]

    // 优先恢复用户上次手动选择的工作区（localStorage）；校验它仍属于当前用户的可用团队，
    // 避免身份切换/团队被删后恢复到已失效的工作区。校验失败回退到业管身份默认工作区。
    const persisted = loadPersistedActiveWorkspace()
    const persistedTeam = persisted?.teamId ? user.teams.find((t) => t.id === persisted.teamId) : undefined
    const persistedWs = persisted?.workspaceId
      ? persistedTeam?.workspaces.find((w) => w.id === persisted.workspaceId)
      : undefined
    const activeTeamId = (persistedTeam?.id ?? fallbackTeam?.id) ?? null
    const activeWorkspaceId = (persistedWs?.id ?? fallbackWs?.id) ?? null

    set({
      user,
      accessToken: token,
      currentBizMgmtUserId: selectedMember ? (selectedMember.bizMgmtUserId ?? selectedMember.biz_mgmt_user_id) : null,
      activeTeamId,
      activeWorkspaceId,
      isInitialized: true,
      isRefreshing: false,
    })
  },

  clearAuth: () => {
    // 登出/清退时清除手动选择的工作区记忆，避免下个用户登录被前一个用户的选择带偏
    savePersistedActiveWorkspace({ teamId: null, workspaceId: null })
    set({
      user: null,
      accessToken: null,
      activeTeamId: null,
      activeWorkspaceId: null,
      currentBizMgmtUserId: null,
      isInitialized: true,
      isRefreshing: false,
    })
  },

  setActiveTeam: (teamId) => {
    const { user } = get()
    const team = user?.teams.find((t) => t.id === teamId)
    const firstWs = team?.workspaces[0]
    const nextWorkspaceId = firstWs?.id ?? null
    set({
      activeTeamId: teamId,
      activeWorkspaceId: nextWorkspaceId,
    })
    // 用户主动切换团队，持久化并刷新依赖当前身份的 SWR 数据
    savePersistedActiveWorkspace({ teamId, workspaceId: nextWorkspaceId })
    refreshIdentityDependentData()
  },

  setActiveWorkspace: (workspaceId) => {
    const teamId = get().activeTeamId
    set({ activeWorkspaceId: workspaceId })
    // 用户主动切换工作区，持久化；同团队下切换不影响团队级数据，但仍刷新工作区级 SWR
    savePersistedActiveWorkspace({ teamId, workspaceId })
    refreshIdentityDependentData()
  },

  // 选择业管身份：同步切换 team/workspace 到该身份对应范围
  // 身份切换会改变可见导航（主卡才显示团队/A豆管理）与余额数据源，必须刷新依赖 SWR
  setActiveBizMgmtMember: (member) => {
    const teamId = member.teamId ?? member.team_id
    const workspaceId = member.workspaceId ?? member.workspace_id
    set({
      currentBizMgmtUserId: member.bizMgmtUserId ?? member.biz_mgmt_user_id,
      activeTeamId: teamId,
      activeWorkspaceId: workspaceId,
    })
    // 身份切换后清空旧的「手动选择工作区」记忆，避免下次登录被旧身份的记忆带偏
    savePersistedActiveWorkspace({ teamId, workspaceId })
    refreshIdentityDependentData()
  },

  updateUser: (user) => set({ user }),

  setInitialized: () => set({ isInitialized: true }),

  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
}))
