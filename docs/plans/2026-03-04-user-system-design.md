# User System Design

Date: 2026-03-04

## Overview

B2B multi-tenant user system for AIGC platform. All users belong to a Team. No self-registration — users join via invitation only. Data isolation at Workspace level.

## Decisions

- **Auth**: JWT access token (15min, in-memory) + refresh token (7d, httpOnly cookie)
- **Login**: Email + password (extensible to SMS later)
- **Tenant model**: Admin creates Team → assigns owner → owner manages members
- **Credits**: Team-level pool. Owner sets per-member quota. Members consume from pool.
- **Data isolation**: Workspace-level. Batches/assets scoped to `workspace_id`.
- **Admin UI**: Integrated in existing sidebar, role-gated menu items.

## Roles & Permissions

| Role | Scope | Generate | View Scope | Credits | User Mgmt |
|------|-------|----------|-----------|---------|-----------|
| admin | Global | Yes | All teams/workspaces | Top-up Team pool | Create Team, assign owner |
| owner | Team | Yes | All workspaces in team | Set member quotas | Invite/remove members, manage workspaces |
| editor | Workspace | Yes | Assigned workspaces | View own quota/usage | None |

- `users.role`: `admin` or `member`
- `team_members.role`: `owner`, `admin`, `editor`, `viewer`
- `workspace_members.role`: `admin`, `editor`, `viewer`

## DB Changes

### New table: `workspace_members`

```sql
CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(20) NOT NULL DEFAULT 'editor',  -- admin | editor | viewer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
```

### Alter: `team_members`

```sql
ALTER TABLE team_members
  ADD COLUMN credit_quota INTEGER DEFAULT NULL,  -- NULL = unlimited
  ADD COLUMN credit_used INTEGER NOT NULL DEFAULT 0;
```

## Auth Flow

```
Register (via invite):
  POST /auth/accept-invite { token, email, password, username }
  → create user → add to team_members → add to workspace_members → JWT

Login:
  POST /auth/login { email, password }
  → verify → access_token (header) + refresh_token (httpOnly cookie)

Refresh:
  POST /auth/refresh (cookie)
  → verify refresh_token → new access_token

Logout:
  POST /auth/logout (cookie)
  → revoke refresh_token
```

## Credit Flow

```
Admin top-up → credit_accounts(team_id).balance += amount
                credits_ledger entry (type: topup)

Member generate → check: member.credit_used + cost <= member.credit_quota
               → freeze: credit_accounts(team_id).frozen += cost
               → member.credit_used += cost
               → credits_ledger entry (type: freeze)

Task complete → confirm: credit_accounts balance -= cost, frozen -= cost
             → credits_ledger entry (type: confirm)

Task fail → refund: credit_accounts frozen -= cost
          → member.credit_used -= cost
          → credits_ledger entry (type: refund)
```

## API Routes

### Auth (public)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Email + password → JWT |
| POST | `/auth/refresh` | Cookie → new access_token |
| POST | `/auth/logout` | Revoke refresh_token |
| POST | `/auth/accept-invite` | Accept invite → register + join team |

### User (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Profile + role + teams + workspaces |
| PATCH | `/users/me` | Update name/avatar |

### Team (owner/admin)

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| GET | `/teams/:id` | TeamRole(editor) | Team info + members + credits |
| POST | `/teams/:id/members` | TeamRole(owner) | Invite member by email |
| PATCH | `/teams/:id/members/:uid` | TeamRole(owner) | Set quota/role |
| DELETE | `/teams/:id/members/:uid` | TeamRole(owner) | Remove member |
| GET | `/teams/:id/batches` | TeamRole(owner) | All team generation records |

### Workspace

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| POST | `/teams/:id/workspaces` | TeamRole(owner) | Create workspace |
| GET | `/workspaces/:id` | WsGuard(viewer) | Workspace detail |
| GET | `/workspaces/:id/members` | TeamRole(owner) | List workspace members |
| POST | `/workspaces/:id/members` | TeamRole(owner) | Add member to workspace |
| DELETE | `/workspaces/:id/members/:uid` | TeamRole(owner) | Remove from workspace |
| GET | `/workspaces/:id/batches` | WsGuard(editor) | Workspace generation records |

### Admin (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/teams` | List all teams |
| POST | `/admin/teams` | Create team + assign owner |
| POST | `/admin/teams/:id/credits` | Top-up team credits |
| GET | `/admin/users` | List all users |
| GET | `/admin/batches` | All generation records |

### Existing routes (modified)

- `POST /generate/image` — add `workspace_id` param, use JWT user, WsGuard(editor)
- `GET /batches` — filter by workspace_id from context

## Guard Middleware

```
TeamRoleGuard(requiredRole):
  SELECT role FROM team_members WHERE team_id = :id AND user_id = jwt.sub
  role rank < required → 403

WorkspaceGuard(requiredRole):
  SELECT role FROM workspace_members WHERE workspace_id = :id AND user_id = jwt.sub
  role rank < required → 403

AdminGuard:
  SELECT role FROM users WHERE id = jwt.sub
  role != 'admin' → 403
```

Role ranking: owner > admin > editor > viewer

## Frontend

### New pages

| Route | Page | Visible to |
|-------|------|-----------|
| `/login` | Login form | Unauthenticated |
| `/accept-invite` | Accept invite + register | Unauthenticated |
| `/settings` | Profile settings (password, avatar) | All |
| `/team` | Team management (members, quotas, workspaces) | owner |
| `/admin` | Admin dashboard (teams, credits, users, records) | admin |

### Sidebar changes

- Add Workspace Switcher at top (dropdown, Notion-style)
- Dynamic menu items based on role
- Real credit balance from API

```
┌─────────────────────┐
│ Team Name        ▾  │  ← Team selector (if multi-team)
├─────────────────────┤
│ Workspace A      ▾  │  ← Workspace switcher
├─────────────────────┤
│ 工作台               │
│ 图片生成             │
│ 历史记录             │
│ ─────────────────── │
│ 团队管理  (owner)    │
│ 管理后台  (admin)    │
│ ─────────────────── │
│ 设置                 │
└─────────────────────┘
```

### Auth state management

- Zustand store: `useAuthStore` — user, teams, workspaces, activeTeamId, activeWorkspaceId
- JWT stored in memory (not localStorage)
- Refresh via httpOnly cookie on 401 response
- SWR fetcher wraps auth header injection
- Protected route wrapper: redirect to /login if unauthenticated

### Existing page modifications

- Topbar: placeholder avatar → real user avatar + dropdown (settings/logout)
- Credits badge: read from team credit_accounts via API
- Generate page: send workspace_id with requests
- History page: filter by current workspace
- Dashboard stats: scoped to current workspace
