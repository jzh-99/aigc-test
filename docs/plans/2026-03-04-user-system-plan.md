# User System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement B2B multi-tenant user system with JWT auth, team/workspace data isolation, role-based access control, and admin management.

**Architecture:** JWT auth (access token in memory + refresh token in httpOnly cookie). Three guard middlewares (Admin, TeamRole, WorkspaceGuard) enforce RBAC at API layer. Frontend uses Zustand auth store with workspace context switcher. All generation data scoped to workspace_id.

**Tech Stack:** bcryptjs (password hashing), jsonwebtoken (JWT), Fastify hooks (guards), Zustand (auth state), Next.js route groups (auth vs dashboard)

---

## Task 1: Install Auth Dependencies

**Files:**
- Modify: `apps/api/package.json`

**Step 1: Install bcryptjs and jsonwebtoken**

Run:
```bash
cd apps/api && pnpm add bcryptjs jsonwebtoken && pnpm add -D @types/bcryptjs @types/jsonwebtoken
```

**Step 2: Verify imports work**

Create a quick smoke test:
```bash
cd apps/api && node -e "require('bcryptjs'); require('jsonwebtoken'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore: add bcryptjs and jsonwebtoken dependencies"
```

---

## Task 2: DB Migration — workspace_members Table + team_members Alter

**Files:**
- Create: `packages/db/migrations/009_workspace_members.ts`
- Modify: `packages/db/src/schema.ts` — add `WorkspaceMembersTable` interface

**Step 1: Write the migration**

```typescript
// packages/db/migrations/009_workspace_members.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. workspace_members table
  await db.schema
    .createTable('workspace_members')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('role', 'varchar(20)', (col) => col.notNull().defaultTo('editor'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`NOW()`)
    )
    .addUniqueConstraint('uq_workspace_members', ['workspace_id', 'user_id'])
    .execute()

  await sql`ALTER TABLE workspace_members ADD CONSTRAINT chk_ws_member_role CHECK (role IN ('admin','editor','viewer'))`.execute(db)

  await db.schema
    .createIndex('idx_ws_members_user')
    .on('workspace_members')
    .column('user_id')
    .execute()

  // 2. Add credit_quota and credit_used to team_members
  await db.schema
    .alterTable('team_members')
    .addColumn('credit_quota', 'integer')
    .execute()

  await db.schema
    .alterTable('team_members')
    .addColumn('credit_used', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('team_members').dropColumn('credit_used').execute()
  await db.schema.alterTable('team_members').dropColumn('credit_quota').execute()
  await db.schema.dropTable('workspace_members').execute()
}
```

**Step 2: Update schema.ts**

Add `WorkspaceMembersTable` interface and add `credit_quota`/`credit_used` to `TeamMembersTable` in `packages/db/src/schema.ts`. Also add `workspace_members` to the `Database` interface.

**Step 3: Run migration**

```bash
pnpm db:migrate
```
Expected: `Migration "009_workspace_members" executed successfully`

**Step 4: Commit**

```bash
git add packages/db/migrations/009_workspace_members.ts packages/db/src/schema.ts
git commit -m "feat: add workspace_members table and team_members quota columns"
```

---

## Task 3: Auth Types

**Files:**
- Modify: `packages/types/src/api.ts`
- Modify: `packages/types/src/db.ts`

**Step 1: Add auth types to api.ts**

```typescript
// Add to packages/types/src/api.ts

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  access_token: string
  user: UserProfile
}

export interface UserProfile {
  id: string
  email: string
  username: string
  avatar_url: string | null
  role: 'admin' | 'member'
  teams: UserTeam[]
}

export interface UserTeam {
  id: string
  name: string
  role: string  // team_members.role
  workspaces: UserWorkspace[]
}

export interface UserWorkspace {
  id: string
  name: string
  role: string  // workspace_members.role
}

export interface AcceptInviteRequest {
  token: string
  email: string
  password: string
  username: string
}

export interface InviteMemberRequest {
  email: string
  role?: string
}

export interface UpdateQuotaRequest {
  credit_quota: number | null
}

export interface TopUpCreditsRequest {
  amount: number
  description?: string
}

export interface CreateTeamRequest {
  name: string
  owner_email: string
  owner_username?: string
  owner_password?: string
  initial_credits?: number
}

export interface CreateWorkspaceRequest {
  name: string
  description?: string
}
```

