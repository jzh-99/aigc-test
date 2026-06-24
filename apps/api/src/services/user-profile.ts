import { getDb } from '@aigc/db'
import { resolveAccountScope } from './account-scope.js'

export async function buildUserProfile(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'phone', 'username', 'avatar_url', 'role', 'password_change_required'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()

  const teamRows = await db
    .selectFrom('team_members')
    .innerJoin('teams', 'teams.id', 'team_members.team_id')
    .select(['teams.id as team_id', 'teams.name as team_name', 'teams.owner_id', 'teams.team_type', 'teams.allow_member_topup', 'team_members.role'])
    .where('team_members.user_id', '=', userId)
    .where('teams.is_deleted', '=', false)
    .execute()

  // Fetch owner info for each team
  const ownerIds = [...new Set(teamRows.map((t) => t.owner_id).filter(Boolean))]
  const ownerMap = new Map<string, { email: string | null; username: string }>()
  if (ownerIds.length > 0) {
    const owners = await db
      .selectFrom('users')
      .select(['id', 'email', 'username'])
      .where('id', 'in', ownerIds)
      .execute()
    for (const o of owners) ownerMap.set(o.id, { email: o.email, username: o.username })
  }

  // Fetch all workspace memberships in one query to avoid N+1
  const teamIds = teamRows.map((t) => t.team_id)
  let allWsRows: Array<{ ws_id: string; ws_name: string; role: string; team_id: string }> = []
  if (teamIds.length > 0) {
    allWsRows = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select([
        'workspaces.id as ws_id',
        'workspaces.name as ws_name',
        'workspace_members.role',
        'workspaces.team_id',
      ])
      .where('workspace_members.user_id', '=', userId)
      .where('workspaces.team_id', 'in', teamIds)
      .where('workspaces.is_deleted', '=', false)
      .execute()
  }

  // Group workspaces by team_id
  const wsByTeam = new Map<string, Array<{ id: string; name: string; role: string }>>()
  for (const w of allWsRows) {
    const list = wsByTeam.get(w.team_id) ?? []
    list.push({ id: w.ws_id, name: w.ws_name, role: w.role })
    wsByTeam.set(w.team_id, list)
  }

  const teams = teamRows.map((t) => {
    const teamType = String((t as any).team_type ?? 'standard')
    const accountScope = resolveAccountScope(teamType)

    return {
      id: t.team_id,
      name: t.team_name,
      role: t.role,
      team_type: teamType,
      account_scope: accountScope,
      accountScope,
      type: accountScope,
      allow_member_topup: (t as any).allow_member_topup ?? false,
      owner: ownerMap.get(t.owner_id) ?? null,
      workspaces: wsByTeam.get(t.team_id) ?? [],
    }
  })

  const accountScopes = teams.map((team) => ({
    id: team.id,
    team_id: team.id,
    teamId: team.id,
    name: team.name,
    role: team.role,
    type: team.type,
    account_scope: team.account_scope,
    accountScope: team.accountScope,
    team_type: team.team_type,
    workspaces: team.workspaces,
  }))
  const requireScopeSelection = accountScopes.length > 1

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    avatar_url: user.avatar_url,
    role: user.role,
    password_change_required: user.password_change_required,
    teams,
    account_scopes: accountScopes,
    accountScopes,
    require_scope_selection: requireScopeSelection,
    requireScopeSelection,
  }
}

export function buildAuthResponse(
  accessToken: string,
  profile: Awaited<ReturnType<typeof buildUserProfile>>,
) {
  return {
    access_token: accessToken,
    user: profile,
    account_scopes: profile.account_scopes,
    accountScopes: profile.accountScopes,
    require_scope_selection: profile.require_scope_selection,
    requireScopeSelection: profile.requireScopeSelection,
  }
}
