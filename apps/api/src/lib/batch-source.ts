import type { BatchSource } from '@aigc/types'

const BATCH_SOURCES: BatchSource[] = ['generation', 'studio', 'canvas']
const STUDIO_MODULES = ['music', 'music_voice_clone', 'picture_book', 'short_drama']
const CANVAS_MODULES = ['agent', 'storyboard', 'upload']

interface BatchSourceContext {
  module?: string | null
  canvasId?: string | null
  canvasNodeId?: string | null
  videoStudioProjectId?: string | null
  pictureBookProjectId?: string | null
  shortDramaProjectId?: string | null
}

export function normalizeBatchSource(value: string | undefined | null): BatchSource {
  if (value === undefined || value === null || value === '') return 'generation'
  if (BATCH_SOURCES.includes(value as BatchSource)) return value as BatchSource
  throw new Error('Invalid batch source')
}

export function resolveBatchSource(context: BatchSourceContext): BatchSource {
  if (context.canvasId || context.canvasNodeId) return 'canvas'
  if (
    context.videoStudioProjectId ||
    context.pictureBookProjectId ||
    context.shortDramaProjectId
  ) {
    return 'studio'
  }
  if (context.module && STUDIO_MODULES.includes(context.module)) return 'studio'
  if (context.module && CANVAS_MODULES.includes(context.module)) return 'canvas'
  return 'generation'
}
