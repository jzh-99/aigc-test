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

export const PICTURE_BOOK_TEXT_MODEL = 'qwen3.6-plus'
export const PICTURE_BOOK_IMAGE_MODEL = 'seedream-5.0-lite'
export const PICTURE_BOOK_TTS_MODEL = 'speech-2.8-hd'

export type PictureBookStyle = typeof PICTURE_BOOK_STYLES[number]
export type PictureBookPageCount = typeof PICTURE_BOOK_PAGE_COUNTS[number]

export type PictureBookStepId =
  | 'script'
  | 'storyboard'
  | 'image'
  | 'voice'
  | 'export'

export type PictureBookProjectStatus =
  | 'draft'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'archived'

export type PictureBookGenerationStatus =
  | 'idle'
  | 'queued'
  | 'generating'
  | 'completed'
  | 'failed'

export type PictureBookAssetKind =
  | 'cover'
  | 'page_image'
  | 'voice_zh'
  | 'voice_en'
  | 'export_pdf'
  | 'export_video'

export type PictureBookChargeType =
  | 'project'
  | 'script'
  | 'image'
  | 'voice'
  | 'export'

export interface PictureBookLocalizedText {
  zh: string
  en: string
}

export interface PictureBookPageScript {
  page: number
  title?: string
  narration: PictureBookLocalizedText
  dialogue: PictureBookLocalizedText
  visualPrompt?: string
}

export interface PictureBookElement {
  id: string
  type: 'character' | 'background' | 'prop' | 'text'
  name: string
  prompt: string
  imageUrl?: string | null
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
  elements: PictureBookElement[]
}

export interface PictureBookState {
  projectId?: string
  status: PictureBookProjectStatus
  steps: {
    active: PictureBookStepId
    completed: PictureBookStepId[]
  }
  settings: {
    style: PictureBookStyle
    pageCount: PictureBookPageCount
    textModel: typeof PICTURE_BOOK_TEXT_MODEL
    imageModel: typeof PICTURE_BOOK_IMAGE_MODEL
    ttsModel: typeof PICTURE_BOOK_TTS_MODEL
    billingMode: PictureBookChargeType
  }
  scripts: PictureBookPageScript[]
  elements: PictureBookElement[]
  storyboard: PictureBookStoryboardPage[]
  errorMessage?: string | null
  updatedAt?: string
}

export interface MakeDefaultPictureBookStateInput {
  style?: unknown
  pageCount?: unknown
}

export interface NormalizePictureBookStateInput {
  projectId?: unknown
  status?: unknown
  steps?: {
    active?: unknown
    completed?: unknown
  }
  settings?: {
    style?: unknown
    pageCount?: unknown
  }
  scripts?: unknown
  elements?: unknown
  storyboard?: unknown
  errorMessage?: unknown
  updatedAt?: unknown
}

const DEFAULT_PICTURE_BOOK_STYLE: PictureBookStyle = '吉卜力风'
const DEFAULT_PICTURE_BOOK_PAGE_COUNT: PictureBookPageCount = 10
const PICTURE_BOOK_STEP_IDS: PictureBookStepId[] = ['script', 'storyboard', 'image', 'voice', 'export']
const PICTURE_BOOK_PROJECT_STATUSES: PictureBookProjectStatus[] = ['draft', 'generating', 'ready', 'failed', 'archived']

export function isPictureBookStyle(value: unknown): value is PictureBookStyle {
  return typeof value === 'string' && PICTURE_BOOK_STYLES.includes(value as PictureBookStyle)
}

export function isPictureBookPageCount(value: unknown): value is PictureBookPageCount {
  return typeof value === 'number' && PICTURE_BOOK_PAGE_COUNTS.includes(value as PictureBookPageCount)
}

function isPictureBookStepId(value: unknown): value is PictureBookStepId {
  return typeof value === 'string' && PICTURE_BOOK_STEP_IDS.includes(value as PictureBookStepId)
}

function isPictureBookProjectStatus(value: unknown): value is PictureBookProjectStatus {
  return typeof value === 'string' && PICTURE_BOOK_PROJECT_STATUSES.includes(value as PictureBookProjectStatus)
}

function normalizeStepIds(value: unknown): PictureBookStepId[] {
  if (!Array.isArray(value)) return []
  return value.filter(isPictureBookStepId)
}

export function makeDefaultPictureBookState(input: MakeDefaultPictureBookStateInput = {}): PictureBookState {
  return {
    status: 'draft',
    steps: {
      active: 'script',
      completed: [],
    },
    settings: {
      style: isPictureBookStyle(input.style) ? input.style : DEFAULT_PICTURE_BOOK_STYLE,
      pageCount: isPictureBookPageCount(input.pageCount) ? input.pageCount : DEFAULT_PICTURE_BOOK_PAGE_COUNT,
      textModel: PICTURE_BOOK_TEXT_MODEL,
      imageModel: PICTURE_BOOK_IMAGE_MODEL,
      ttsModel: PICTURE_BOOK_TTS_MODEL,
      billingMode: 'project',
    },
    scripts: [],
    elements: [],
    storyboard: [],
    errorMessage: null,
  }
}

export function normalizePictureBookState(input: NormalizePictureBookStateInput = {}): PictureBookState {
  const fallback = makeDefaultPictureBookState(input.settings)

  return {
    ...fallback,
    projectId: typeof input.projectId === 'string' ? input.projectId : fallback.projectId,
    status: isPictureBookProjectStatus(input.status) ? input.status : fallback.status,
    steps: {
      active: isPictureBookStepId(input.steps?.active) ? input.steps.active : fallback.steps.active,
      completed: normalizeStepIds(input.steps?.completed),
    },
    settings: fallback.settings,
    scripts: Array.isArray(input.scripts) ? (input.scripts as PictureBookPageScript[]) : fallback.scripts,
    elements: Array.isArray(input.elements) ? (input.elements as PictureBookElement[]) : fallback.elements,
    storyboard: Array.isArray(input.storyboard) ? (input.storyboard as PictureBookStoryboardPage[]) : fallback.storyboard,
    errorMessage: typeof input.errorMessage === 'string' ? input.errorMessage : fallback.errorMessage,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : fallback.updatedAt,
  }
}
