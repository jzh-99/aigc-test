import type { BatchStatus, TaskStatus, TransferStatus, AssetType } from './db.js'

export interface GenerateImageRequest {
  idempotency_key: string
  model: string
  prompt: string
  quantity?: number
  params?: Record<string, unknown>
  workspace_id: string
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
  role: string
  owner: { email: string; username: string } | null
  workspaces: UserWorkspace[]
}

export interface UserWorkspace {
  id: string
  name: string
  role: string
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
  owner_email: string
  owner_username?: string
  owner_password?: string
  initial_credits?: number
}

export interface CreateWorkspaceRequest {
  name: string
  description?: string
}
