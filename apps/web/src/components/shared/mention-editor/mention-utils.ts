import type { MentionResource } from './types'

type Segment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; resource: MentionResource }

/** 正则特殊字符转义 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按字符截断文本到最大长度 */
export function limitPromptLength(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

/** 构建资源标签匹配对，按长度降序排列确保贪婪匹配 */
function buildMentionPairs(resources: MentionResource[]): { label: string; resource: MentionResource }[] {
  return resources
    .flatMap((resource) => {
      const labels = [resource.mentionLabel, ...(resource.aliases ?? [])]
      return labels.map((label) => ({ label, resource }))
    })
    .sort((a, b) => b.label.length - a.label.length)
}

/** 将含 @ 标签的文本解析为 text/mention 段落数组 */
export function parseSegments(value: string, resources: MentionResource[]): Segment[] {
  if (!value) return []
  if (resources.length === 0) return [{ type: 'text', text: value }]

  const mentionPairs = buildMentionPairs(resources)
  const resourceByMention = new Map(
    mentionPairs.map(({ label, resource }) => [`@${label}`, resource]),
  )
  const pattern = new RegExp(
    `(?<!@)@(${mentionPairs.map(({ label }) => escapeRegExp(label)).join('|')})(?=\\s|$|[，。,.])`,
    'g',
  )
  const segments: Segment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: value.slice(lastIndex, match.index) })
    }
    const tokenText = match[0]
    const resource = resourceByMention.get(tokenText)
    if (resource) segments.push({ type: 'mention', text: tokenText, resource })
    else segments.push({ type: 'text', text: tokenText })
    lastIndex = match.index + tokenText.length
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', text: value.slice(lastIndex) })
  }
  return segments
}

/** 从 contentEditable DOM 提取纯文本 */
export function getEditorPlainText(editor: HTMLElement): string {
  let text = ''
  editor.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.mentionText) {
      text += node.dataset.mentionText
      return
    }
    text += node.innerText
  })
  return text.replace(/ /g, ' ')
}

/** 将解析后的段落渲染为 DOM 节点，追加到编辑器 */
export function renderEditorContent(
  editor: HTMLElement,
  value: string,
  resources: MentionResource[],
  tokenClassName: (kind: string) => string,
): void {
  editor.innerHTML = ''
  for (const segment of parseSegments(value, resources)) {
    if (segment.type === 'text') {
      editor.appendChild(document.createTextNode(segment.text))
      continue
    }
    const token = document.createElement('span')
    token.dataset.testid = 'mention-token'
    token.dataset.mentionText = segment.text
    token.contentEditable = 'false'
    token.className = tokenClassName(segment.resource.kind)
    token.textContent = segment.text
    editor.appendChild(token)
  }
}

