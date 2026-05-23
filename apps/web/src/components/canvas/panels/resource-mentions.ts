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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePromptLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

export function limitPromptLength(value: string): string {
  return Array.from(value).slice(0, PROMPT_MAX_LENGTH).join('')
}

function buildMentionPattern(label: string): RegExp {
  return new RegExp(`@${escapeRegExp(label)}(?!\\d)`, 'g')
}

export function removeResourceReferenceFromPrompt(
  promptDraft: string,
  resources: CanvasReferenceMentionResource[],
  removedResourceId: string,
): string {
  const removedResource = resources.find((resource) => resource.id === removedResourceId)
  if (!removedResource) return promptDraft

  const typeCounts: Record<ReferenceMentionType, number> = { image: 0, video: 0, audio: 0 }
  // 删除连线后同类型资源会重新编号，这里先按剩余资源顺序生成旧名到新名的映射。
  const renamePairs = resources
    .filter((resource) => resource.id !== removedResourceId)
    .map((resource) => {
      typeCounts[resource.type] += 1
      return {
        from: resource.mentionLabel,
        to: `${resource.type === 'video' ? '视频' : resource.type === 'audio' ? '音频' : '图片'}${typeCounts[resource.type]}`,
      }
    })
    .filter((pair) => pair.from !== pair.to)
    .sort((a, b) => b.from.length - a.from.length)

  return promptDraft
    .split(/\r?\n/)
    .map((line) => renamePairs.reduce(
      (nextLine, pair) => nextLine.replace(buildMentionPattern(pair.from), `@${pair.to}`),
      line.replace(buildMentionPattern(removedResource.mentionLabel), ''),
    ))
    .join('\n')
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

  const promptLines = promptDraft
    .split(/\r?\n/)
    .map(normalizePromptLine)
    .filter(Boolean)
    .map((line) => {
      if (!resourcePattern) return line

      const lineWithMentions = line.replace(resourcePattern, (matched, label: string) => {
        const resource = resourceByLabel.get(label)
        if (!resource) return matched
        return ` <${resource.mentionLabel}> `
      })
      return normalizePromptLine(lineWithMentions)
    })

  const normalizedUpstreamTexts = upstreamTexts.map(normalizePromptLine).filter(Boolean)
  return [...normalizedUpstreamTexts, ...promptLines].join('\n')
}