**Step 2: Add role types to db.ts**

```typescript
// Add to packages/types/src/db.ts
export type UserRole = 'admin' | 'member'
export type TeamMemberRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type WorkspaceMemberRole = 'admin' | 'editor' | 'viewer'
```

**Step 3: Commit**

```bash
git add packages/types/src/api.ts packages/types/src/db.ts
git commit -m "feat: add auth and user management type definitions"
```

---

## Task 4: JWT Auth Plugin (Replace API Key)

**Files:**
- Create: `apps/api/src/plugins/jwt-auth.ts`
- Modify: `apps/api/src/app.ts` — swap `apiKeyPlugin` for `jwtAuthPlugin`

**Step 1: Create JWT auth plugin**

```typescript
// apps/api/src/plugins/jwt-auth.ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { getDb } from '@aigc/db'

// Public routes that skip auth
const PUBLIC_ROUTES = [
  '/api/v1/healthz',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/accept-invite',
]

export interface AuthUser {
  id: string
  email: string
  role: 'admin' | 'member'
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser
  }
}

export async function jwtAuthPlugin(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is required')

  app.decorateRequest('user', null)

  app.addHook('onRequest', async (request, reply) => {
    if (PUBLIC_ROUTES.some((r) => request.url.startsWith(r))) return

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Missing or invalid authorization header' },
      })
    }

    try {
      const token = authHeader.slice(7)
      const payload = jwt.verify(token, secret) as { sub: string; email: string; role: string }
      request.user = { id: payload.sub, email: payload.email, role: payload.role as 'admin' | 'member' }
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'Invalid or expired access token' },
      })
    }
  })
}
```

**Step 2: Update app.ts**

Replace `apiKeyPlugin` import/register with `jwtAuthPlugin`. Keep the old plugin file for reference but don't register it.

```typescript
// In apps/api/src/app.ts
import { jwtAuthPlugin } from './plugins/jwt-auth.js'
// ...
await app.register(jwtAuthPlugin) // replaces apiKeyPlugin
```

**Step 3: Verify build**

```bash
cd apps/api && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/api/src/plugins/jwt-auth.ts apps/api/src/app.ts
git commit -m "feat: replace API key auth with JWT auth plugin"
```

---

## Task 5: Guard Middlewares

**Files:**
- Create: `apps/api/src/plugins/guards.ts`

**Step 1: Implement guards**

```typescript
// apps/api/src/plugins/guards.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '@aigc/db'

const TEAM_ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 }
const WS_ROLE_RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }

export function adminGuard() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      })
    }
  }
}

export function teamRoleGuard(requiredRole: string) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    // Admin bypasses team role check
    if (request.user.role === 'admin') return

    const db = getDb()
    const membership = await db
      .selectFrom('team_members')
      .select('role')
      .where('team_id', '=', request.params.id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()

    if (!membership) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this team' },
      })
    }

    const userRank = TEAM_ROLE_RANK[membership.role] ?? -1
    const requiredRank = TEAM_ROLE_RANK[requiredRole] ?? 99
    if (userRank < requiredRank) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: `Requires team role: ${requiredRole}` },
      })
    }
  }
}

export function workspaceGuard(requiredRole: string) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (request.user.role === 'admin') return

    const db = getDb()
    const membership = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', request.params.id)
      .where('user_id', '=', request.user.id)
      .executeTakeFirst()

    if (!membership) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this workspace' },
      })
    }

    const userRank = WS_ROLE_RANK[membership.role] ?? -1
    const requiredRank = WS_ROLE_RANK[requiredRole] ?? 99
    if (userRank < requiredRank) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: `Requires workspace role: ${requiredRole}` },
      })
    }
  }
}
```

**Step 2: Verify build**

```bash
cd apps/api && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/api/src/plugins/guards.ts
git commit -m "feat: add AdminGuard, TeamRoleGuard, and WorkspaceGuard middlewares"
```

---

