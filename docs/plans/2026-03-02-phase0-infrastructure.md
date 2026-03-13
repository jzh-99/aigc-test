# Phase 0 Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the AIGC platform monorepo with all database schemas, three service skeletons, local dev environment, and a working `GET /healthz` endpoint secured by X-API-Key.

**Architecture:** pnpm workspaces + Turborepo monorepo; `apps/api` (Fastify), `apps/web` (Next.js 14), `apps/worker` (BullMQ); `packages/db` (Kysely migrations), `packages/types`, `packages/utils`. Local dev via Docker Compose (PostgreSQL 15, Redis, MinIO).

**Tech Stack:** Node.js 20, TypeScript 5, pnpm 9, Turborepo, Fastify 4, Kysely 0.27, BullMQ 5, Next.js 14, PostgreSQL 15, Redis 7, MinIO

**Acceptance Criteria:**
```
docker compose up -d && pnpm dev
```
- Three services start without errors
- All DB tables created (`pnpm db:migrate`)
- Seed data inserted (`pnpm db:seed`)
- `X-API-Key` header middleware working
- `GET /api/v1/healthz` returns `{ "status": "ok", "db": "ok", "redis": "ok" }`

---

## Task 1: Root Monorepo Scaffold

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`

**Step 1: Create root package.json**

```json
{
  "name": "aigc-platform",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "db:migrate": "pnpm --filter @aigc/db migrate",
    "db:seed": "pnpm --filter @aigc/db seed"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {}
  }
}
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

**Step 5: Create .npmrc**

```
shamefully-hoist=false
strict-peer-dependencies=false
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
.next/
.turbo/
*.env
!.env.example
```

**Step 7: Install root dependencies**

Run: `pnpm install`
Expected: pnpm-lock.yaml created, node_modules/.pnpm populated

**Step 8: Commit**

```bash
git init
git add .
git commit -m "feat: initialize monorepo scaffold with pnpm + turborepo"
```

---

## Task 2: packages/types — Shared TypeScript Types

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Create: `packages/types/src/db.ts`
- Create: `packages/types/src/queue.ts`

**Step 1: Create packages/types/package.json**

```json
{
  "name": "@aigc/types",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Create packages/types/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Create packages/types/src/db.ts**

```typescript
export type ModuleType = 'image' | 'video' | 'tts' | 'lipsync' | 'agent'
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_complete' | 'failed'
export type TransferStatus = 'pending' | 'completed' | 'failed'
export type LedgerType = 'topup' | 'subscription' | 'freeze' | 'confirm' | 'refund' | 'bonus' | 'expire'
export type AssetType = 'image' | 'video' | 'audio'
export type OwnerType = 'user' | 'team'
export type PlanTier = 'free' | 'basic' | 'pro' | 'enterprise'
```

**Step 4: Create packages/types/src/queue.ts**

```typescript
export interface GenerationJobData {
  taskId: string
  batchId: string
  userId: string
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  estimatedCredits: number
}

export interface CompletionJobData {
  taskId: string
  result: {
    success: boolean
    outputUrl?: string
    actualCredits?: number
    providerCostRaw?: Record<string, unknown>
    errorMessage?: string
  }
}

export interface TransferJobData {
  taskId: string
  assetId: string
  originalUrl: string
}
```

**Step 5: Create packages/types/src/index.ts**

```typescript
export * from './db.js'
export * from './queue.js'
```

**Step 6: Commit**

```bash
git add packages/types/
git commit -m "feat: add @aigc/types package with shared TypeScript types"
```

---

## Task 3: Docker Compose + Environment Files

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

**Step 1: Create docker-compose.yml**

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: aigc
      POSTGRES_PASSWORD: aigcpass
      POSTGRES_DB: aigc_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aigc"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

**Step 2: Create .env.example**

```bash
# Database
DATABASE_URL=postgresql://aigc:aigcpass@localhost:5432/aigc_dev

# Redis
REDIS_URL=redis://localhost:6379

# Object Storage (MinIO / S3)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=aigc-assets
STORAGE_REGION=us-east-1
STORAGE_PUBLIC_URL=http://localhost:9000/aigc-assets

# Auth (Phase 0: static key, Phase 4: JWT)
API_KEY=test-api-key-phase0
JWT_SECRET=change-me-in-production-at-least-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# API Service
API_PORT=3001
API_HOST=0.0.0.0

# Worker Service
WORKER_PORT=3002

# Third-party AI Providers (Phase 1+)
KLING_API_KEY=
KLING_API_SECRET=
KLING_WEBHOOK_SECRET=

# Feature Flags
NODE_ENV=development
LOG_LEVEL=info
```

**Step 3: Copy .env.example to .env**

Run: `cp .env.example .env`

**Step 4: Start local dependencies**

Run: `docker compose up -d`
Expected: postgres, redis, minio containers running and healthy

**Step 5: Verify services are up**

Run: `docker compose ps`
Expected: All 3 services show "healthy" status

**Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: add docker compose for local dev (postgres, redis, minio)"
```

---

## Task 4: packages/db — Database Package Setup

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/scripts/migrate.ts`
- Create: `packages/db/scripts/seed.ts`

**Step 1: Create packages/db/package.json**

```json
{
  "name": "@aigc/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "migrate": "node --loader ts-node/esm scripts/migrate.ts",
    "seed": "node --loader ts-node/esm scripts/seed.ts"
  },
  "dependencies": {
    "kysely": "^0.27.0",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src", "scripts"]
}
```

**Step 3: Create packages/db/src/client.ts**

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './schema.js'

let db: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!db) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    })
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    })
  }
  return db
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy()
    db = null
  }
}
```

