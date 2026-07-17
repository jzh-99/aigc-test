export const PICTURE_BOOK_STYLES = [
  '扁平矢量风',
  '彩铅蜡笔风',
  '拼贴艺术风',
  '3D黏土盲盒风',
  '新中式水墨风',
  '美影厂剪纸风',
  '吉卜力风',
  '经典水彩风',
  '迪士尼/皮克斯3D风',
  '黑板粉笔画风',
  '复古版画风',
  '梦幻光影厚涂风',
] as const

export const PICTURE_BOOK_PAGE_COUNTS = [10, 15, 20] as const
export const PICTURE_BOOK_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const

export type PictureBookStyle = typeof PICTURE_BOOK_STYLES[number]
export type PictureBookPageCount = typeof PICTURE_BOOK_PAGE_COUNTS[number]
export type PictureBookAspectRatio = typeof PICTURE_BOOK_ASPECT_RATIOS[number]
export type PictureBookStepId = 'script' | 'assets' | 'storyboard' | 'preview'
export type PictureBookProjectStatus = 'draft' | 'generating' | 'script_ready' | 'assets_ready' | 'storyboard_ready' | 'completed' | 'failed'
export type PictureBookGenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
export type PictureBookAssetKind = 'character' | 'background' | 'page_image' | 'page_audio_zh' | 'page_audio_en'

export interface PictureBookLocalizedText {
  zh: string
  en: string
}

export interface PictureBookPageScript {
  page: number
  narration: PictureBookLocalizedText
  dialogue: PictureBookLocalizedText
  visualPrompt?: string
}

export interface PictureBookElement {
  id: string
  name: string
  prompt: string
  imageUrl?: string | null
  status?: PictureBookGenerationStatus
}

export interface PictureBookStoryboardPage {
  page: number
  script: PictureBookPageScript
  prompt: string
  imageUrl?: string | null
  voice: {
    zh?: string | null
    en?: string | null
  }
  status: PictureBookGenerationStatus
}

export interface PictureBookState {
  steps: {
    active: PictureBookStepId
    completed: PictureBookStepId[]
  }
  locks?: {
    script?: boolean
    assets?: boolean
  }
  script: {
    summaryZh: string
    pages: PictureBookPageScript[]
  }
  assets: {
    characters: PictureBookElement[]
    backgrounds: PictureBookElement[]
  }
  storyboard: PictureBookStoryboardPage[]
  settings: {
    style: PictureBookStyle
    pageCount: PictureBookPageCount
    aspectRatio: PictureBookAspectRatio
    textModel: 'qwen3.6-plus'
    imageModel: 'seedream-5.0-lite'
    ttsModel: 'speech-2.8-hd'
    voiceZhId?: string
    voiceEnId?: string
    billingMode: 'project'
  }
  draft: {
    savedAt?: string
    dirty: boolean
    lastError?: string
  }
}

export interface PictureBookProject {
  id: string
  workspaceId?: string
  workspace_id?: string
  teamId?: string
  ownerId?: string
  title: string
  prompt: string
  style: PictureBookStyle
  pageCount?: PictureBookPageCount
  page_count?: PictureBookPageCount
  status: PictureBookProjectStatus
  activeStep?: PictureBookStepId
  active_step?: PictureBookStepId
  coverUrl?: string | null
  cover_url?: string | null
  state: PictureBookState
  estimatedCredits?: number
  estimated_credits?: number
  actualCredits?: number
  actual_credits?: number
  draftSavedAt?: string | null
  draft_saved_at?: string | null
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

export interface PictureBookChargeSummary {
  estimatedCredits: number
  actualCredits: number
}

export interface PictureBookCharge {
  id: string
  project_id: string
  charge_type: string
  model: string
  target_count: number
  estimated_credits: number
  actual_credits: number | null
  status: string
  batch_ids: string[]
  metadata: unknown
  created_at: string
  updated_at: string
}

export interface PictureBookProjectListItem {
  id: string
  workspace_id: string
  title: string
  prompt: string
  style: PictureBookStyle
  page_count: PictureBookPageCount
  status: PictureBookProjectStatus
  active_step: PictureBookStepId
  cover_url?: string | null
  draft_saved_at?: string | null
  estimated_credits: number
  actual_credits: number
  created_at: string
  updated_at: string
}

export interface PictureBookTarget {
  kind?: PictureBookAssetKind | 'character' | 'background'
  ref_id: string
  language?: 'zh' | 'en'
}