## Task 6: Auth Routes (login, refresh, logout, accept-invite)

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts` — register authRoutes

**Step 1: Implement auth routes**

```typescript
// apps/api/src/routes/auth.ts
import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { sql } from 'kysely'
import type { LoginRequest, AcceptInviteRequest } from '@aigc/types'

function signAccessToken(user: { id: string; email: string; role: string }): string {
  const secret = process.env.JWT_SECRET!
  const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m'
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret, { expiresIn })
}

function signRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

async function buildUserProfile(db: any, userId: string) {
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'username', 'avatar_url', 'role'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()

  const teamRows = await db
    .selectFrom('team_members')
    .innerJoin('teams', 'teams.id', 'team_members.team_id')
    .select(['teams.id as team_id', 'teams.name as team_name', 'team_members.role'])
    .where('team_members.user_id', '=', userId)
    .execute()

  const teams = []
  for (const t of teamRows) {
    const wsRows = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.id as ws_id', 'workspaces.name as ws_name', 'workspace_members.role'])
      .where('workspace_members.user_id', '=', userId)
      .where('workspaces.team_id', '=', (t as any).team_id)
      .execute()

    teams.push({
      id: (t as any).team_id,
      name: (t as any).team_name,
      role: (t as any).role,
      workspaces: wsRows.map((w: any) => ({ id: w.ws_id, name: w.ws_name, role: w.role })),
    })
  }

  return { id: user.id, email: user.email, username: user.username, avatar_url: user.avatar_url, role: user.role, teams }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {

  // POST /auth/login
  app.post<{ Body: LoginRequest }>('/auth/login', async (request, reply) => {
    const { email, password } = request.body
    if (!email || !password) return reply.badRequest('email and password are required')

    const db = getDb()
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'username', 'password_hash', 'role', 'status'])
      .where('email', '=', email)
      .executeTakeFirst()

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      })
    }

    if (user.status !== 'active') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: 'Account is not active' },
      })
    }

    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role })
    const refreshToken = signRefreshToken()
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return { access_token: accessToken, user: profile }
  })

  // POST /auth/refresh
  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = (request.cookies as any)?.refresh_token
    if (!refreshToken) {
      return reply.status(401).send({
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
      })
    }

    const db = getDb()
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    const stored = await db
      .selectFrom('refresh_tokens')
      .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
      .select(['users.id', 'users.email', 'users.role', 'refresh_tokens.id as token_id', 'refresh_tokens.expires_at', 'refresh_tokens.revoked_at'])
      .where('refresh_tokens.token_hash', '=', tokenHash)
      .executeTakeFirst()

    if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token' },
      })
    }

    const accessToken = signAccessToken({ id: stored.id, email: stored.email, role: stored.role })
    return { access_token: accessToken }
  })

  // POST /auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const refreshToken = (request.cookies as any)?.refresh_token
    if (refreshToken) {
      const db = getDb()
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: sql`NOW()` })
        .where('token_hash', '=', tokenHash)
        .execute()
    }

    reply.clearCookie('refresh_token', { path: '/api/v1/auth' })
    return { success: true }
  })

  // POST /auth/accept-invite
  app.post<{ Body: AcceptInviteRequest }>('/auth/accept-invite', async (request, reply) => {
    const { token, email, password, username } = request.body
    if (!token || !email || !password || !username) {
      return reply.badRequest('token, email, password, and username are required')
    }

    const db = getDb()
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const invite = await db
      .selectFrom('email_verifications')
      .select(['id', 'user_id', 'expires_at', 'used_at'])
      .where('token_hash', '=', tokenHash)
      .where('type', '=', 'verify_email')
      .executeTakeFirst()

    if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INVITE', message: 'Invalid or expired invitation' },
      })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // Update the pre-created user with real credentials
    await db
      .updateTable('users')
      .set({ username, password_hash: passwordHash, status: 'active' })
      .where('id', '=', invite.user_id)
      .execute()

    await db
      .updateTable('email_verifications')
      .set({ used_at: sql`NOW()` })
      .where('id', '=', invite.id)
      .execute()

    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('id', '=', invite.user_id)
      .executeTakeFirstOrThrow()

    const accessToken = signAccessToken(user)
    const refreshTokenStr = signRefreshToken()
    const refreshHash = crypto.createHash('sha256').update(refreshTokenStr).digest('hex')

    await db.insertInto('refresh_tokens').values({
      user_id: user.id,
      token_hash: refreshHash,
      expires_at: sql`NOW() + INTERVAL '7 days'`,
    }).execute()

    reply.setCookie('refresh_token', refreshTokenStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60,
    })

    const profile = await buildUserProfile(db, user.id)
    return reply.status(201).send({ access_token: accessToken, user: profile })
  })
}
```

**Step 2: Install @fastify/cookie for cookie support**

```bash
cd apps/api && pnpm add @fastify/cookie
```

**Step 3: Register in app.ts**

```typescript
import cookie from '@fastify/cookie'
// ... in buildApp:
await app.register(cookie)
// ... in v1 prefix:
await v1.register(authRoutes)
```

**Step 4: Verify build**

```bash
cd apps/api && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: implement auth routes (login, refresh, logout, accept-invite)"
```

---

## Task 7: User Routes (/users/me)

**Files:**
- Create: `apps/api/src/routes/users.ts`
- Modify: `apps/api/src/app.ts` — register userRoutes

**Step 1: Implement user routes**

The `GET /users/me` endpoint reuses `buildUserProfile` from auth.ts. Extract it to a shared service first:

- Create: `apps/api/src/services/user-profile.ts` — move `buildUserProfile` here
- Both `auth.ts` and `users.ts` import from it

`users.ts`:
```typescript
// GET /users/me — return full user profile with teams and workspaces
// PATCH /users/me — update username, avatar_url
```

**Step 2: Register in app.ts, verify build, commit**

```bash
git commit -m "feat: add /users/me endpoint for profile and updates"
```

---

## Task 8: Team Management Routes

**Files:**
- Create: `apps/api/src/routes/teams.ts`
- Modify: `apps/api/src/app.ts` — register teamRoutes

**Step 1: Implement team routes**

```typescript
// GET /teams/:id — TeamRoleGuard('editor') — team info + members + credit balance
// POST /teams/:id/members — TeamRoleGuard('owner') — invite member (create user + email_verification + add to team_members)
// PATCH /teams/:id/members/:uid — TeamRoleGuard('owner') — update role or credit_quota
// DELETE /teams/:id/members/:uid — TeamRoleGuard('owner') — remove member
// GET /teams/:id/batches — TeamRoleGuard('owner') — all batches in team's workspaces
```

Each route uses `app.addHook('preHandler', teamRoleGuard('role'))` for access control.

**Step 2: Register in app.ts, verify build, commit**

```bash
git commit -m "feat: add team management routes with role guards"
```

---

## Task 9: Workspace Routes

**Files:**
- Create: `apps/api/src/routes/workspaces.ts`
- Modify: `apps/api/src/app.ts` — register workspaceRoutes

**Step 1: Implement workspace routes**

```typescript
// POST /teams/:id/workspaces — TeamRoleGuard('owner') — create workspace
// GET /workspaces/:id — WorkspaceGuard('viewer') — workspace detail
// GET /workspaces/:id/members — TeamRoleGuard('owner') — list workspace members
// POST /workspaces/:id/members — TeamRoleGuard('owner') — add member to workspace
// DELETE /workspaces/:id/members/:uid — TeamRoleGuard('owner') — remove from workspace
// GET /workspaces/:id/batches — WorkspaceGuard('editor') — workspace generation records
```

**Step 2: Register, verify build, commit**

```bash
git commit -m "feat: add workspace management routes with guards"
```

---

## Task 10: Admin Routes

**Files:**
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts` — register adminRoutes

