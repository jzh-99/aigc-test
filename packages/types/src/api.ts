import type { BatchStatus, TaskStatus, TransferStatus, AssetType } from './db.js'

export interface GenerateImageRequest {
  idempotency_key: string
  model: string
  prompt: string
  quantity?: number
  params?: Record<string, unknown>
  workspace_id: string
  canvas_id?: string
  canvas_node_id?: string
}

export interface TaskResponse {
  id: string
  version_index: number
  status: TaskStatus
  estimated_credits: number
  credits_cost: number | null
  error_message: string | null
  processing_started_at: string | null
  completed_at: string | null
  asset: AssetResponse | null
}

export interface AssetResponse {
  id: string
  type: AssetType
  original_url: string | null
  storage_url: string | null
  transfer_status: TransferStatus
  file_size: number | null
  width: number | null
  height: number | null
}

export interface BatchUser {
  id: string
  username: string
  avatar_url: string | null
}

export interface BatchResponse {
  id: string
  module: string
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
  created_at: string
  tasks: TaskResponse[]
  user?: BatchUser
}

export interface BatchListResponse {
  data: BatchResponse[]
  cursor: string | null
}

export interface BatchSSEEvent {
  event: 'batch_update'
  data: BatchResponse
}

// ─── Auth & User Management ─────────────────────────────────────────────────

export interface LoginRequest {
  identifier: string
  password: string
}

export interface AuthResponse {
  access_token: string
  user: UserProfile
}

export interface UserProfile {
  id: string
  email: string | null
  phone: string | null
  username: string
  avatar_url: string | null
  role: 'admin' | 'member'
  password_change_required: boolean
  teams: UserTeam[]
}

export interface UserTeam {
  id: string
  name: string
  role: string
  team_type: 'standard' | 'company_a' | 'avatar_enabled'
  owner: { email: string | null; username: string } | null
  workspaces: UserWorkspace[]
  allow_member_topup: boolean
}

export interface TopupPackage {
  id: string
  name: string
  amount_fen: number   // 分
  credits: number
  type: 'onetime' | 'monthly'
  tag?: string
}

export interface CreateOrderRequest {
  team_id?: string
  package_id: string
}

export interface CreateOrderResponse {
  order_id: string
  life_order_id: string
  pay_url: string
}

export interface CreditBalance {
  team_balance: number
  personal_balance: number
}

export interface UserWorkspace {
  id: string
  name: string
  role: string
}

export interface AcceptInviteRequest {
  token: string
  email?: string
  phone?: string
  password: string
  username: string
}

export interface InviteMemberRequest {
  email?: string
  phone?: string
  role?: string
  workspace_id?: string
  new_workspace_name?: string
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
  owner_email?: string
  owner_phone?: string
  owner_username?: string
  owner_password?: string
  initial_credits?: number
  team_type?: 'standard' | 'company_a' | 'avatar_enabled'
}

export interface CreateWorkspaceRequest {
  name: string
  description?: string
}
