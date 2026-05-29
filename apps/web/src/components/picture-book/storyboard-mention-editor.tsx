'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Map as MapIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const PROMPT_MAX_LENGTH = 1200
const CHARACTER_TOKEN_CLASS = 'border-primary/30 bg-primary/15 text-primary'
const BACKGROUND_TOKEN_CLASS = 'border-border bg-muted text-foreground'

export interface StoryboardMentionResource {
  id: string
  kind: 'character' | 'background'
  name: string
  imageUrl?: string | null
}

interface StoryboardMentionEditorProps {
  value: string
  resources: StoryboardMentionResource[]
  placeholder?: string
  onChange: (value: string) => void
  onBlur?: () => void
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; resource: StoryboardMentionResource }

function limitPromptLength(value: string): string {
  return Array.from(value).slice(0, PROMPT_MAX_LENGTH).join('')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getResourceColor(resource: StoryboardMentionResource): string {
  return resource.kind === 'character' ? CHARACTER_TOKEN_CLASS : BACKGROUND_TOKEN_CLASS
}

function parseSegments(value: string, resources: StoryboardMentionResource[]): Segment[] {
  if (!value) return []
  if (resources.length === 0) return [{ type: 'text', text: value }]

  const resourceByMention = new Map(resources.map((resource) => [`@${resource.name}`, resource]))
  const pattern = new RegExp(`@(${resources.map((resource) => escapeRegExp(resource.name)).join('|')})(?=\\s|$|[，。,.、；;！!？?])`, 'g')
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

function getEditorPlainText(editor: HTMLElement): string {
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

  return text.replace(/\u00a0/g, ' ')
}

function renderEditorContent(
  editor: HTMLElement,
  value: string,
  resources: StoryboardMentionResource[],
) {
  editor.innerHTML = ''

  for (const segment of parseSegments(value, resources)) {
    if (segment.type === 'text') {
      editor.appendChild(document.createTextNode(segment.text))
      continue
    }

    const token = document.createElement('span')
    token.dataset.testid = 'storyboard-mention-token'
    token.dataset.mentionText = segment.text
    token.contentEditable = 'false'
    token.className = cn(
      'mx-0.5 inline-flex h-5 items-center rounded-md border px-1.5 text-[12px] font-semibold leading-none align-[0.05em]',
      getResourceColor(segment.resource),
    )
    token.textContent = segment.text
    editor.appendChild(token)
  }
}

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function getCaretOffset(editor: HTMLElement): number {
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

function replaceEditorContent(
  editor: HTMLElement,
  value: string,
  resources: StoryboardMentionResource[],
) {
  renderEditorContent(editor, value, resources)
  placeCaretAtEnd(editor)
}

function ResourcePickerGroup({
  label,
  resources,
  onSelect,
}: {
  label: string
  resources: StoryboardMentionResource[]
  onSelect: (resource: StoryboardMentionResource) => void
}) {
  if (resources.length === 0) return null

  return (
    <div className="py-1">
      <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      {resources.map((resource) => {
        const Icon = resource.kind === 'character' ? ImageIcon : MapIcon
        return (
          <button
            key={resource.id}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(resource)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          >
            <span className={cn('inline-flex h-5 min-w-0 items-center gap-1 rounded-md border px-1.5 text-[12px] font-semibold leading-none', getResourceColor(resource))}>
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{resource.name}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{resource.imageUrl ? '已生成图片' : '暂无图片'}</span>
          </button>
        )
      })}
    </div>
  )
}

export function StoryboardMentionEditor({
  value,
  resources,
  placeholder = '输入画面提示词，使用 @ 引用角色或背景',
  onChange,
  onBlur,
}: StoryboardMentionEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const isComposingRef = useRef(false)
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || document.activeElement === editor) return
    renderEditorContent(editor, value, resources)
  }, [resources, value])

  const syncValueFromEditor = () => {
    const editor = editorRef.current
    if (!editor) return

    const plainText = getEditorPlainText(editor)
    const nextValue = limitPromptLength(plainText)
    if (nextValue !== value) onChange(nextValue)
    if (nextValue.length !== plainText.length) {
      replaceEditorContent(editor, nextValue, resources)
    }

    const caretIndex = getCaretOffset(editor)
    const beforeCaret = nextValue.slice(0, caretIndex)
    const matched = beforeCaret.match(/(^|\s)@$/)
    setMentionStartIndex(matched ? caretIndex - 1 : null)
  }

  const handleSelectResource = (resource: StoryboardMentionResource) => {
    const editor = editorRef.current
    if (!editor || mentionStartIndex == null) return

    const insertText = `@${resource.name} `
    const before = value.slice(0, mentionStartIndex)
    const after = value.slice(mentionStartIndex + 1)
    const nextValue = limitPromptLength(`${before}${insertText}${after}`)

    onChange(nextValue)
    setMentionStartIndex(null)

    window.requestAnimationFrame(() => {
      replaceEditorContent(editor, nextValue, resources)
      editor.focus()
      placeCaretAtEnd(editor)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingRef.current) return
    if (event.key !== 'Backspace' && event.key !== 'Delete') return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return

    const range = selection.getRangeAt(0)
    const container = range.startContainer
    const offset = range.startOffset
    const parent = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement
    const mentionElement = parent?.closest('[data-mention-text]')
    if (mentionElement) {
      event.preventDefault()
      const tokenText = (mentionElement as HTMLElement).dataset.mentionText ?? ''
      const nextValue = limitPromptLength(value.replace(tokenText, ''))
      onChange(nextValue)
      window.requestAnimationFrame(() => {
        if (editorRef.current) replaceEditorContent(editorRef.current, nextValue, resources)
      })
      return
    }

    const neighbor = event.key === 'Backspace'
      ? (container.childNodes?.[offset - 1] ?? parent?.previousSibling)
      : (container.childNodes?.[offset] ?? parent?.nextSibling)
    if (neighbor instanceof HTMLElement && neighbor.dataset.mentionText) {
      event.preventDefault()
      const tokenText = neighbor.dataset.mentionText
      const nextValue = limitPromptLength(value.replace(tokenText, ''))
      onChange(nextValue)
      window.requestAnimationFrame(() => {
        if (editorRef.current) replaceEditorContent(editorRef.current, nextValue, resources)
      })
    }
  }

  const characterResources = resources.filter(resource => resource.kind === 'character')
  const backgroundResources = resources.filter(resource => resource.kind === 'background')
  const showPicker = mentionStartIndex != null
  const isEmpty = value.length === 0

  return (
    <div className="relative">
      <div
        ref={editorRef}
        data-testid="storyboard-mention-editor"
        role="textbox"
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        className="min-h-24 w-full whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-3 py-2 text-sm leading-7 outline-none transition focus:ring-2 focus:ring-primary/30"
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          window.setTimeout(() => setMentionStartIndex(null), 120)
          syncValueFromEditor()
          onBlur?.()
        }}
        onInput={() => {
          if (!isComposingRef.current) syncValueFromEditor()
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
          syncValueFromEditor()
        }}
        onKeyDown={handleKeyDown}
      />

      {isEmpty && !isFocused ? (
        <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
          {placeholder}
        </div>
      ) : null}

      <div className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span>输入 @ 引用角色/背景图片作为生图参考</span>
        <span>{Array.from(value).length}/{PROMPT_MAX_LENGTH}</span>
      </div>

      {showPicker ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
          {resources.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">暂无可引用角色或背景</div>
          ) : (
            <>
              <ResourcePickerGroup label="角色" resources={characterResources} onSelect={handleSelectResource} />
              <ResourcePickerGroup label="背景" resources={backgroundResources} onSelect={handleSelectResource} />
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