**Step 1: Implement admin routes**

```typescript
// GET /admin/teams — list all teams with member count and credit balance
// POST /admin/teams — create team + owner user + credit_account + default workspace
// POST /admin/teams/:id/credits — top-up team credits (insert credits_ledger entry)
// GET /admin/users — list all users with team info
// GET /admin/batches — list all generation records (supports ?team_id, ?workspace_id filters)
```

All routes use `app.addHook('preHandler', adminGuard())`.

**Step 2: Register, verify build, commit**

```bash
git commit -m "feat: add admin routes (team creation, credit top-up, global views)"
```

---

## Task 11: Modify Existing Routes for Workspace Context

**Files:**
- Modify: `apps/api/src/routes/generate.ts` — use `request.user` + `workspace_id` param + WorkspaceGuard
- Modify: `apps/api/src/routes/batches.ts` — filter by workspace, respect user role
- Modify: `apps/api/src/routes/sse.ts` — use `request.user` instead of hardcoded user
- Modify: `apps/api/src/services/credit.ts` — update `freezeCredits` to use team credit_account and check member quota

**Step 1: Update generate.ts**

- Replace hardcoded `test@aigc.local` lookup with `request.user.id`
- Add required `workspace_id` body param
- Add `WorkspaceGuard('editor')` as preHandler
- Update credit check: find team via workspace → team credit_account
- Check `team_members.credit_used + cost <= credit_quota`
- Update `team_members.credit_used += cost` on freeze

