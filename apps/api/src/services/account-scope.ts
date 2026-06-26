import type { Database } from '@aigc/db'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'

export const PERSONAL_TEAM_TYPE = 'personal'
export type AccountScopeType = 'personal' | 'team'

type DbLike = Kysely<Database> | Transaction<Database>

interface PersonalTeamRow {
  id: string
  name: string
}

async function findPersonalTeam(db: DbLike, userId: string): Promise<PersonalTeamRow | undefined> {
  return db
    .selectFrom('teams')
    .select(['id', 'name'])
    .where('owner_id', '=', userId)
    .where('team_type', '=', PERSONAL_TEAM_TYPE)
    .where('is_deleted', '=', false)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()
}

async function ensureTeamMemberOwner(db: DbLike, teamId: string, userId: string) {
  const member = await db
    .selectFrom('team_members')
    .select('role')
    .where('team_id', '=', teamId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!member) {
    await db.insertInto('team_members').values({ team_id: teamId, user_id: userId, role: 'owner' }).execute()
    return
  }

  if (member.role !== 'owner') {
    await db
      .updateTable('team_members')
      .set({ role: 'owner' })
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .execute()
  }
}

async function ensureDefaultWorkspace(db: DbLike, teamId: string, userId: string) {
  const existingWorkspace = await db
    .selectFrom('workspaces')
    .select(['id', 'name'])
    .where('team_id', '=', teamId)
    .where('is_deleted', '=', false)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (existingWorkspace) return existingWorkspace

  return db
    .insertInto('workspaces')
    .values({ team_id: teamId, name: '默认工作区', created_by: userId })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()
}

async function ensureWorkspaceMemberAdmin(db: DbLike, workspaceId: string, userId: string) {
  const member = await db
    .selectFrom('workspace_members')
    .select('role')
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  if (!member) {
    await db
      .insertInto('workspace_members')
      .values({ workspace_id: workspaceId, user_id: userId, role: 'admin' })
      .onConflict((oc) => oc.columns(['workspace_id', 'user_id']).doNothing())
      .execute()
    return
  }

  if (member.role !== 'admin') {
    await db
      .updateTable('workspace_members')
      .set({ role: 'admin' })
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .execute()
  }
}

export async function ensurePersonalAccountScope(db: Kysely<Database>, userId: string) {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`.execute(trx)

    let team = await findPersonalTeam(trx, userId)
    if (!team) {
      const user = await trx
        .selectFrom('users')
        .select('username')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow()

      team = await trx
        .insertInto('teams')
        .values({
          name: `${user.username}的个人空间`,
          owner_id: userId,
          plan_tier: 'free',
          team_type: PERSONAL_TEAM_TYPE,
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow()
    }

    await ensureTeamMemberOwner(trx, team.id, userId)
    const workspace = await ensureDefaultWorkspace(trx, team.id, userId)
    await ensureWorkspaceMemberAdmin(trx, workspace.id, userId)

    return { team, workspace }
  })
}

export function resolveAccountScope(teamType: string | null | undefined): AccountScopeType {
  return teamType === PERSONAL_TEAM_TYPE ? 'personal' : 'team'
}