**Step 4: Create packages/db/src/index.ts**

```typescript
export { getDb, closeDb } from './client.js'
export type { Database } from './schema.js'
```

**Step 5: Install db package dependencies**

Run: `pnpm install` (from root)
Expected: kysely, pg installed in packages/db

**Step 6: Commit**

```bash
git add packages/db/
git commit -m "feat: add @aigc/db package skeleton with Kysely client"
```

---

## Task 5: DB Schema Types (Kysely Database Interface)

**Files:**
- Create: `packages/db/src/schema.ts`

This file defines TypeScript interfaces matching all DB tables so Kysely can provide type-safe queries.

**Step 1: Create packages/db/src/schema.ts**

```typescript
import type {
  ModuleType, TaskStatus, BatchStatus, TransferStatus,
  LedgerType, AssetType, OwnerType, PlanTier
} from '@aigc/types'

// ─── Utility ──────────────────────────────────────────────────────────────────
type Generated<T> = T
type Timestamp = Date

// ─── Users & Auth ─────────────────────────────────────────────────────────────
export interface UsersTable {
  id: Generated<string>
  email: string
  username: string
  password_hash: string
  avatar_url: string | null
  role: 'admin' | 'member'
  status: 'active' | 'suspended' | 'deleted'
  plan_tier: PlanTier
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface SubscriptionPlansTable {
  id: Generated<string>
  name: string
  tier: PlanTier
  price_monthly: string | null
  price_yearly: string | null
  credits_monthly: number
  max_concurrency: number
  max_batch_size: number
  features: unknown
  is_active: boolean
}

export interface UserSubscriptionsTable {
  id: Generated<string>
  user_id: string
  plan_id: string
  status: 'active' | 'expired' | 'cancelled'
  started_at: Timestamp
  expires_at: Timestamp
  created_at: Generated<Timestamp>
}

export interface RefreshTokensTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  expires_at: Timestamp
  revoked_at: Timestamp | null
  created_at: Generated<Timestamp>
}

export interface EmailVerificationsTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  type: 'verify_email' | 'reset_password'
  expires_at: Timestamp
  used_at: Timestamp | null
  created_at: Generated<Timestamp>
}

// ─── Credits ──────────────────────────────────────────────────────────────────
export interface CreditAccountsTable {
  id: Generated<string>
  owner_type: OwnerType
  user_id: string | null
  team_id: string | null
  balance: number
  frozen_credits: number
  total_earned: number
  total_spent: number
  updated_at: Generated<Timestamp>
}

export interface CreditsLedgerTable {
  id: Generated<string>
  credit_account_id: string
  user_id: string
  amount: number
  type: LedgerType
  task_id: string | null
  batch_id: string | null
  description: string | null
  created_at: Generated<Timestamp>
}

// ─── Teams ────────────────────────────────────────────────────────────────────
export interface TeamsTable {
  id: Generated<string>
  name: string
  owner_id: string
  plan_tier: PlanTier
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface TeamMembersTable {
  team_id: string
  user_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  joined_at: Generated<Timestamp>
}

export interface TeamSubscriptionsTable {
  id: Generated<string>
  team_id: string
  plan_id: string
  status: 'active' | 'expired' | 'cancelled'
  started_at: Timestamp
  expires_at: Timestamp
  created_at: Generated<Timestamp>
}

export interface WorkspacesTable {
  id: Generated<string>
  team_id: string
  name: string
  description: string | null
  created_by: string
  created_at: Generated<Timestamp>
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export interface TaskBatchesTable {
  id: Generated<string>
  user_id: string
  team_id: string | null
  workspace_id: string | null
  credit_account_id: string
  parent_batch_id: string | null
  idempotency_key: string
  module: ModuleType
  provider: string
  model: string
  prompt: string
  params: unknown
  quantity: number
  completed_count: number
  failed_count: number
  status: BatchStatus
  estimated_credits: number
  actual_credits: number
  is_hidden: boolean
  is_deleted: boolean
  deleted_at: Timestamp | null
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface TasksTable {
  id: Generated<string>
  batch_id: string
  user_id: string
  version_index: number
  queue_job_id: string | null
  external_task_id: string | null
  status: TaskStatus
  retry_count: number
  estimated_credits: number
  credits_cost: number | null
  provider_cost_raw: unknown | null
  processing_started_at: Timestamp | null
  completed_at: Timestamp | null
  error_message: string | null
}

export interface AssetsTable {
  id: Generated<string>
  task_id: string
  batch_id: string
  user_id: string
  type: AssetType
  storage_url: string | null
  original_url: string | null
  transfer_status: TransferStatus
  file_size: number | null
  duration: number | null
  width: number | null
  height: number | null
  metadata: unknown
  is_deleted: boolean
  created_at: Generated<Timestamp>
}

// ─── Security & Audit ─────────────────────────────────────────────────────────
export interface PromptFilterLogsTable {
  id: Generated<string>
  user_id: string
  prompt: string
  matched_rules: unknown
  action: 'pass' | 'rejected'
  created_at: Generated<Timestamp>
}

export interface WebhookLogsTable {
  id: Generated<string>
  provider: string
  external_task_id: string
  payload: unknown
  signature_valid: boolean
  processed_at: Generated<Timestamp>
}

export interface PaymentOrdersTable {
  id: Generated<string>
  user_id: string
  order_no: string
  provider: string
  provider_order_id: string | null
  type: 'topup' | 'subscription'
  amount_fen: number
  credits: number | null
  plan_id: string | null
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  paid_at: Timestamp | null
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// ─── Providers ────────────────────────────────────────────────────────────────
export interface ProvidersTable {
  id: Generated<string>
  code: string
  name: string
  region: 'cn' | 'global'
  modules: unknown
  is_active: boolean
  config: unknown
}

export interface ProviderModelsTable {
  id: Generated<string>
  provider_id: string
  code: string
  name: string
  module: ModuleType
  credit_cost: number
  params_pricing: unknown
  params_schema: unknown
  is_active: boolean
}

export interface VoiceProfilesTable {
  id: Generated<string>
  user_id: string
  name: string
  provider: string
  external_voice_id: string
  sample_asset_id: string | null
  status: 'pending' | 'ready' | 'failed'
  is_deleted: boolean
  created_at: Generated<Timestamp>
}

export interface PromptFilterRulesTable {
  id: Generated<string>
  pattern: string
  type: 'keyword' | 'regex'
  action: 'reject' | 'flag'
  description: string | null
  is_active: boolean
  created_at: Generated<Timestamp>
}

// ─── Database Interface ────────────────────────────────────────────────────────
export interface Database {
  users: UsersTable
  subscription_plans: SubscriptionPlansTable
  user_subscriptions: UserSubscriptionsTable
  refresh_tokens: RefreshTokensTable
  email_verifications: EmailVerificationsTable
  credit_accounts: CreditAccountsTable
  credits_ledger: CreditsLedgerTable
  teams: TeamsTable
  team_members: TeamMembersTable
  team_subscriptions: TeamSubscriptionsTable
  workspaces: WorkspacesTable
  task_batches: TaskBatchesTable
  tasks: TasksTable
  assets: AssetsTable
  prompt_filter_logs: PromptFilterLogsTable
  webhook_logs: WebhookLogsTable
  payment_orders: PaymentOrdersTable
  providers: ProvidersTable
  provider_models: ProviderModelsTable
  voice_profiles: VoiceProfilesTable
  prompt_filter_rules: PromptFilterRulesTable
}
```