**Step 2: Update batches.ts**

- Replace hardcoded user with `request.user.id`
- Add `workspace_id` query param (required)
- Filter `task_batches WHERE workspace_id = ?`

**Step 3: Update sse.ts**

- Replace hardcoded user with `request.user.id`

**Step 4: Update credit.ts**

- `freezeCredits(teamId, userId, amount)` — freeze from team account, increment member credit_used
- `confirmCredits(teamId, amount)` — deduct from team balance
- `refundCredits(teamId, userId, amount)` — unfreeze, decrement member credit_used

**Step 5: Verify build**

```bash
cd apps/api && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/services/credit.ts
git commit -m "feat: integrate workspace context and JWT user into existing routes"
```

---

## Task 12: Update Seed Script

**Files:**
- Modify: `packages/db/scripts/seed.ts`

**Step 1: Update seed to create realistic test data**

- Create admin user: `admin@aigc.local` / password `admin123` / role `admin`
- Create team: "测试团队"
- Create team owner: `owner@aigc.local` / password `owner123` / role `member`, team_members.role = `owner`
- Create team member: `editor@aigc.local` / password `editor123` / role `member`, team_members.role = `editor`
- Create default workspace: "默认工作区" in the team
- Add owner and editor to workspace_members
- Create team credit_account with 10000 credits
- Set editor credit_quota = 1000, credit_used = 0
- Hash passwords with bcrypt

**Step 2: Run seed**

```bash
pnpm db:seed
```

**Step 3: Commit**

```bash
git add packages/db/scripts/seed.ts
git commit -m "feat: update seed with admin, team owner, editor, workspace, and credits"
```

---

## Task 13: Frontend — Auth Store + API Client Update

**Files:**
- Create: `apps/web/src/stores/auth-store.ts`
- Modify: `apps/web/src/lib/api-client.ts` — replace X-API-Key with Bearer token + refresh logic
- Create: `apps/web/src/lib/auth-provider.tsx` — auth context provider with auto-refresh

**Step 1: Create auth store (Zustand)**

```typescript
// apps/web/src/stores/auth-store.ts
import { create } from 'zustand'
import type { UserProfile, UserTeam, UserWorkspace } from '@aigc/types'

interface AuthState {
  user: UserProfile | null
  accessToken: string | null
  activeTeamId: string | null
  activeWorkspaceId: string | null
  // Derived
  activeTeam: UserTeam | null
  activeWorkspace: UserWorkspace | null
  // Actions
  setAuth: (user: UserProfile, token: string) => void
  clearAuth: () => void
  setActiveTeam: (teamId: string) => void
  setActiveWorkspace: (workspaceId: string) => void
  refreshUser: (user: UserProfile) => void
}
```

**Step 2: Update api-client.ts**

- Replace `X-API-Key` header with `Authorization: Bearer ${token}`
- Add 401 interceptor: on 401 response, call `/auth/refresh`, retry original request
- Add `credentials: 'include'` to all fetch calls (for cookie)

**Step 3: Create auth-provider.tsx**

- On mount: call `/auth/refresh` to get access_token, then `/users/me` to get profile
- If refresh fails: redirect to `/login`
- Wrap dashboard layout

**Step 4: Verify build**

```bash
cd apps/web && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/web/src/stores/auth-store.ts apps/web/src/lib/api-client.ts apps/web/src/lib/auth-provider.tsx
git commit -m "feat: add auth store, JWT API client, and auth provider"
```

