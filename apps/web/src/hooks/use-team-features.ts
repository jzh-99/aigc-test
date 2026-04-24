import { useAuthStore } from '@/stores/auth-store'

export function useTeamFeatures() {
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const teamType = activeTeam()?.team_type
  const isCompanyA = teamType === 'company_a'

  return {
    isCompanyA,
    showVideoTab: !isCompanyA,
    showAvatarTab: teamType === 'standard' || teamType === 'avatar_enabled',
    showActionImitationTab: teamType === 'standard' || teamType === 'avatar_enabled',
    showCanvasTab: teamType === 'avatar_enabled',
    showVideoStudioTab: teamType === 'avatar_enabled',
  }
}