**Step 2: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat: add Kysely Database schema types for all 21 tables"
```

---

## Task 6: DB Migrations — Users, Auth, Plans

**Files:**
- Create: `packages/db/migrations/001_users.ts`
- Create: `packages/db/migrations/002_subscription_plans.ts`
- Create: `packages/db/migrations/003_auth_tables.ts`

**Step 1: Create 001_users.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', col => col.unique().notNull())
    .addColumn('username', 'varchar(100)', col => col.unique().notNull())
    .addColumn('password_hash', 'varchar(255)', col => col.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'varchar(20)', col =>
      col.defaultTo('member').check(db.fn.sql`role IN ('admin','member')`))
    .addColumn('status', 'varchar(20)', col =>
      col.defaultTo('active').check(db.fn.sql`status IN ('active','suspended','deleted')`))
    .addColumn('plan_tier', 'varchar(20)', col =>
      col.defaultTo('free').check(db.fn.sql`plan_tier IN ('free','basic','pro','enterprise')`))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

**Step 2: Create 002_subscription_plans.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('subscription_plans')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('tier', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`tier IN ('free','basic','pro','enterprise')`))
    .addColumn('price_monthly', 'decimal(10,2)')
    .addColumn('price_yearly', 'decimal(10,2)')
    .addColumn('credits_monthly', 'integer', col => col.notNull())
    .addColumn('max_concurrency', 'integer', col => col.notNull())
    .addColumn('max_batch_size', 'integer', col => col.notNull())
    .addColumn('features', 'jsonb', col => col.notNull())
    .addColumn('is_active', 'boolean', col => col.defaultTo(true))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('subscription_plans').execute()
}
```

