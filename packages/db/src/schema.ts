import type { ColumnType, Generated } from 'kysely'

type Timestamp = ColumnType<Date, Date | string, Date | string>
type JsonArrayInput<T> = T[] | string

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
  generation_defaults: ColumnType<Record<string, unknown>, string | undefined, string>
  created_at: Generated<Date>
  updated_at: Generated<Date>
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
  created_at: Generated<Date>
}

export interface RefreshTokensTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  expires_at: Timestamp
  revoked_at: Timestamp | null
  created_at: Generated<Date>
}

export interface EmailVerificationsTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  type: 'verify_email' | 'reset_password'
  expires_at: Timestamp
  used_at: Timestamp | null
  created_at: Generated<Date>
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export interface TeamsTable {
  id: Generated<string>
  name: string
  owner_id: string
  plan_tier: 'free' | 'basic' | 'pro' | 'enterprise'
  team_type: Generated<'standard' | 'company_a' | 'avatar_enabled'>
  allow_member_topup: Generated<boolean>
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface TeamMembersTable {
  team_id: string
  user_id: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  joined_at: Generated<Date>
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
  created_at: Generated<Date>
}

export interface WorkspacesTable {
  id: Generated<string>
  team_id: string
  name: string
  description: string | null
  created_by: string
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
}

export interface WorkspaceMembersTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  role: 'admin' | 'editor' | 'viewer'
  created_at: Generated<Date>
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
  updated_at: Generated<Date>
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
  created_at: Generated<Date>
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
  source: 'generation' | 'studio' | 'canvas'
  module:
    | 'image'
    | 'video'
    | 'tts'
    | 'lipsync'
    | 'agent'
    | 'avatar'
    | 'action_imitation'
    | 'storyboard'
    | 'upload'
    | 'music'
    | 'music_voice_clone'
    | 'picture_book'
    | 'short_drama'
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
  canvas_id: string | null
  canvas_node_id: string | null
  video_studio_project_id: string | null
  picture_book_project_id: string | null
  short_drama_project_id: string | null
  short_drama_episode_id: string | null
  short_drama_segment_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
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
  created_at: Generated<Date>
}

// ─── Security & Audit ─────────────────────────────────────────────────────────

export interface PromptFilterLogsTable {
  id: Generated<string>
  user_id: string
  prompt: string
  matched_rules: ColumnType<unknown, string, string>
  action: 'pass' | 'rejected'
  created_at: Generated<Date>
}

export interface WebhookLogsTable {
  id: Generated<string>
  provider: string
  external_task_id: string
  payload: ColumnType<unknown, string, string>
  signature_valid: boolean
  processed_at: Generated<Date>
}

export interface PaymentOrdersTable {
  id: Generated<string>
  life_order_id: string
  user_id: string
  team_id: string | null
  credit_account_id: string | null
  amount_fen: number
  credits_to_grant: number
  status: Generated<'pending' | 'paid' | 'failed' | 'refunded'>
  order_type: Generated<'topup' | 'subscription'>
  platform_code: string
  callback_payload: ColumnType<unknown, string | undefined, string | undefined> | null
  created_at: Generated<Date>
  paid_at: Timestamp | null
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
  description: string | null
  module:
    | 'image'
    | 'video'
    | 'tts'
    | 'lipsync'
    | 'agent'
    | 'avatar'
    | 'action_imitation'
    | 'music'
    | 'music_voice_clone'
  category_references: ColumnType<unknown, string, string> | null
  params_pricing: ColumnType<unknown, string, string>
  params_schema: ColumnType<unknown, string, string>
  resolution: string | null
  avatar: string | null
  is_active: Generated<boolean>
}

