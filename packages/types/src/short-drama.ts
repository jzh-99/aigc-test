// ============================================================================
// Constants
// ============================================================================

export const SHORT_DRAMA_STYLE_TABS = ['真人都市', '真人古风', '动漫'] as const

export const SHORT_DRAMA_ASPECT_RATIOS = ['9:16', '16:9'] as const

export const SHORT_DRAMA_EPISODE_COUNTS = [5, 10, 15, 20] as const

export const SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT = 50

export const SHORT_DRAMA_DEFAULT_DURATION_SECONDS = 4

export const SHORT_DRAMA_TEXT_MODEL = 'gemini-2.0-flash-exp'

export const SHORT_DRAMA_IMAGE_MODEL = 'volcengine-doubao-1.5-pro'

export const SHORT_DRAMA_VIDEO_MODEL = 'volcengine-doubao-1.5-pro'

// ============================================================================
// Types
// ============================================================================

export type ShortDramaStyleTab = (typeof SHORT_DRAMA_STYLE_TABS)[number]

export type ShortDramaAspectRatio = (typeof SHORT_DRAMA_ASPECT_RATIOS)[number]

export type ShortDramaStepId = 'script' | 'assets' | 'episodes' | 'export'

export type ShortDramaProjectStatus = 'draft' | 'generating' | 'completed' | 'failed'

export type ShortDramaGenerationStatus = 'idle' | 'pending' | 'generating' | 'completed' | 'failed'

export type ShortDramaAssetKind = 'character' | 'scene' | 'prop' | 'bgm'

export type ShortDramaAssetScope = 'global' | 'episode'

export type ShortDramaEpisodeStatus = 'idle' | 'generating' | 'completed' | 'failed'

export type ShortDramaExportStatus = 'idle' | 'pending' | 'exporting' | 'completed' | 'failed'

// ============================================================================
// Interfaces
// ============================================================================

export interface ShortDramaEpisodeOutline {
  episodeNumber: number
  title: string
  summary: string
}

export interface ShortDramaAsset {
  id: string
  kind: ShortDramaAssetKind
  scope: ShortDramaAssetScope
  name: string
  description: string
  imageUrl: string | null
  referenceImageUrl: string | null
  episodeNumber: number | null
  status: ShortDramaGenerationStatus
  createdAt: string
  updatedAt: string
}

export interface ShortDramaMentionRef {
  assetId: string
  assetName: string
}

export interface ShortDramaSegment {
  id: string
  order: number
  title: string
  prompt: string
  mentionRefs: ShortDramaMentionRef[]
  durationSeconds: number
  videoUrl: string | null
  status: ShortDramaGenerationStatus
}

export interface ShortDramaEpisode {
  episodeNumber: number
  title: string
  summary: string
  segments: ShortDramaSegment[]
  status: ShortDramaEpisodeStatus
  videoUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface ShortDramaEpisodeExport {
  episodeNumber: number
  status: ShortDramaExportStatus
  videoUrl: string | null
  errorMessage: string | null
}

export interface ShortDramaBatchExport {
  id: string
  episodeNumbers: number[]
  exports: ShortDramaEpisodeExport[]
  status: ShortDramaExportStatus
  createdAt: string
  updatedAt: string
}

export interface ShortDramaState {
  steps: {
    active: ShortDramaStepId
    completed: ShortDramaStepId[]
  }
  script: {
    originalPrompt: string
    refinedPrompt: string | null
    outlines: ShortDramaEpisodeOutline[]
    status: ShortDramaGenerationStatus
  }
  assets: {
    items: ShortDramaAsset[]
    status: ShortDramaGenerationStatus
  }
  episodes: {
    items: ShortDramaEpisode[]
    status: ShortDramaGenerationStatus
  }
  exports: {
    batches: ShortDramaBatchExport[]
  }
  settings: {
    style: string
    aspectRatio: ShortDramaAspectRatio
    episodeCount: number
    durationSeconds: number
    billingMode: 'estimate_actual' | 'prepay_full'
  }
  locks: {
    script: boolean
    assets: boolean
    episodes: boolean
  }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isShortDramaAspectRatio(value: string): value is ShortDramaAspectRatio {
  return (SHORT_DRAMA_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isShortDramaEpisodeCount(value: number): boolean {
  return (
    (SHORT_DRAMA_EPISODE_COUNTS as readonly number[]).includes(value) ||
    (value > 0 && value <= SHORT_DRAMA_MAX_CUSTOM_EPISODE_COUNT)
  )
}

export function isShortDramaDurationSeconds(value: number, allowed: number[]): boolean {
  return allowed.includes(value)
}

// ============================================================================
// Helpers
// ============================================================================

export function sortShortDramaSegments(segments: ShortDramaSegment[]): ShortDramaSegment[] {
  return [...segments].sort((a, b) => a.order - b.order)
}

export function makeDefaultShortDramaState(params: {
  prompt: string
  style: string
  aspectRatio: ShortDramaAspectRatio
  episodeCount: number
}): ShortDramaState {
  return {
    steps: {
      active: 'script',
      completed: [],
    },
    script: {
      originalPrompt: params.prompt,
      refinedPrompt: null,
      outlines: [],
      status: 'idle',
    },
    assets: {
      items: [],
      status: 'idle',
    },
    episodes: {
      items: [],
      status: 'idle',
    },
    exports: {
      batches: [],
    },
    settings: {
      style: params.style,
      aspectRatio: params.aspectRatio,
      episodeCount: params.episodeCount,
      durationSeconds: SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
      billingMode: 'estimate_actual',
    },
    locks: {
      script: false,
      assets: false,
      episodes: false,
    },
  }
}

export function normalizeShortDramaState(partial: Partial<ShortDramaState>): ShortDramaState {
  const aspectRatio = partial.settings?.aspectRatio
  const episodeCount = partial.settings?.episodeCount

  return {
    steps: partial.steps ?? { active: 'script', completed: [] },
    script: partial.script ?? {
      originalPrompt: '',
      refinedPrompt: null,
      outlines: [],
      status: 'idle',
    },
    assets: partial.assets ?? {
      items: [],
      status: 'idle',
    },
    episodes: partial.episodes ?? {
      items: [],
      status: 'idle',
    },
    exports: partial.exports ?? {
      batches: [],
    },
    settings: {
      style: partial.settings?.style ?? '真人都市',
      aspectRatio:
        aspectRatio && isShortDramaAspectRatio(aspectRatio) ? aspectRatio : '9:16',
      episodeCount:
        episodeCount && isShortDramaEpisodeCount(episodeCount) ? episodeCount : 5,
      durationSeconds: partial.settings?.durationSeconds ?? SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
      billingMode: partial.settings?.billingMode ?? 'estimate_actual',
    },
    locks: partial.locks ?? {
      script: false,
      assets: false,
      episodes: false,
    },
  }
}

export function canEnterShortDramaStep(state: ShortDramaState, step: ShortDramaStepId): boolean {
  const stepOrder: ShortDramaStepId[] = ['script', 'assets', 'episodes', 'export']
  const targetIndex = stepOrder.indexOf(step)

  if (targetIndex === 0) {
    return true
  }

  const previousStep = stepOrder[targetIndex - 1]
  return state.steps.completed.includes(previousStep)
}
