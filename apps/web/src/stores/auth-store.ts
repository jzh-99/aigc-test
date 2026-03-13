'use client'

import { create } from 'zustand'
import type { UserProfile, UserTeam, UserWorkspace } from '@aigc/types'

interface AuthState {
  user: UserProfile | null
  accessToken: string | null
  activeTeamId: string | null
  activeWorkspaceId: string | null
  isInitialized: boolean

  // Computed
  activeTeam: () => UserTeam | null
  activeWorkspace: () => UserWorkspace | null

  // Actions
  setAuth: (user: UserProfile, token: string) => void
  clearAuth: () => void
  setActiveTeam: (teamId: string) => void
  setActiveWorkspace: (workspaceId: string) => void
  updateUser: (user: UserProfile) => void
  setInitialized: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  activeTeamId: null,
  activeWorkspaceId: null,
  isInitialized: false,

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

  setAuth: (user, token) => {
    const firstTeam = user.teams[0]
    const firstWs = firstTeam?.workspaces[0]
    set({
      user,
      accessToken: token,
      activeTeamId: firstTeam?.id ?? null,
      activeWorkspaceId: firstWs?.id ?? null,
      isInitialized: true,
    })
  },

  clearAuth: () => set({
    user: null,
    accessToken: null,
    activeTeamId: null,
    activeWorkspaceId: null,
    isInitialized: true,
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

  updateUser: (user) => set({ user }),

  setInitialized: () => set({ isInitialized: true }),
}))
