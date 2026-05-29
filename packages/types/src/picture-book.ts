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

export const PICTURE_BOOK_TEXT_MODEL = 'qwen3.6-plus'
export const PICTURE_BOOK_IMAGE_MODEL = 'seedream-5.0-lite'
export const PICTURE_BOOK_TTS_MODEL = 'speech-2.8-hd'

export type PictureBookStyle = typeof PICTURE_BOOK_STYLES[number]
export type PictureBookPageCount = typeof PICTURE_BOOK_PAGE_COUNTS[number]
export type PictureBookAspectRatio = typeof PICTURE_BOOK_ASPECT_RATIOS[number]
export type PictureBookStepId = 'script' | 'assets' | 'storyboard' | 'preview'
export type PictureBookProjectStatus = 'draft' | 'script_ready' | 'assets_ready' | 'storyboard_ready' | 'completed' | 'failed'
export type PictureBookGenerationStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
export type PictureBookAssetKind = 'character' | 'background' | 'page_image' | 'page_audio_zh' | 'page_audio_en'
export type PictureBookChargeType = 'project'

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
    textModel: typeof PICTURE_BOOK_TEXT_MODEL
    imageModel: typeof PICTURE_BOOK_IMAGE_MODEL
    ttsModel: typeof PICTURE_BOOK_TTS_MODEL
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

const DEFAULT_PICTURE_BOOK_STYLE: PictureBookStyle = '吉卜力风'
const DEFAULT_PICTURE_BOOK_PAGE_COUNT: PictureBookPageCount = 10
const DEFAULT_PICTURE_BOOK_ASPECT_RATIO: PictureBookAspectRatio = '16:9'
const PICTURE_BOOK_STEP_IDS: PictureBookStepId[] = ['script', 'assets', 'storyboard', 'preview']

export function isPictureBookStyle(value: unknown): value is PictureBookStyle {
  return typeof value === 'string' && PICTURE_BOOK_STYLES.includes(value as PictureBookStyle)
}

export function isPictureBookPageCount(value: unknown): value is PictureBookPageCount {
  return typeof value === 'number' && PICTURE_BOOK_PAGE_COUNTS.includes(value as PictureBookPageCount)
}

export function isPictureBookAspectRatio(value: unknown): value is PictureBookAspectRatio {
  return typeof value === 'string' && PICTURE_BOOK_ASPECT_RATIOS.includes(value as PictureBookAspectRatio)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPictureBookStepId(value: unknown): value is PictureBookStepId {
  return typeof value === 'string' && PICTURE_BOOK_STEP_IDS.includes(value as PictureBookStepId)
}

function normalizeStepIds(value: unknown): PictureBookStepId[] {
  if (!Array.isArray(value)) return []
  return value.filter(isPictureBookStepId)
}

function normalizeSettings(value: unknown): PictureBookState['settings'] {
  const settings = isPlainObject(value) ? value : {}

  return {
    style: isPictureBookStyle(settings.style) ? settings.style : DEFAULT_PICTURE_BOOK_STYLE,
    pageCount: isPictureBookPageCount(settings.pageCount) ? settings.pageCount : DEFAULT_PICTURE_BOOK_PAGE_COUNT,
    aspectRatio: isPictureBookAspectRatio(settings.aspectRatio) ? settings.aspectRatio : DEFAULT_PICTURE_BOOK_ASPECT_RATIO,
    textModel: PICTURE_BOOK_TEXT_MODEL,
    imageModel: PICTURE_BOOK_IMAGE_MODEL,
    ttsModel: PICTURE_BOOK_TTS_MODEL,
    voiceZhId: typeof settings.voiceZhId === 'string' ? settings.voiceZhId : undefined,
    voiceEnId: typeof settings.voiceEnId === 'string' ? settings.voiceEnId : undefined,
    billingMode: 'project',
  }
}

export function makeDefaultPictureBookState(input: unknown = {}): PictureBookState {
  const value = isPlainObject(input) ? input : {}

  return {
    steps: {
      active: 'script',
      completed: [],
    },
    locks: {
      script: false,
      assets: false,
    },
    script: {
      summaryZh: '',
      pages: [],
    },
    assets: {
      characters: [],
      backgrounds: [],
    },
    storyboard: [],
    settings: normalizeSettings(value),
    draft: {
      dirty: false,
    },
  }
}

export function normalizePictureBookState(input: unknown = {}): PictureBookState {
  const value = isPlainObject(input) ? input : {}
  const fallback = makeDefaultPictureBookState(value.settings)
  const steps = isPlainObject(value.steps) ? value.steps : {}
  const locks = isPlainObject(value.locks) ? value.locks : {}
  const script = isPlainObject(value.script) ? value.script : {}
  const assets = isPlainObject(value.assets) ? value.assets : {}
  const draft = isPlainObject(value.draft) ? value.draft : {}

  return {
    steps: {
      active: isPictureBookStepId(steps.active) ? steps.active : fallback.steps.active,
      completed: normalizeStepIds(steps.completed),
    },
    locks: {
      script: typeof locks.script === 'boolean' ? locks.script : fallback.locks?.script,
      assets: typeof locks.assets === 'boolean' ? locks.assets : fallback.locks?.assets,
    },
    script: {
      summaryZh: typeof script.summaryZh === 'string' ? script.summaryZh : fallback.script.summaryZh,
      pages: Array.isArray(script.pages) ? (script.pages as PictureBookPageScript[]) : fallback.script.pages,
    },
    assets: {
      characters: Array.isArray(assets.characters) ? (assets.characters as PictureBookElement[]) : fallback.assets.characters,
      backgrounds: Array.isArray(assets.backgrounds) ? (assets.backgrounds as PictureBookElement[]) : fallback.assets.backgrounds,
    },
    storyboard: Array.isArray(value.storyboard) ? (value.storyboard as PictureBookStoryboardPage[]) : fallback.storyboard,
    settings: fallback.settings,
    draft: {
      savedAt: typeof draft.savedAt === 'string' ? draft.savedAt : fallback.draft.savedAt,
      dirty: typeof draft.dirty === 'boolean' ? draft.dirty : fallback.draft.dirty,
      lastError: typeof draft.lastError === 'string' ? draft.lastError : fallback.draft.lastError,
    },
  }
}
