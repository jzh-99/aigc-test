// ============================================================================
// Constants
// ============================================================================

export const SHORT_DRAMA_STYLE_TABS = ['全部', '真人', '2D', '3D'] as const

export const SHORT_DRAMA_ASPECT_RATIOS = ['9:16', '16:9'] as const

export const SHORT_DRAMA_EPISODE_COUNTS = [5, 10, 15, 20] as const

// 灵感生成模式集数上限
export const SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT = 80

// 上传剧本模式集数上限（由 AI 从原剧本结构推断）
export const SHORT_DRAMA_UPLOAD_MAX_EPISODE_COUNT = 100

export type ShortDramaScriptSourceMode = 'idea' | 'upload'

export function getShortDramaMaxEpisodeCount(mode: ShortDramaScriptSourceMode): number {
  return mode === 'upload'
    ? SHORT_DRAMA_UPLOAD_MAX_EPISODE_COUNT
    : SHORT_DRAMA_IDEA_MAX_EPISODE_COUNT
}

export const SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS = 100000

export const SHORT_DRAMA_DEFAULT_DURATION_SECONDS = 4

export const SHORT_DRAMA_SHOT_DURATION_SECONDS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export const SHORT_DRAMA_TEXT_MODEL = 'qwen3.7-max'

export const SHORT_DRAMA_IMAGE_MODEL = 'seedream-5.0-lite'

export const SHORT_DRAMA_VIDEO_MODEL = 'seedance-2.0'

// ============================================================================
// Types
// ============================================================================

export type ShortDramaStyleTab = (typeof SHORT_DRAMA_STYLE_TABS)[number]

export type ShortDramaAspectRatio = (typeof SHORT_DRAMA_ASPECT_RATIOS)[number]

export type ShortDramaStepId = 'script' | 'assets' | 'episodes'

export type ShortDramaScriptSource = 'idea' | 'upload'

export type ShortDramaProjectStatus = 'draft' | 'generating' | 'completed' | 'failed'

export type ShortDramaGenerationStatus = 'idle' | 'pending' | 'generating' | 'completed' | 'failed'

export type ShortDramaAssetKind = 'character' | 'scene' | 'requisite' | 'bgm'

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
  // 分集生成时由 AI 顺手抽取的素材索引，仅作为素材步骤去重和命名锚点；
  // description 仍由素材步骤基于剧本摘要单独生成，旧数据无此字段时保持向后兼容。
  mentionedCharacters?: string[]
  mentionedScenes?: string[]
}