**Step 3: Create 003_auth_tables.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // user_subscriptions
  await db.schema
    .createTable('user_subscriptions')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('plan_id', 'uuid', col => col.notNull().references('subscription_plans.id'))
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`status IN ('active','expired','cancelled')`))
    .addColumn('started_at', 'timestamptz', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_user_subscriptions_active')
    .on('user_subscriptions')
    .columns(['user_id', 'status'])
    .execute()

  // refresh_tokens
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'varchar(255)', col => col.unique().notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_refresh_tokens_user')
    .on('refresh_tokens')
    .columns(['user_id'])
    .execute()

  // email_verifications
  await db.schema
    .createTable('email_verifications')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'varchar(255)', col => col.unique().notNull())
    .addColumn('type', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`type IN ('verify_email','reset_password')`))
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_email_verifications_user')
    .on('email_verifications')
    .columns(['user_id', 'type'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('email_verifications').execute()
  await db.schema.dropTable('refresh_tokens').execute()
  await db.schema.dropTable('user_subscriptions').execute()
}
```

**Step 4: Commit**

```bash
git add packages/db/migrations/
git commit -m "feat: add DB migrations 001-003 (users, plans, auth tables)"
```

---

## Task 7: DB Migrations — Teams, Credits

**Files:**
- Create: `packages/db/migrations/004_teams.ts`
- Create: `packages/db/migrations/005_credits.ts`

**Step 1: Create 004_teams.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // teams
  await db.schema
    .createTable('teams')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('owner_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('plan_tier', 'varchar(20)', col =>
      col.defaultTo('free').check(db.fn.sql`plan_tier IN ('free','basic','pro','enterprise')`))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  // team_members
  await db.schema
    .createTable('team_members')
    .addColumn('team_id', 'uuid', col => col.notNull().references('teams.id'))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('role', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`role IN ('owner','admin','editor','viewer')`))
    .addColumn('joined_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addPrimaryKeyConstraint('pk_team_members', ['team_id', 'user_id'])
    .execute()

  // team_subscriptions
  await db.schema
    .createTable('team_subscriptions')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('team_id', 'uuid', col => col.notNull().references('teams.id'))
    .addColumn('plan_id', 'uuid', col => col.notNull().references('subscription_plans.id'))
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`status IN ('active','expired','cancelled')`))
    .addColumn('started_at', 'timestamptz', col => col.notNull())
    .addColumn('expires_at', 'timestamptz', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_team_subscriptions_active')
    .on('team_subscriptions')
    .columns(['team_id', 'status'])
    .execute()

  // workspaces
  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('team_id', 'uuid', col => col.notNull().references('teams.id'))
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_by', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workspaces').execute()
  await db.schema.dropTable('team_subscriptions').execute()
  await db.schema.dropTable('team_members').execute()
  await db.schema.dropTable('teams').execute()
}
```

**Step 2: Create 005_credits.ts**

⚠️ Note: `credit_accounts` references `teams` — this migration MUST run after 004_teams.

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // credit_accounts — runs after teams (migration 004)
  await db.schema
    .createTable('credit_accounts')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('owner_type', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`owner_type IN ('user','team')`))
    .addColumn('user_id', 'uuid', col => col.references('users.id'))
    .addColumn('team_id', 'uuid', col => col.references('teams.id'))
    .addColumn('balance', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('frozen_credits', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('total_earned', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('total_spent', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addUniqueConstraint('uq_credit_accounts_user', ['user_id'])
    .addUniqueConstraint('uq_credit_accounts_team', ['team_id'])
    .addCheckConstraint('chk_balance_gte_zero', db.fn.sql`balance >= 0`)
    .addCheckConstraint('chk_frozen_gte_zero', db.fn.sql`frozen_credits >= 0`)
    .addCheckConstraint('chk_balance_gte_frozen', db.fn.sql`balance >= frozen_credits`)
    .addCheckConstraint('chk_owner_type_exclusive', db.fn.sql`
      (owner_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR
      (owner_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    `)
    .execute()

  // credits_ledger
  await db.schema
    .createTable('credits_ledger')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('credit_account_id', 'uuid', col => col.notNull().references('credit_accounts.id'))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('amount', 'integer', col => col.notNull())
    .addColumn('type', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`type IN ('topup','subscription','freeze','confirm','refund','bonus','expire')`))
    .addColumn('task_id', 'uuid')   // intentionally no FK — ledger outlives tasks
    .addColumn('batch_id', 'uuid')  // intentionally no FK — ledger outlives batches
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_credits_ledger_account')
    .on('credits_ledger')
    .columns(['credit_account_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_credits_ledger_user')
    .on('credits_ledger')
    .columns(['user_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('credits_ledger').execute()
  await db.schema.dropTable('credit_accounts').execute()
}
```

**Step 3: Commit**

```bash
git add packages/db/migrations/004_teams.ts packages/db/migrations/005_credits.ts
git commit -m "feat: add DB migrations 004-005 (teams, credits)"
```

---

## Task 8: DB Migrations — Tasks, Assets, Security, Providers

**Files:**
- Create: `packages/db/migrations/006_tasks.ts`
- Create: `packages/db/migrations/007_security.ts`
- Create: `packages/db/migrations/008_providers.ts`

**Step 1: Create 006_tasks.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // task_batches
  await db.schema
    .createTable('task_batches')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('team_id', 'uuid', col => col.references('teams.id'))
    .addColumn('workspace_id', 'uuid', col => col.references('workspaces.id'))
    .addColumn('credit_account_id', 'uuid', col => col.notNull().references('credit_accounts.id'))
    .addColumn('parent_batch_id', 'uuid', col =>
      col.references('task_batches.id').onDelete('set null'))
    .addColumn('idempotency_key', 'varchar(64)', col => col.unique().notNull())
    .addColumn('module', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`module IN ('image','video','tts','lipsync','agent')`))
    .addColumn('provider', 'varchar(50)', col => col.notNull())
    .addColumn('model', 'varchar(100)', col => col.notNull())
    .addColumn('prompt', 'text', col => col.notNull())
    .addColumn('params', 'jsonb', col => col.notNull().defaultTo('{}'))
    .addColumn('quantity', 'smallint', col => col.notNull().defaultTo(1))
    .addColumn('completed_count', 'smallint', col => col.notNull().defaultTo(0))
    .addColumn('failed_count', 'smallint', col => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().defaultTo('pending').check(
        db.fn.sql`status IN ('pending','processing','completed','partial_complete','failed')`))
    .addColumn('estimated_credits', 'integer', col => col.notNull())
    .addColumn('actual_credits', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('is_hidden', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('is_deleted', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema.createIndex('idx_batches_user').on('task_batches').columns(['user_id', 'created_at']).execute()
  await db.schema.createIndex('idx_batches_idem').on('task_batches').columns(['idempotency_key']).execute()
  // Partial index for timeout-guardian: efficiently scans only 'processing' rows
  await db.schema
    .createIndex('idx_batches_processing')
    .on('task_batches')
    .columns(['status', 'processing_started_at'])
    .where('status', '=', 'processing')
    .execute()

  // tasks
  await db.schema
    .createTable('tasks')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('batch_id', 'uuid', col => col.notNull().references('task_batches.id'))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('version_index', 'smallint', col => col.notNull())
    .addColumn('queue_job_id', 'varchar(255)')
    .addColumn('external_task_id', 'varchar(255)')
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().defaultTo('pending').check(
        db.fn.sql`status IN ('pending','processing','completed','failed')`))
    .addColumn('retry_count', 'smallint', col => col.notNull().defaultTo(0))
    .addColumn('estimated_credits', 'integer', col => col.notNull())
    .addColumn('credits_cost', 'integer')
    .addColumn('provider_cost_raw', 'jsonb')
    .addColumn('processing_started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('error_message', 'text')
    .execute()

  await db.schema.createIndex('idx_tasks_batch').on('tasks').columns(['batch_id']).execute()
  await db.schema.createIndex('idx_tasks_ext_id').on('tasks').columns(['external_task_id']).execute()

  // assets
  await db.schema
    .createTable('assets')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('task_id', 'uuid', col => col.unique().notNull().references('tasks.id'))
    .addColumn('batch_id', 'uuid', col => col.notNull().references('task_batches.id'))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('type', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`type IN ('image','video','audio')`))
    .addColumn('storage_url', 'text')
    .addColumn('original_url', 'text')
    .addColumn('transfer_status', 'varchar(20)', col =>
      col.notNull().defaultTo('pending').check(
        db.fn.sql`transfer_status IN ('pending','completed','failed')`))
    .addColumn('file_size', 'bigint')
    .addColumn('duration', 'integer')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('metadata', 'jsonb', col => col.defaultTo('{}'))
    .addColumn('is_deleted', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema.createIndex('idx_assets_user').on('assets').columns(['user_id', 'created_at']).execute()
  await db.schema.createIndex('idx_assets_batch').on('assets').columns(['batch_id']).execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('assets').execute()
  await db.schema.dropTable('tasks').execute()
  await db.schema.dropTable('task_batches').execute()
}
```

**Step 2: Create 007_security.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('prompt_filter_logs')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('prompt', 'text', col => col.notNull())
    .addColumn('matched_rules', 'jsonb', col => col.notNull().defaultTo('[]'))
    .addColumn('action', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`action IN ('pass','rejected')`))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createTable('webhook_logs')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('provider', 'varchar(50)', col => col.notNull())
    .addColumn('external_task_id', 'varchar(255)', col => col.notNull())
    .addColumn('payload', 'jsonb', col => col.notNull())
    .addColumn('signature_valid', 'boolean', col => col.notNull())
    .addColumn('processed_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createIndex('idx_webhook_ext_id')
    .on('webhook_logs')
    .columns(['external_task_id'])
    .execute()

  await db.schema
    .createTable('payment_orders')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('order_no', 'varchar(64)', col => col.unique().notNull())
    .addColumn('provider', 'varchar(50)', col => col.notNull())
    .addColumn('provider_order_id', 'varchar(255)')
    .addColumn('type', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`type IN ('topup','subscription')`))
    .addColumn('amount_fen', 'integer', col => col.notNull())
    .addColumn('credits', 'integer')
    .addColumn('plan_id', 'uuid', col => col.references('subscription_plans.id'))
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().defaultTo('pending').check(
        db.fn.sql`status IN ('pending','paid','failed','refunded')`))
    .addColumn('paid_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema.createIndex('idx_payment_orders_user').on('payment_orders').columns(['user_id', 'created_at']).execute()
  await db.schema.createIndex('idx_payment_orders_no').on('payment_orders').columns(['order_no']).execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('payment_orders').execute()
  await db.schema.dropTable('webhook_logs').execute()
  await db.schema.dropTable('prompt_filter_logs').execute()
}
```

**Step 3: Create 008_providers.ts**

```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('providers')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('code', 'varchar(50)', col => col.unique().notNull())
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('region', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`region IN ('cn','global')`))
    .addColumn('modules', 'jsonb', col => col.notNull().defaultTo('[]'))
    .addColumn('is_active', 'boolean', col => col.notNull().defaultTo(true))
    .addColumn('config', 'jsonb', col => col.notNull().defaultTo('{}'))
    .execute()

  await db.schema
    .createTable('provider_models')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('provider_id', 'uuid', col => col.notNull().references('providers.id'))
    .addColumn('code', 'varchar(100)', col => col.notNull())
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('module', 'varchar(20)', col =>
      col.notNull().check(db.fn.sql`module IN ('image','video','tts','lipsync','agent')`))
    .addColumn('credit_cost', 'integer', col => col.notNull())
    .addColumn('params_pricing', 'jsonb', col => col.notNull().defaultTo('{}'))
    .addColumn('params_schema', 'jsonb', col => col.notNull().defaultTo('{}'))
    .addColumn('is_active', 'boolean', col => col.notNull().defaultTo(true))
    .addUniqueConstraint('uq_provider_models_code', ['provider_id', 'code'])
    .execute()

  await db.schema.createIndex('idx_provider_models_provider').on('provider_models').columns(['provider_id']).execute()

  await db.schema
    .createTable('voice_profiles')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', col => col.notNull().references('users.id'))
    .addColumn('name', 'varchar(100)', col => col.notNull())
    .addColumn('provider', 'varchar(50)', col => col.notNull())
    .addColumn('external_voice_id', 'varchar(255)', col => col.notNull())
    .addColumn('sample_asset_id', 'uuid', col => col.references('assets.id'))
    .addColumn('status', 'varchar(20)', col =>
      col.notNull().defaultTo('pending').check(
        db.fn.sql`status IN ('pending','ready','failed')`))
    .addColumn('is_deleted', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()

  await db.schema
    .createTable('prompt_filter_rules')
    .addColumn('id', 'uuid', col => col.primaryKey().defaultTo(db.fn.sql`gen_random_uuid()`))
    .addColumn('pattern', 'text', col => col.notNull())
    .addColumn('type', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`type IN ('keyword','regex')`))
    .addColumn('action', 'varchar(10)', col =>
      col.notNull().check(db.fn.sql`action IN ('reject','flag')`))
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', col => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', col => col.defaultTo(db.fn.sql`NOW()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('prompt_filter_rules').execute()
  await db.schema.dropTable('voice_profiles').execute()
  await db.schema.dropTable('provider_models').execute()
  await db.schema.dropTable('providers').execute()
}
```

**Step 4: Commit**

```bash
git add packages/db/migrations/006_tasks.ts packages/db/migrations/007_security.ts packages/db/migrations/008_providers.ts
git commit -m "feat: add DB migrations 006-008 (tasks, security, providers)"
```

---

## Task 9: DB Triggers (updated_at auto-refresh)

**Files:**
- Create: `packages/db/triggers.sql`

**Step 1: Create packages/db/triggers.sql**

```sql
-- Function: automatically set updated_at = NOW() on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_credit_accounts_updated_at
  BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_task_batches_updated_at
  BEFORE UPDATE ON task_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

The migration runner will apply this file AFTER all numbered migrations.

**Step 2: Commit**

```bash
git add packages/db/triggers.sql
git commit -m "feat: add updated_at trigger function for all tables"
```

---

## Task 10: DB Migration Runner + Seed Script

**Files:**
- Create: `packages/db/scripts/migrate.ts`
- Create: `packages/db/scripts/seed.ts`

**Step 1: Create packages/db/scripts/migrate.ts**

```typescript
import 'dotenv/config'
import { FileMigrationProvider, Migrator } from 'kysely'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb, closeDb } from '../src/client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const db = getDb()

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, '../migrations'),
    }),
  })

  const { error, results } = await migrator.migrateToLatest()

  results?.forEach(result => {
    if (result.status === 'Success') {
      console.log(`✅  Migration "${result.migrationName}" applied`)
    } else if (result.status === 'Error') {
      console.error(`❌  Migration "${result.migrationName}" failed`)
    }
  })

  if (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }

  // Apply triggers.sql after all table migrations
  const triggersPath = path.join(__dirname, '../triggers.sql')
  const triggersSql = await fs.readFile(triggersPath, 'utf-8')
  await db.executeQuery({ sql: triggersSql, parameters: [], query: { kind: 'RawNode', sqlFragments: [triggersSql], parameters: [] } } as never)
  console.log('✅  updated_at triggers applied')

  await closeDb()
  console.log('✅  All migrations complete')
}

