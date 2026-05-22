export const PROMPT_MAX_LENGTH = 500

export type ReferenceMentionType = 'image' | 'video' | 'audio'

export interface CanvasReferenceMentionResource {
  id: string
  url: string
  type: ReferenceMentionType
  mentionLabel: string
  sourceLabel: string
  mimeType?: string
  thumbnailUrl?: string
  duration?: number
}

const RESOURCE_PROMPT_PREFIX: Record<ReferenceMentionType, string> = {
  image: '图片参考',
  video: '视频参考',
  audio: '音频参考',
}

const RESOURCE_DEFAULT_TARGET: Record<ReferenceMentionType, string> = {
  image: '主体/角色',
  video: '动作/运镜/风格/音效',
  audio: '音色',
}

const RESOURCE_TYPE_ORDER: ReferenceMentionType[] = ['image', 'video', 'audio']

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePromptLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

export function limitPromptLength(value: string): string {
  return Array.from(value).slice(0, PROMPT_MAX_LENGTH).join('')
}

export function buildPromptWithResourceMentions(
  upstreamTexts: string[],
  promptDraft: string,
  resources: CanvasReferenceMentionResource[],
): string {
  const resourceByLabel = new Map(resources.map((resource) => [resource.mentionLabel, resource]))
  const mentionLabels = resources
    .map((resource) => resource.mentionLabel)
    .sort((a, b) => b.length - a.length)
  const resourcePattern = resources.length > 0
    ? new RegExp(`@(${mentionLabels.map(escapeRegExp).join('|')})`, 'g')
    : null

  const referencedResources: CanvasReferenceMentionResource[] = []
  const referencedIds = new Set<string>()
  const promptLines = promptDraft
    .split(/\r?\n/)
    .map(normalizePromptLine)
    .filter(Boolean)
    .map((line) => {
      if (!resourcePattern) return line

      const lineWithMentions = line.replace(resourcePattern, (matched, label: string) => {
        const resource = resourceByLabel.get(label)
        if (!resource) return matched
        if (!referencedIds.has(resource.id)) {
          referencedIds.add(resource.id)
          referencedResources.push(resource)
        }
        return ` <${resource.mentionLabel}> `
      })
      return normalizePromptLine(lineWithMentions)
    })

  const referenceLines = RESOURCE_TYPE_ORDER
    .map((type) => {
      const typedResources = referencedResources.filter((resource) => resource.type === type)
      if (typedResources.length === 0) return null

      const references = typedResources
        .map((resource) => `参考<${resource.mentionLabel}>中的${RESOURCE_DEFAULT_TARGET[type]}`)
        .join('，')
      return `${RESOURCE_PROMPT_PREFIX[type]}：${references}。`
    })
    .filter((line): line is string => Boolean(line))

  const normalizedUpstreamTexts = upstreamTexts.map(normalizePromptLine).filter(Boolean)
  if (referenceLines.length === 0) {
    return [...normalizedUpstreamTexts, ...promptLines].join('\n')
  }

  return [...normalizedUpstreamTexts, ...referenceLines, ...promptLines.map((line) => `生成：${line}`)].join('\n')
}