---

## Task 14: Frontend — Login Page

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx` — centered card layout (no sidebar)
- Create: `apps/web/src/app/(auth)/login/page.tsx` — email + password form

**Step 1: Create auth layout**

Centered single-card layout with platform logo on top. No sidebar, no topbar.

**Step 2: Create login page**

- Email + password form
- Submit → POST `/auth/login` → store token → redirect to `/`
- Error handling: show toast on invalid credentials
- "接受邀请？" link to `/accept-invite`

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add login page with auth layout"
```

---

## Task 15: Frontend — Accept Invite Page

**Files:**
- Create: `apps/web/src/app/(auth)/accept-invite/page.tsx`

**Step 1: Create accept-invite page**

- URL: `/accept-invite?token=xxx`
- Form: email, username, password, confirm password
- Submit → POST `/auth/accept-invite` → store token → redirect to `/`

**Step 2: Verify build, commit**

```bash
git commit -m "feat: add accept-invite registration page"
```

---

## Task 16: Frontend — Workspace Switcher

**Files:**
- Create: `apps/web/src/components/layout/workspace-switcher.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx` — add switcher at top

**Step 1: Create workspace switcher component**

Notion-style dropdown at sidebar top:
- Shows current team name + workspace name
- Dropdown lists all workspaces grouped by team
- Click to switch `activeTeamId` + `activeWorkspaceId` in auth store
- Switching triggers SWR revalidation of all workspace-scoped data

**Step 2: Integrate into sidebar**

Add `<WorkspaceSwitcher />` at the top of sidebar, above nav items.

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add workspace switcher to sidebar"
```

---

## Task 17: Frontend — Sidebar Role-Gated Menu + User Dropdown

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx` — add role-gated nav items
- Modify: `apps/web/src/components/layout/topbar.tsx` — replace avatar placeholder with user dropdown

**Step 1: Update sidebar navigation**

- Base items: 工作台, 图片生成, 历史记录, 设置 (all roles)
- If team role === 'owner': show 团队管理 link to `/team`
- If user role === 'admin': show 管理后台 link to `/admin`

**Step 2: Update topbar**

Replace `<div>U</div>` with DropdownMenu:
- User avatar + name
- Items: 个人设置, 登出
- Logout: POST `/auth/logout`, clear auth store, redirect to `/login`

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add role-gated sidebar menu and user dropdown"
```

---

## Task 18: Frontend — Update Existing Pages for Workspace Context

**Files:**
- Modify: `apps/web/src/hooks/use-generate.ts` — add workspace_id to generate request
- Modify: `apps/web/src/hooks/use-batches.ts` — add workspace_id query param
- Modify: `apps/web/src/components/dashboard/stats-cards.tsx` — use real team credits
- Modify: `apps/web/src/components/layout/credits-badge.tsx` — real balance from API
- Modify: `apps/web/src/app/(dashboard)/layout.tsx` — wrap with AuthProvider

**Step 1: Update use-generate.ts**

Add `workspace_id: activeWorkspaceId` to the POST body.

**Step 2: Update use-batches.ts**

Change SWR key to include `?workspace_id=${activeWorkspaceId}`.

**Step 3: Update stats-cards.tsx**

Replace hardcoded `balance = 1000 - totalCredits` with real data from team credit_account (via `/teams/:id` endpoint or a dedicated credits API).

**Step 4: Update credits-badge.tsx**

Fetch real team credit balance, display actual value.

**Step 5: Wrap dashboard layout with AuthProvider**

```typescript
// apps/web/src/app/(dashboard)/layout.tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SWRProvider>
        <AppShell>{children}</AppShell>
      </SWRProvider>
    </AuthProvider>
  )
}
```

**Step 6: Verify build, commit**

```bash
git commit -m "feat: integrate workspace context into generate, history, and dashboard"
```

---

## Task 19: Frontend — Team Management Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/team/page.tsx`
- Create: `apps/web/src/components/team/member-list.tsx`
- Create: `apps/web/src/components/team/workspace-list.tsx`
- Create: `apps/web/src/components/team/invite-dialog.tsx`

**Step 1: Create team management page**