export interface ShortDramaAsset {
  id: string
  kind: ShortDramaAssetKind
  scope: ShortDramaAssetScope
  name: string
  aliases?: string[]
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

export interface ShortDramaShotDuration {
  shotNumber: number
  durationSeconds: number
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
  videoBatchId?: string | null
  videoTaskId?: string | null
}

export interface ShortDramaEpisode {
  episodeNumber: number
  title: string
  summary: string
  segments: ShortDramaSegment[]
  status: ShortDramaEpisodeStatus
  errorMessage?: string | null
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
    source: ShortDramaScriptSource
    originalPrompt: string
    originalScript: string
    refinedPrompt: string | null
    outlines: ShortDramaEpisodeOutline[]
    status: ShortDramaGenerationStatus
  }
  assets: {
    items: ShortDramaAsset[]
    status: ShortDramaGenerationStatus
    processedOutlineCount: number
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

export function isShortDramaEpisodeCount(
  value: number,
  mode: ShortDramaScriptSourceMode = 'idea',
): boolean {
  if ((SHORT_DRAMA_EPISODE_COUNTS as readonly number[]).includes(value)) {
    return true
  }
  return value > 0 && value <= getShortDramaMaxEpisodeCount(mode)
}

export function isShortDramaDurationSeconds(value: number, allowed: number[]): boolean {
  return allowed.includes(value)
}

// ============================================================================
// Helpers
// ============================================================================

const SHORT_DRAMA_SHOT_DURATION_PATTERN = /分镜\s*(\d+)(?:\s*[·.\-:：]\s*|\s+)(10|[2-9])\s*s\b/gi
const SHORT_DRAMA_MENTION_BOUNDARY_PATTERN = '(?=$|[\\s\\n\\r\\t，,。.;；:：、（(）)】\\]》>])'

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>
    }
  : T

function escapeShortDramaRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitShortDramaAliasText(value: string): string[] {
  return value
    .split(/[,\n，、;；/|]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

export function normalizeShortDramaMentionAlias(value: string): string {
  return value
    .replace(/^@+/, '')
    .replace(/（参考<图\d+>）/g, '')
    .replace(/[\s\n\r\t]/g, '')
    .replace(/[，,。.;；:：、"'“”‘’[\]【】<>《》]/g, '')
    .toLowerCase()
}

export function stripShortDramaAssetStageSuffix(value: string): string {
  return value
    .replace(/（[^）]+）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
}

export function getShortDramaAssetMentionAliases(
  asset: Pick<ShortDramaAsset, 'name' | 'aliases'>
): string[] {
  const rawAliases = [
    asset.name,
    stripShortDramaAssetStageSuffix(asset.name),
    ...(asset.aliases ?? []),
    ...(asset.aliases ?? []).map(alias => stripShortDramaAssetStageSuffix(alias)),
  ].flatMap(splitShortDramaAliasText)

  const seen = new Set<string>()
  const aliases: string[] = []
  for (const alias of rawAliases) {
    const key = normalizeShortDramaMentionAlias(alias)
    if (!key || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }

  return aliases.sort((a, b) => b.length - a.length)
}

export function isShortDramaAssetMentioned(
  prompt: string,
  asset: Pick<ShortDramaAsset, 'name' | 'aliases'>
): boolean {
  return getShortDramaAssetMentionAliases(asset).some((alias) => {
    const pattern = new RegExp(`@${escapeShortDramaRegExp(alias)}${SHORT_DRAMA_MENTION_BOUNDARY_PATTERN}`, 'u')
    return pattern.test(prompt)
  })
}

export function resolveShortDramaAssetByMention<T extends Pick<ShortDramaAsset, 'name' | 'aliases'>>(
  mentionName: string,
  assets: T[]
): T | null {
  const normalizedMention = normalizeShortDramaMentionAlias(mentionName)
  if (!normalizedMention) return null

  for (const asset of assets) {
    const matched = getShortDramaAssetMentionAliases(asset).some(
      alias => normalizeShortDramaMentionAlias(alias) === normalizedMention
    )
    if (matched) return asset
  }

  return null
}

export function findShortDramaMentionedAssets<T extends Pick<ShortDramaAsset, 'id' | 'name' | 'aliases'>>(
  prompt: string,
  assets: T[]
): T[] {
  return assets.filter(asset => isShortDramaAssetMentioned(prompt, asset))
}

export function isShortDramaShotDurationSeconds(value: number): boolean {
  return (SHORT_DRAMA_SHOT_DURATION_SECONDS as readonly number[]).includes(value)
}

export function extractShortDramaShotDurations(prompt: string): ShortDramaShotDuration[] {
  const shots: ShortDramaShotDuration[] = []
  const seen = new Set<number>()

  for (const match of prompt.matchAll(SHORT_DRAMA_SHOT_DURATION_PATTERN)) {
    const shotNumber = Number(match[1])
    const durationSeconds = Number(match[2])
    if (
      Number.isInteger(shotNumber) &&
      shotNumber > 0 &&
      isShortDramaShotDurationSeconds(durationSeconds) &&
      !seen.has(shotNumber)
    ) {
      shots.push({ shotNumber, durationSeconds })
      seen.add(shotNumber)
    }
  }

  return shots
}

export function calculateShortDramaSegmentDuration(prompt: string, fallbackSeconds: number): number {
  const total = extractShortDramaShotDurations(prompt).reduce(
    (sum, shot) => sum + shot.durationSeconds,
    0
  )

  return total > 0 ? total : fallbackSeconds
}

export function updateShortDramaShotDuration(
  prompt: string,
  shotNumber: number,
  nextDurationSeconds: number
): string {
  if (!isShortDramaShotDurationSeconds(nextDurationSeconds)) {
    return prompt
  }

  let updated = false
  return prompt.replace(SHORT_DRAMA_SHOT_DURATION_PATTERN, (fullMatch, rawShotNumber) => {
    if (updated || Number(rawShotNumber) !== shotNumber) {
      return fullMatch
    }

    updated = true
    return fullMatch.replace(/\d{1,2}\s*s/i, `${nextDurationSeconds}s`)
  })
}

export function sortShortDramaSegments(segments: ShortDramaSegment[]): ShortDramaSegment[] {
  return [...segments].sort((a, b) => a.order - b.order)
}

export function areShortDramaAssetsReady(state: ShortDramaState): boolean {
  const requiredAssets = state.assets.items.filter(
    asset => asset.kind === 'character' || asset.kind === 'scene' || asset.kind === 'requisite'
  )

  return (
    requiredAssets.length > 0 &&
    requiredAssets.every(asset => asset.status === 'completed' && !!asset.imageUrl)
  )
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
      source: 'idea',
      originalPrompt: params.prompt,
      originalScript: '',
      refinedPrompt: null,
      outlines: [],
      status: 'idle',
    },
    assets: {
      items: [],
      status: 'idle',
      processedOutlineCount: 0,
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

export function makeUploadedShortDramaState(params: {
  originalScript: string
  style: string
  aspectRatio: ShortDramaAspectRatio
  episodeCount: number
}): ShortDramaState {
  return {
    ...makeDefaultShortDramaState({
      prompt: '',
      style: params.style,
      aspectRatio: params.aspectRatio,
      episodeCount: params.episodeCount,
    }),
    script: {
      source: 'upload',
      originalPrompt: '',
      originalScript: params.originalScript,
      refinedPrompt: null,
      outlines: [],
      status: 'idle',
    },
  }
}

export function normalizeShortDramaState(partial: DeepPartial<ShortDramaState>): ShortDramaState {
  const aspectRatio = partial.settings?.aspectRatio
  const episodeCount = partial.settings?.episodeCount
  const scriptSource: ShortDramaScriptSourceMode = partial.script?.source === 'upload' ? 'upload' : 'idea'
  const outlines = (partial.script?.outlines ?? []) as ShortDramaEpisodeOutline[]
  const processedOutlineCount = partial.assets?.processedOutlineCount
  const normalizedProcessedOutlineCount = typeof processedOutlineCount === 'number'
    ? processedOutlineCount
    : partial.assets?.status === 'completed'
      ? outlines.length
      : 0

  return {
    steps: {
      active: partial.steps?.active ?? 'script',
      completed: (partial.steps?.completed ?? []) as ShortDramaStepId[],
    },
    script: {
      source: partial.script?.source ?? 'idea',
      originalPrompt: partial.script?.originalPrompt ?? '',
      originalScript: partial.script?.originalScript ?? '',
      refinedPrompt: partial.script?.refinedPrompt ?? null,
      outlines,
      status: partial.script?.status ?? 'idle',
    },
    assets: {
      items: (partial.assets?.items ?? []) as ShortDramaAsset[],
      status: partial.assets?.status ?? 'idle',
      processedOutlineCount: normalizedProcessedOutlineCount,
    },
    episodes: {
      items: (partial.episodes?.items ?? []) as ShortDramaEpisode[],
      status: partial.episodes?.status ?? 'idle',
    },
    exports: {
      batches: (partial.exports?.batches ?? []) as ShortDramaBatchExport[],
    },
    settings: {
      style: partial.settings?.style ?? '真人都市',
      aspectRatio:
        aspectRatio && isShortDramaAspectRatio(aspectRatio) ? aspectRatio : '9:16',
      episodeCount:
        episodeCount && isShortDramaEpisodeCount(episodeCount, scriptSource) ? episodeCount : 5,
      durationSeconds: partial.settings?.durationSeconds ?? SHORT_DRAMA_DEFAULT_DURATION_SECONDS,
      billingMode: partial.settings?.billingMode ?? 'estimate_actual',
    },
    locks: {
      script: partial.locks?.script ?? false,
      assets: partial.locks?.assets ?? false,
      episodes: partial.locks?.episodes ?? false,
    },
  }
}

export function canEnterShortDramaStep(state: ShortDramaState, step: ShortDramaStepId): boolean {
  if (step === 'script') {
    return true
  }

  if (step === 'assets') {
    return state.steps.completed.includes('script') || state.locks.script
  }

  if (step === 'episodes') {
    const scriptReady = state.steps.completed.includes('script') || state.locks.script
    const assetsReady = areShortDramaAssetsReady(state)
    return scriptReady && assetsReady
  }

  return false
}