export interface TeamModelConfigsTable {
  id: Generated<string>
  team_id: string
  model_id: string
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ProviderSystemVoicesTable {
  id: Generated<string>
  provider_id: string
  voice_id: string
  name: string
  language: string
  metadata: ColumnType<unknown, string, string>
  demo_audio_url: string | null
  is_active: Generated<boolean>
  created_at: Generated<Date>
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
  created_at: Generated<Date>
}

export interface PromptFilterRulesTable {
  id: Generated<string>
  pattern: string
  type: 'keyword' | 'regex'
  action: 'reject' | 'flag'
  description: string | null
  is_active: Generated<boolean>
  created_at: Generated<Date>
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

export interface CanvasesTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  name: string
  thumbnail_url: string | null
  structure_data: ColumnType<unknown, string, string>
  version: Generated<number>
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface CanvasNodeOutputsTable {
  id: Generated<string>
  canvas_id: string
  node_id: string
  batch_id: string | null
  output_urls: ColumnType<string[], string, string>
  params_snapshot: ColumnType<unknown, string | null, string | null> | null
  is_selected: Generated<boolean>
  created_at: Generated<Date>
}

export interface CanvasAgentSessionsTable {
  id: Generated<string>
  canvas_id: string
  session: ColumnType<unknown, string, string>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}

// ─── Video Studio ─────────────────────────────────────────────────────────────

export interface VideoStudioProjectsTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  name: string
  wizard_state: ColumnType<unknown, string, string>
  project_type: Generated<'single' | 'series' | 'episode'>
  series_parent_id: string | null
  episode_index: number | null
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ProviderApiLogsTable {
  id: Generated<string>
  batch_id: string | null
  task_id: string | null
  user_id: string | null
  team_id: string | null
  workspace_id: string | null
  module: string
  provider: string
  model: string | null
  operation: string
  method: string
  endpoint: string
  request_url: string | null
  referer: string | null
  request_payload: ColumnType<unknown, string | null, string | null> | null
  request_truncated: Generated<boolean>
  response_status: number | null
  response_payload: ColumnType<unknown, string | null, string | null> | null
  response_truncated: Generated<boolean>
  external_task_id: string | null
  duration_ms: number | null
  status: 'success' | 'failed'
  error_message: string | null
  created_at: Generated<Date>
}

// ─── System Configs ───────────────────────────────────────────────────────────

export interface SystemCostConfigsTable {
  key: string
  label: string
  description: string | null
  credit_cost: number
  updated_at: Generated<Date>
}

// ─── Music ───────────────────────────────────────────────────────────────────

export interface MusicVoiceClonesTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  team_id: string
  batch_id: string | null
  task_id: string | null
  name: string
  description: string | null
  gender: Generated<'auto' | 'male' | 'female'>
  source_audio_url: string
  source_audio_storage_url: string | null
  voice_id: string | null
  external_voice_id: string | null
  external_task_id: string | null
  status: Generated<'pending' | 'processing' | 'ready' | 'failed'>
  error_message: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface MusicTracksTable {
  id: Generated<string>
  workspace_id: string
  user_id: string
  team_id: string
  batch_id: string | null
  task_id: string | null
  type: 'song' | 'instrumental'
  mode: 'inspiration' | 'custom'
  title: string | null
  prompt: string | null
  lyrics: string | null
  lyrics_sections: ColumnType<Array<Record<string, unknown>>, JsonArrayInput<Record<string, unknown>> | undefined, JsonArrayInput<Record<string, unknown>>>
  styles: ColumnType<string[], JsonArrayInput<string> | undefined, JsonArrayInput<string>>
  voice_clone_id: string | null
  voice_gender: Generated<'auto' | 'male' | 'female'>
  model: string
  cover_url: string | null
  cover_storage_url: string | null
  stream_url: string | null
  audio_url: string | null
  audio_storage_url: string | null
  flac_url: string | null
  flac_storage_url: string | null
  wav_url: string | null
  wav_storage_url: string | null
  duration_seconds: number | null
  external_task_id: string | null
  status: Generated<
    | 'pending'
    | 'lyrics_generating'
    | 'song_generating'
    | 'cover_generating'
    | 'transferring'
    | 'completed'
    | 'failed'
  >
  error_message: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

// ─── Short Drama ──────────────────────────────────────────────────────────────

export interface ShortDramaProjectsTable {
  id: Generated<string>
  workspace_id: string
  team_id: string
  user_id: string
  title: string
  prompt: string
  style: string
  aspect_ratio: string
  episode_count: number
  status: string
  active_step: string
  cover_url: string | null
  state: ColumnType<unknown, string, string>
  estimated_credits: number
  actual_credits: number
  draft_saved_at: Timestamp | null
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface ShortDramaSegmentsTable {
  id: Generated<string>
  project_id: string
  episode_number: number
  segment_id: string
  order_index: number
  title: string
  prompt: string
  mention_refs: ColumnType<unknown, string | undefined, string>
  duration_seconds: number
  status: Generated<'idle' | 'pending' | 'generating' | 'completed' | 'failed'>
  video_url: string | null
  video_batch_id: string | null
  video_task_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

// ─── AI Assistant Errors ──────────────────────────────────────────────────────

export interface AiAssistantErrorsTable {
  id: Generated<string>
  user_id: string
  http_status: number | null
  error_detail: string | null
  created_at: Generated<Date>
}

// ─── Picture Book ─────────────────────────────────────────────────────────────

export interface PictureBookProjectsTable {
  id: Generated<string>
  workspace_id: string
  team_id: string
  user_id: string
  title: string
  prompt: string
  style: string
  page_count: 10 | 15 | 20
  status: Generated<
    | 'draft'
    | 'script_ready'
    | 'assets_ready'
    | 'storyboard_ready'
    | 'completed'
    | 'failed'
  >
  active_step: Generated<'script' | 'assets' | 'storyboard' | 'preview'>
  cover_url: string | null
  state: ColumnType<unknown, string | undefined, string>
  draft_saved_at: Timestamp | null
  estimated_credits: Generated<number>
  actual_credits: Generated<number>
  is_deleted: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface PictureBookProjectChargesTable {
  id: Generated<string>
  project_id: string
  workspace_id: string
  team_id: string
  user_id: string
  charge_type: string
  model: string
  target_count: number
  estimated_credits: number
  actual_credits: number | null
  status: Generated<
    | 'pending'
    | 'processing'
    | 'completed'
    | 'partial_failed'
    | 'failed'
    | 'refunded'
  >
  batch_ids: ColumnType<string[], JsonArrayInput<string> | undefined, JsonArrayInput<string>>
  metadata: ColumnType<unknown, string | undefined, string>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface PictureBookProjectAssetsTable {
  id: Generated<string>
  project_id: string
  kind:
    | 'character'
    | 'background'
    | 'page_image'
    | 'page_audio_zh'
    | 'page_audio_en'
  ref_id: string
  name: string
  prompt: string
  selected_asset_url: string | null
  selected_asset_id: string | null
  batch_id: string | null
  status: Generated<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>
  metadata: ColumnType<unknown, string | undefined, string>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

// ─── Submission Errors ────────────────────────────────────────────────────────

export interface SubmissionErrorsTable {
  id: Generated<string>
  user_id: string
  source: 'generate_api' | 'client'
  error_code: string
  http_status: number | null
  detail: string | null
  model: string | null
  canvas_id: string | null
  created_at: Generated<Date>
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
  provider_api_logs: ProviderApiLogsTable
  system_cost_configs: SystemCostConfigsTable
  payment_orders: PaymentOrdersTable
  providers: ProvidersTable
  provider_models: ProviderModelsTable
  provider_system_voices: ProviderSystemVoicesTable
  team_model_configs: TeamModelConfigsTable
  voice_profiles: VoiceProfilesTable
  prompt_filter_rules: PromptFilterRulesTable
  canvases: CanvasesTable
  canvas_node_outputs: CanvasNodeOutputsTable
  canvas_agent_sessions: CanvasAgentSessionsTable
  video_studio_projects: VideoStudioProjectsTable
  music_voice_clones: MusicVoiceClonesTable
  music_tracks: MusicTracksTable
  picture_book_projects: PictureBookProjectsTable
  picture_book_project_charges: PictureBookProjectChargesTable
  picture_book_project_assets: PictureBookProjectAssetsTable
  short_drama_projects: ShortDramaProjectsTable
  short_drama_segments: ShortDramaSegmentsTable
  ai_assistant_errors: AiAssistantErrorsTable
  submission_errors: SubmissionErrorsTable
}