Tab layout:
- **成员管理**: table with username, email, role, credit_quota, credit_used, actions (edit quota, remove)
- **工作区管理**: card list of workspaces with member count, create workspace button, manage members

**Step 2: Create member-list component**

Table with columns: 用户名, 邮箱, 角色, 额度上限, 已使用, 操作
- Edit quota: inline number input
- Remove: confirm dialog

**Step 3: Create workspace-list component**

Card grid of workspaces. Each card shows name, member count, created_at.
- Click to expand member management (add/remove members)

**Step 4: Create invite-dialog component**

Dialog with email input. Submit → POST `/teams/:id/members`.

**Step 5: Verify build, commit**

```bash
git commit -m "feat: add team management page with member and workspace management"
```

---

## Task 20: Frontend — Admin Dashboard Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/admin/page.tsx`
- Create: `apps/web/src/components/admin/team-table.tsx`
- Create: `apps/web/src/components/admin/topup-dialog.tsx`

**Step 1: Create admin page**

Tab layout:
- **团队列表**: table with team name, owner, member count, credit balance, actions (top-up)
- **创建团队**: form with team name, owner email, initial credits
- **用户列表**: table with all users
- **全局记录**: all generation records with team/workspace filter

**Step 2: Create team-table and topup-dialog**

- Team table with columns: 团队名, 组长, 成员数, 积分余额, 操作
- Top-up dialog: amount input + description → POST `/admin/teams/:id/credits`

**Step 3: Verify build, commit**

```bash
git commit -m "feat: add admin dashboard with team management and credit top-up"
```

---

## Task 21: Frontend — Settings Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/page.tsx`

**Step 1: Create settings page**

Simple form:
- 修改用户名
- 修改头像 (file upload)
- 修改密码 (current password + new password + confirm)
- Submit → PATCH `/users/me`

**Step 2: Verify build, commit**

```bash
git commit -m "feat: add user settings page"
```

---

## Task 22: End-to-End Smoke Test

**Step 1: Restart all services**

```bash
# Kill existing processes
# Start API: cd apps/api && npx tsx src/index.ts
# Start Worker: cd apps/worker && npx tsx src/index.ts
# Start Web: cd apps/web && pnpm dev -p 3000
```

**Step 2: Run seed**

```bash
pnpm db:migrate && pnpm db:seed
```

**Step 3: Test login flows**

1. Open http://localhost:3000 → redirected to /login
2. Login as admin (`admin@aigc.local` / `admin123`) → see admin menu
3. Login as owner (`owner@aigc.local` / `owner123`) → see team management menu
4. Login as editor (`editor@aigc.local` / `editor123`) → see basic menu only

**Step 4: Test workspace context**

1. As editor: switch workspace → history/dashboard data updates
2. Generate image → workspace_id attached → appears in correct workspace history

**Step 5: Test admin functions**

1. As admin: create new team, top-up credits
2. As owner: invite member, set quota, manage workspaces

**Step 6: Test guards**

1. As editor: try accessing /team → should redirect or show 403
2. As editor: try calling team admin API directly → 403

**Step 7: Commit if any fixes needed**

```bash
git commit -m "fix: resolve issues found during e2e smoke testing"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Install auth deps | Trivial |
| 2 | DB migration (workspace_members + quota) | Small |
| 3 | Auth type definitions | Small |
| 4 | JWT auth plugin | Medium |
| 5 | Guard middlewares | Medium |
| 6 | Auth routes (login/refresh/logout/invite) | Large |
| 7 | User routes (/users/me) | Small |
| 8 | Team management routes | Large |
| 9 | Workspace routes | Medium |
| 10 | Admin routes | Medium |
| 11 | Modify existing routes for workspace | Medium |
| 12 | Update seed script | Small |
| 13 | Frontend auth store + API client | Medium |
| 14 | Login page | Small |
| 15 | Accept-invite page | Small |
| 16 | Workspace switcher | Medium |
| 17 | Sidebar role-gating + user dropdown | Small |
| 18 | Update existing pages for workspace | Medium |
| 19 | Team management page | Large |
| 20 | Admin dashboard page | Large |
| 21 | Settings page | Small |
| 22 | E2E smoke test | Medium |