/** 将光标定位到编辑器末尾 */
export function placeCaretAtEnd(element: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** 替换编辑器内容并将光标移到末尾 */
export function replaceEditorContent(
  editor: HTMLElement,
  value: string,
  resources: MentionResource[],
  tokenClassName: (kind: string) => string,
): void {
  renderEditorContent(editor, value, resources, tokenClassName)
  placeCaretAtEnd(editor)
}

/** 获取光标在文本中的字符偏移量 */
export function getCaretOffset(editor: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return getEditorPlainText(editor).length

  const range = selection.getRangeAt(0)
  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(editor)
  prefixRange.setEnd(range.endContainer, range.endOffset)

  const fragment = prefixRange.cloneContents()
  const wrapper = document.createElement('div')
  wrapper.appendChild(fragment)
  return getEditorPlainText(wrapper).length
}

/** 获取光标相对于容器的像素位置（用于弹窗定位） */
export function getCaretPixelPosition(
  editor: HTMLElement | null,
  wrapper: HTMLElement | null,
  floatingWidth = 240,
): { top: number; left: number } | null {
  if (!editor || !wrapper) return null
  try {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(true)
    const caretRect = range.getBoundingClientRect()
    if (caretRect.top === 0 && caretRect.left === 0 && caretRect.bottom === 0) return null
    const wrapperRect = wrapper.getBoundingClientRect()
    const lineBottom = caretRect.bottom > caretRect.top ? caretRect.bottom : caretRect.top + 16
    const inset = 8
    const maxLeft = Math.max(inset, wrapperRect.width - floatingWidth - inset)
    return {
      top: lineBottom - wrapperRect.top + 4,
      left: Math.min(maxLeft, Math.max(inset, caretRect.left - wrapperRect.left)),
    }
  } catch {
    return null
  }
}

/** 将 prompt 中的 @标签 替换为 <标签>，与画布行为一致 */
export function resolveMentionPrompt(
  prompt: string,
  resources: MentionResource[],
): string {
  if (resources.length === 0 || !prompt) return prompt
  const labelToMentionLabel = new Map(
    resources.flatMap((resource) =>
      [resource.mentionLabel, ...(resource.aliases ?? [])].map((label) => [label, resource.mentionLabel] as const),
    ),
  )
  const labels = resources
    .flatMap((r) => [r.mentionLabel, ...(r.aliases ?? [])])
    .sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(?<!@)@(${labels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.])`,
    'g',
  )
  return prompt.replace(pattern, (_, label: string) => `<${labelToMentionLabel.get(label) ?? label}>`)
}

/** 将历史 prompt 中的 <资源标签> 恢复为 @ 标签 */
export function restoreMentionPrompt(prompt: string): string {
  if (!prompt) return prompt
  return prompt.replace(/<((?:图片|视频|音频)\d+)>/g, '@$1')
}

/** 从 prompt 中移除已经失效的 @ 标签 */
export function removeMentionLabels(prompt: string, labels: string[]): string {
  if (!prompt || labels.length === 0) return prompt
  const uniqueLabels = Array.from(new Set(labels)).sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(?<!@)@(${uniqueLabels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.])\\s*`,
    'g',
  )
  return prompt
    .replace(pattern, '')
    .replace(/[ \t]+([，。,.])/g, '$1')
    .replace(/([，。])[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trimStart()
}

type MentionLabelSnapshot = Pick<MentionResource, 'id' | 'mentionLabel' | 'aliases'>

/** 按资源 id 同步 prompt 中的 @ 标签：删除失效标签，并重命名仍存在资源的标签 */
export function syncMentionResourceLabels(
  prompt: string,
  previousResources: MentionLabelSnapshot[],
  currentResources: MentionLabelSnapshot[],
): string {
  if (!prompt || previousResources.length === 0) return prompt

  const currentById = new Map(currentResources.map((resource) => [resource.id, resource]))
  const labelActions = new Map<string, string | null>()

  for (const previous of previousResources) {
    const current = currentById.get(previous.id)
    const previousLabels = [previous.mentionLabel, ...(previous.aliases ?? [])]
    if (!current) {
      for (const label of previousLabels) labelActions.set(label, null)
      continue
    }
    if (previous.mentionLabel !== current.mentionLabel) {
      for (const label of previousLabels) labelActions.set(label, current.mentionLabel)
    }
  }

  if (labelActions.size === 0) return prompt
  const labels = Array.from(labelActions.keys()).sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(?<!@)@(${labels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.])`,
    'g',
  )
  const replacements: string[] = []
  const nextPrompt = prompt.replace(pattern, (_, label: string) => {
    const replacement = labelActions.get(label)
    if (!replacement) return ''
    const token = `__MENTION_REPLACEMENT_${replacements.length}__`
    replacements.push(`@${replacement}`)
    return token
  })

  return replacements
    .reduce((value, replacement, index) => value.replace(`__MENTION_REPLACEMENT_${index}__`, replacement), nextPrompt)
    .replace(/[ \t]+([，。,.])/g, '$1')
    .replace(/([，。])[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trimStart()
}
