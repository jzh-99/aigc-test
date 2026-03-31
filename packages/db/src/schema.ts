import type { ColumnType, Generated } from 'kysely'

type Timestamp = ColumnType<Date, Date | string, Date | string>

// ─── Users & Auth ─────────────────────────────────────────────────────────────

export interface UsersTable {
  id: Generated<string>
  account: string
  email: string | null
  phone: string | null
  username: string
  password_hash: string
  avatar_url: string | null
  role: 'admin' | 'member'
  status: 'active' | 'suspended' | 'deleted'
  plan_tier: 'free' | 'basic' | 'pro' | 'enterprise'
  password_change_required: Generated<boolean>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface SubscriptionPlansTable {
  id: Generated<string>
  name: string
  tier: 'free' | 'basic' | 'pro' | 'enterprise'
  price_monthly: string | null
  price_yearly: string | null
  credits_monthly: number
  max_concurrency: number
  max_batch_size: number
  features: ColumnType<unknown, string, string>
  is_active: Generated<boolean>
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

// ─── Teams ────────────────────────────────────────────────────────────────────

export interface TeamsTable {
  id: Generated<string>
  name: string
  owner_id: string
  plan_tier: 'free' | 'basic' | 'pro' | 'enterprise'
  team_type: Generated<'standard' | 'company_a' | 'avatar_enabled'>
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

export interface TeamMembersTable {
  team_id: string
  user_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  joined_at: Generated<Timestamp>
  credit_quota: number | null
  credit_used: Generated<number>
  quota_period: 'weekly' | 'monthly' | null
  quota_reset_at: Timestamp | null
  priority_boost: Generated<boolean>
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
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Timestamp>
}

export interface WorkspaceMembersTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  role: 'admin' | 'editor' | 'viewer'
  created_at: Generated<Timestamp>
}

// ─── Credits ──────────────────────────────────────────────────────────────────

export interface CreditAccountsTable {
  id: Generated<string>
  owner_type: 'user' | 'team'
  user_id: string | null
  team_id: string | null
  balance: Generated<number>
  frozen_credits: Generated<number>
  total_earned: Generated<number>
  total_spent: Generated<number>
  updated_at: Generated<Timestamp>
}

export interface CreditsLedgerTable {
  id: Generated<string>
  credit_account_id: string
  user_id: string
  amount: number
  type: 'topup' | 'subscription' | 'freeze' | 'confirm' | 'refund' | 'bonus' | 'expire'
  task_id: string | null
  batch_id: string | null
  description: string | null
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
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation'
  provider: string
  model: string
  prompt: string
  params: ColumnType<unknown, string, string>
  quantity: Generated<number>
  completed_count: Generated<number>
  failed_count: Generated<number>
  status: 'pending' | 'processing' | 'completed' | 'partial_complete' | 'failed'
  estimated_credits: number
  actual_credits: Generated<number>
  is_hidden: Generated<boolean>
  is_deleted: Generated<boolean>
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
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>
  retry_count: Generated<number>
  estimated_credits: number
  credits_cost: number | null
  provider_cost_raw: ColumnType<unknown, string | null, string | null> | null
  processing_started_at: Timestamp | null
  completed_at: Timestamp | null
  error_message: string | null
}

export interface AssetsTable {
  id: Generated<string>
  task_id: string
  batch_id: string
  user_id: string
  type: 'image' | 'video' | 'audio'
  storage_url: string | null
  original_url: string | null
  thumbnail_url: string | null
  transfer_status: Generated<'pending' | 'completed' | 'failed'>
  file_size: number | null
  duration: number | null
  width: number | null
  height: number | null
  metadata: ColumnType<unknown, string | null, string | null>
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Timestamp>
}

// ─── Security & Audit ─────────────────────────────────────────────────────────

export interface PromptFilterLogsTable {
  id: Generated<string>
  user_id: string
  prompt: string
  matched_rules: ColumnType<unknown, string, string>
  action: 'pass' | 'rejected'
  created_at: Generated<Timestamp>
}

export interface WebhookLogsTable {
  id: Generated<string>
  provider: string
  external_task_id: string
  payload: ColumnType<unknown, string, string>
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
  status: Generated<'pending' | 'paid' | 'failed' | 'refunded'>
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
  modules: ColumnType<unknown, string, string>
  is_active: Generated<boolean>
  config: ColumnType<unknown, string, string>
}

export interface ProviderModelsTable {
  id: Generated<string>
  provider_id: string
  code: string
  name: string
  module: 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation'
  credit_cost: number
  params_pricing: ColumnType<unknown, string, string>
  params_schema: ColumnType<unknown, string, string>
  is_active: Generated<boolean>
}

export interface VoiceProfilesTable {
  id: Generated<string>
  user_id: string
  name: string
  provider: string
  external_voice_id: string
  sample_asset_id: string | null
  status: Generated<'pending' | 'ready' | 'failed'>
  is_deleted: Generated<boolean>
  created_at: Generated<Timestamp>
}

export interface PromptFilterRulesTable {
  id: Generated<string>
  pattern: string
  type: 'keyword' | 'regex'
  action: 'reject' | 'flag'
  description: string | null
  is_active: Generated<boolean>
  created_at: Generated<Timestamp>
}

// ─── Database Interface ───────────────────────────────────────────────────────

export interface Database {
  users: UsersTable
  subscription_plans: SubscriptionPlansTable
  user_subscriptions: UserSubscriptionsTable
  refresh_tokens: RefreshTokensTable
  email_verifications: EmailVerificationsTable
  teams: TeamsTable
  team_members: TeamMembersTable
  team_subscriptions: TeamSubscriptionsTable
  workspaces: WorkspacesTable
  workspace_members: WorkspaceMembersTable
  credit_accounts: CreditAccountsTable
  credits_ledger: CreditsLedgerTable
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