main()
```

> Note: For applying raw SQL triggers, use `db.executeQuery` or a raw SQL execution method available in Kysely. If the above doesn't compile cleanly, use: `await sql`${rawSql}`.execute(db)` from `kysely` with template literal.

**Corrected trigger application:**

```typescript
import { sql } from 'kysely'
// ...
const triggersSql = await fs.readFile(triggersPath, 'utf-8')
await sql.raw(triggersSql).execute(db)
console.log('✅  updated_at triggers applied')
```

**Step 2: Create packages/db/scripts/seed.ts**

```typescript
import 'dotenv/config'
import { createHash } from 'crypto'
import { getDb, closeDb } from '../src/client.js'

async function main() {
  const db = getDb()

  console.log('🌱  Seeding database...')

  // 1. Subscription plan (free tier)
  const [plan] = await db
    .insertInto('subscription_plans')
    .values({
      name: 'Free',
      tier: 'free',
      credits_monthly: 100,
      max_concurrency: 2,
      max_batch_size: 2,
      features: JSON.stringify({ watermark: true, hd: false }),
      is_active: true,
    })
    .onConflict(oc => oc.column('tier').doNothing())   // idempotent re-run
    .returningAll()
    .execute()
  console.log('✅  subscription_plans seeded')

  // 2. Test user
  // Password: "testpassword123" — hashed with bcrypt (placeholder hash for Phase 0)
  const passwordHash = '$2b$10$placeholder_hash_for_phase0_only_not_real'
  const [user] = await db
    .insertInto('users')
    .values({
      email: 'test@aigc.local',
      username: 'testuser',
      password_hash: passwordHash,
      role: 'admin',
      status: 'active',
      plan_tier: 'free',
    })
    .onConflict(oc => oc.column('email').doNothing())
    .returningAll()
    .execute()
  console.log('✅  users seeded (test@aigc.local)')

  // 3. User subscription (active)
  await db
    .insertInto('user_subscriptions')
    .values({
      user_id: user.id,
      plan_id: plan.id,
      status: 'active',
      started_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    })
    .execute()
  console.log('✅  user_subscriptions seeded')

  // 4. Credit account for test user
  await db
    .insertInto('credit_accounts')
    .values({
      owner_type: 'user',
      user_id: user.id,
      balance: 99999,  // Phase 0: effectively unlimited
      frozen_credits: 0,
      total_earned: 99999,
      total_spent: 0,
    })
    .onConflict(oc => oc.column('user_id').doNothing())
    .execute()
  console.log('✅  credit_accounts seeded')

  // 5. Provider: Kling (可灵)
  const [provider] = await db
    .insertInto('providers')
    .values({
      code: 'kling',
      name: '可灵 AI',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({
        api_base_url: 'https://api.klingai.com',
      }),
    })
    .onConflict(oc => oc.column('code').doNothing())
    .returningAll()
    .execute()
  console.log('✅  providers seeded (kling)')

  // 6. Provider model: kling-v1.6-pro (image)
  await db
    .insertInto('provider_models')
    .values({
      provider_id: provider.id,
      code: 'kling-v1.6-pro',
      name: '可灵 v1.6 Pro',
      module: 'image',
      credit_cost: 10,
      params_pricing: JSON.stringify({}),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] },
          style: { type: 'string' },
        },
      }),
      is_active: true,
    })
    .onConflict(oc => oc.constraint('uq_provider_models_code').doNothing())
    .execute()
  console.log('✅  provider_models seeded (kling-v1.6-pro)')

  // 7. Prompt filter rule (keyword example)
  await db
    .insertInto('prompt_filter_rules')
    .values({
      pattern: '违禁词示例',
      type: 'keyword',
      action: 'reject',
      description: 'Phase 0 测试用敏感词规则',
      is_active: true,
    })
    .execute()
  console.log('✅  prompt_filter_rules seeded')

  await closeDb()
  console.log('🎉  Seed complete')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

