import type { BatchStatus, TaskStatus, TransferStatus, AssetType, VideoCategory, ImageCategory, CategoryReferenceKey } from './db.js'

export type ReferenceKind = 'image' | 'video' | 'audio'

export interface CategoryReferenceLimit {
  min: number
  max: number
}

export interface CategoryReferenceConfig {
  label: string
  limits: Record<ReferenceKind, CategoryReferenceLimit>
}

export type CategoryReferences = Partial<Record<CategoryReferenceKey, CategoryReferenceConfig>>
export const ACTIVE_IMAGE_CATEGORY: ImageCategory = 'image_to_image'

export interface VideoReferenceCounts {
  image: number
  video: number
  audio: number
}

export interface VideoBillingInput {
  generatedDuration?: number | null
  referenceVideoDurations?: number[]
  unitPrice: number
  fallbackCreditCost: number
}

function normalizePositiveSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function calculateReferenceVideoDurationSeconds(referenceVideoDurations?: number[]): number {
  const total = (referenceVideoDurations ?? []).reduce((sum, duration) => sum + normalizePositiveSeconds(duration), 0)
  return total > 0 ? Math.ceil(total) : 0
}

export function calculateVideoEstimatedCredits(input: VideoBillingInput): number {
  const generatedDuration = normalizePositiveSeconds(input.generatedDuration)
  const referenceDuration = calculateReferenceVideoDurationSeconds(input.referenceVideoDurations)
  const referenceCredits = referenceDuration * input.unitPrice
  const generatedCredits = generatedDuration > 0
    ? generatedDuration * input.unitPrice
    : input.fallbackCreditCost

  return generatedCredits + referenceCredits
}

export interface VideoLimitValidationResult {
  valid: boolean
  message?: string
}

const REFERENCE_KINDS: ReferenceKind[] = ['image', 'video', 'audio']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLimit(value: unknown): value is CategoryReferenceLimit {
  if (!isPlainObject(value)) return false
  const min = value.min
  const max = value.max
  return typeof min === 'number' && typeof max === 'number' && Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min
}

function isCategoryConfig(value: unknown): value is CategoryReferenceConfig {
  if (!isPlainObject(value) || typeof value.label !== 'string' || !isPlainObject(value.limits)) return false
  const limits = value.limits
  return REFERENCE_KINDS.every((kind) => isLimit(limits[kind]))
}

export function parseCategoryReferences(raw: unknown): CategoryReferences {
  const value = typeof raw === 'string'
    ? (() => {
        try {
          return JSON.parse(raw) as unknown
        } catch {
          return null
        }
      })()
    : raw

  if (!isPlainObject(value)) return {}

  const out: CategoryReferences = {}
  if (isCategoryConfig(value.image_to_image)) out.image_to_image = value.image_to_image
  if (isCategoryConfig(value.text_to_image)) out.text_to_image = value.text_to_image
  if (isCategoryConfig(value.multimodal)) out.multimodal = value.multimodal
  if (isCategoryConfig(value.frames)) out.frames = value.frames
  return out
}

export function getVideoCategoryKeys(categoryReferences: CategoryReferences): VideoCategory[] {
  return (['multimodal', 'frames'] as const).filter((key) => !!categoryReferences[key])
}

export function getMaxVideoReferenceLimits(categoryReferences: CategoryReferences): VideoReferenceCounts {
  return getVideoCategoryKeys(categoryReferences).reduce<VideoReferenceCounts>((acc, key) => {
    const limits = categoryReferences[key]?.limits
    if (!limits) return acc
    return {
      image: Math.max(acc.image, limits.image.max),
      video: Math.max(acc.video, limits.video.max),
      audio: Math.max(acc.audio, limits.audio.max),
    }
  }, { image: 0, video: 0, audio: 0 })
}

export function validateCategoryReferenceLimits(
  categoryReferences: CategoryReferences,
  category: CategoryReferenceKey,
  counts: VideoReferenceCounts,
): VideoLimitValidationResult {
  const config = categoryReferences[category]
  if (!config) return { valid: false, message: '当前模型不支持该生成模式' }

  for (const kind of REFERENCE_KINDS) {
    const count = counts[kind]
    const limit = config.limits[kind]
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
    if (count < limit.min) return { valid: false, message: `${config.label}至少需要 ${limit.min} 个${label}参考素材` }
    if (count > limit.max) return { valid: false, message: `${config.label}最多允许 ${limit.max} 个${label}参考素材` }
  }

  return { valid: true }
}

export function validateImageReferenceLimits(
  categoryReferences: CategoryReferences,
  category: ImageCategory,
  imageCount: number,
): VideoLimitValidationResult {
  const config = categoryReferences[category]
  if (!config) return { valid: false, message: '当前模型不支持该图片生成模式' }

  const limit = config.limits.image
  if (imageCount < limit.min) return { valid: false, message: `${config.label}至少需要 ${limit.min} 张参考图` }
  if (imageCount > limit.max) return { valid: false, message: `${config.label}最多允许 ${limit.max} 张参考图` }

  return { valid: true }
}

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
  queue_position?: number | null
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

export interface BatchStatsResponse {
  total_completed: number
  total_failed: number
  /** 成功率百分比（0-100），无数据时为 null */
  success_rate: number | null
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

export type AigcModule = 'image' | 'video' | 'tts' | 'lipsync' | 'agent' | 'avatar' | 'action_imitation'

/** 参数定价规则：不同分辨率对应不同底层模型和积分单价 */
export interface ParamsPricingRule {
  model: string       // 实际调用的底层模型 code
  resolution: string  // 分辨率标识，如 "720p"、"1080p"、"4k"
  unit_price: number  // 积分单价
}

export interface ModelItem {
  id: string
  code: string
  name: string
  description: string | null
  module: AigcModule
  category_references: CategoryReferences | unknown  // 模型支持的生成模式与参考素材数量限制
  credit_cost: number
  params_pricing: ParamsPricingRule[]
  params_schema: unknown  // JSON Schema for frontend dynamic form rendering
  resolution: string | null
  is_active: boolean
  provider_code: string
}

export interface TeamModelConfig {
  model_id: string
  is_active: boolean
}
