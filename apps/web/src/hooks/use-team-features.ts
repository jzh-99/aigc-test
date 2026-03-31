import { useAuthStore } from '@/stores/auth-store'

export function useTeamFeatures() {
  const activeTeam = useAuthStore((s) => s.activeTeam)
  const isCompanyA = activeTeam()?.team_type === 'company_a'

  return {
    isCompanyA,
    showVideoTab: !isCompanyA,
    showAvatarTab: activeTeam()?.team_type === 'avatar_enabled',
    showActionImitationTab: activeTeam()?.team_type === 'avatar_enabled',
  }
}