**Step 3: Add dotenv to packages/db**

Add to packages/db/package.json dependencies:
```json
"dotenv": "^16.0.0"
```

**Step 4: Commit**

```bash
git add packages/db/scripts/
git commit -m "feat: add migration runner and seed script for Phase 0"
```

---

## Task 11: apps/api — Fastify Service Skeleton

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/plugins/api-key.ts`
- Create: `apps/api/src/routes/healthz.ts`

**Step 1: Create apps/api/package.json**

```json
{
  "name": "@aigc/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@aigc/db": "workspace:*",
    "@aigc/types": "workspace:*",
    "fastify": "^4.26.0",
    "@fastify/sensible": "^5.0.0",
    "dotenv": "^16.0.0",
    "ioredis": "^5.3.0",
    "pino": "^8.0.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

**Step 3: Create apps/api/src/plugins/api-key.ts**

```typescript
import type { FastifyInstance } from 'fastify'

/**
 * Phase 0: Simple static X-API-Key authentication.
 * Phase 4: Replace with JWT middleware.
 */
export async function apiKeyPlugin(app: FastifyInstance) {
  const expectedKey = process.env.API_KEY

  if (!expectedKey) {
    throw new Error('API_KEY environment variable is required')
  }

  app.addHook('onRequest', async (request, reply) => {
    // Skip healthz — it should be publicly accessible for load balancers
    if (request.url === '/api/v1/healthz') return

    const providedKey = request.headers['x-api-key']
    if (providedKey !== expectedKey) {
      reply.status(401).send({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Invalid or missing X-API-Key' },
      })
    }
  })
}
```

**Step 4: Create apps/api/src/routes/healthz.ts**

```typescript
import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'

export async function healthzRoutes(app: FastifyInstance) {
  app.get('/healthz', async (request, reply) => {
    const db = getDb()
    const redis = app.redis  // set in app.ts

    // Check DB
    let dbStatus = 'ok'
    try {
      await db.selectFrom('users').select('id').limit(1).execute()
    } catch {
      dbStatus = 'error'
    }

    // Check Redis
    let redisStatus = 'ok'
    try {
      await redis.ping()
    } catch {
      redisStatus = 'error'
    }

    const isHealthy = dbStatus === 'ok' && redisStatus === 'ok'
    reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'degraded',
      db: dbStatus,
      redis: redisStatus,
    })
  })
}
```

**Step 5: Create apps/api/src/app.ts**

```typescript
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import Redis from 'ioredis'
import { apiKeyPlugin } from './plugins/api-key.js'
import { healthzRoutes } from './routes/healthz.js'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  await app.register(sensible)

  // Attach Redis client to fastify instance
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  app.decorate('redis', redis)

  // Plugins
  await app.register(apiKeyPlugin)

  // Routes (all prefixed with /api/v1)
  await app.register(async (v1) => {
    await v1.register(healthzRoutes)
  }, { prefix: '/api/v1' })

  return app
}
```

**Step 6: Create apps/api/src/index.ts**

```typescript
import 'dotenv/config'
import { buildApp } from './app.js'

async function main() {
  const app = await buildApp()

  const host = process.env.API_HOST ?? '0.0.0.0'
  const port = parseInt(process.env.API_PORT ?? '3001', 10)

  await app.listen({ host, port })
  console.log(`API listening on http://${host}:${port}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

**Step 7: Install api dependencies**

Run: `pnpm install` (from root)

**Step 8: Test the API starts**

Run: `pnpm --filter @aigc/api dev`
Expected: `API listening on http://0.0.0.0:3001` in logs

**Step 9: Test healthz endpoint**

Run: `curl http://localhost:3001/api/v1/healthz`
Expected: `{"status":"ok","db":"ok","redis":"ok"}`

**Step 10: Test API key rejection**

Run: `curl -H "X-API-Key: wrong" http://localhost:3001/api/v1/some-route`
Expected: 401 with `AUTH_REQUIRED`

**Step 11: Commit**

```bash
git add apps/api/
git commit -m "feat: add apps/api Fastify skeleton with X-API-Key auth and /healthz"
```

---

## Task 12: apps/worker — BullMQ Worker Skeleton

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`

**Step 1: Create apps/worker/package.json**

```json
{
  "name": "@aigc/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@aigc/db": "workspace:*",
    "@aigc/types": "workspace:*",
    "bullmq": "^5.0.0",
    "dotenv": "^16.0.0",
    "ioredis": "^5.3.0",
    "pino": "^8.0.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 2: Create apps/worker/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

**Step 3: Create apps/worker/src/index.ts**

```typescript
import 'dotenv/config'
import { Worker } from 'bullmq'
import Redis from 'ioredis'
import pino from 'pino'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,  // required by BullMQ
})

// Phase 0: placeholder workers — actual processing added in Phase 1
const imageWorker = new Worker(
  'image-queue',
  async (job) => {
    logger.info({ jobId: job.id }, 'Image job received (Phase 0 stub)')
    // Phase 1: invoke submit.pipeline
  },
  { connection }
)

imageWorker.on('completed', job => {
  logger.info({ jobId: job.id }, 'Job completed')
})

imageWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed')
})

logger.info('Worker service started — listening on image-queue')

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down worker...')
  await imageWorker.close()
  await connection.quit()
  process.exit(0)
})
```

**Step 4: Test worker starts**

Run: `pnpm --filter @aigc/worker dev`
Expected: `Worker service started — listening on image-queue`

**Step 5: Commit**

```bash
git add apps/worker/
git commit -m "feat: add apps/worker BullMQ skeleton with image-queue stub"
```

---

## Task 13: apps/web — Next.js 14 Skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`

**Step 1: Create apps/web/package.json**

```json
{
  "name": "@aigc/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@aigc/types": "workspace:*",
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0"
  }
}
```

**Step 2: Create apps/web/next.config.mjs**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@aigc/types'],
}

export default nextConfig
```

**Step 3: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create apps/web/src/app/layout.tsx**

```tsx
export const metadata = {
  title: 'AIGC 创作平台',
  description: 'AI-powered content generation platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
```

**Step 5: Create apps/web/src/app/page.tsx**

```tsx
export default function HomePage() {
  return (
    <main>
      <h1>AIGC 创作平台</h1>
      <p>Phase 0 — Infrastructure Ready</p>
    </main>
  )
}
```

**Step 6: Test web starts**

Run: `pnpm --filter @aigc/web dev`
Expected: Next.js dev server on http://localhost:3000

**Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat: add apps/web Next.js 14 skeleton"
```

---

## Task 14: End-to-End Acceptance Test

**Step 1: Ensure Docker services are running**

Run: `docker compose ps`
Expected: postgres, redis, minio all healthy

**Step 2: Run all migrations**

Run: `pnpm db:migrate`
Expected:
```
✅  Migration "001_users" applied
✅  Migration "002_subscription_plans" applied
✅  Migration "003_auth_tables" applied
✅  Migration "004_teams" applied
✅  Migration "005_credits" applied
✅  Migration "006_tasks" applied
✅  Migration "007_security" applied
✅  Migration "008_providers" applied
✅  updated_at triggers applied
✅  All migrations complete
```

**Step 3: Verify all tables exist in PostgreSQL**

Run: `docker exec -it <postgres-container> psql -U aigc -d aigc_dev -c "\dt"`
Expected: 21 tables listed

**Step 4: Run seed**

Run: `pnpm db:seed`
Expected:
```
🌱  Seeding database...
✅  subscription_plans seeded
✅  users seeded (test@aigc.local)
✅  user_subscriptions seeded
✅  credit_accounts seeded
✅  providers seeded (kling)
✅  provider_models seeded (kling-v1.6-pro)
✅  prompt_filter_rules seeded
🎉  Seed complete
```

**Step 5: Start all three services**

Run: `pnpm dev` (from root, runs all apps via Turborepo)
Expected: api on :3001, worker on background, web on :3000

**Step 6: Test healthz without API key (should pass)**

Run: `curl http://localhost:3001/api/v1/healthz`
Expected: `{"status":"ok","db":"ok","redis":"ok"}`

**Step 7: Test authenticated endpoint with wrong key**

Run: `curl -H "X-API-Key: wrong" http://localhost:3001/api/v1/credits/balance`
Expected: `401 AUTH_REQUIRED`

**Step 8: Test authenticated endpoint with correct key**

Run: `curl -H "X-API-Key: test-api-key-phase0" http://localhost:3001/api/v1/credits/balance`
Expected: `404` (route not yet implemented — that's correct for Phase 0)

**Step 9: Final commit**

```bash
git add .
git commit -m "feat: Phase 0 complete — monorepo, migrations, seeds, service skeletons, healthz"
```

---

## Summary

Phase 0 delivers:

| Component | Status |
|-----------|--------|
| Monorepo (pnpm + Turborepo) | ✅ Task 1 |
| Shared types (`@aigc/types`) | ✅ Task 2 |
| Docker Compose (PG + Redis + MinIO) | ✅ Task 3 |
| DB package + Kysely client | ✅ Task 4 |
| DB schema types (21 tables) | ✅ Task 5 |
| Migrations 001-003 (users, plans, auth) | ✅ Task 6 |
| Migrations 004-005 (teams, credits) | ✅ Task 7 |
| Migrations 006-008 (tasks, security, providers) | ✅ Task 8 |
| updated_at triggers | ✅ Task 9 |
| Migration runner + seed script | ✅ Task 10 |
| API service + X-API-Key + /healthz | ✅ Task 11 |
| Worker service skeleton | ✅ Task 12 |
| Web service skeleton | ✅ Task 13 |
| End-to-end acceptance test | ✅ Task 14 |
