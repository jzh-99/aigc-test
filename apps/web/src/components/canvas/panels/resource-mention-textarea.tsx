'use client'

import { useEffect, useRef, useState } from 'react'
import { Film, ImageIcon, Music } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pastePlainTextIntoContentEditable } from '@/lib/contenteditable'
import { limitPromptLength, PROMPT_MAX_LENGTH, type CanvasReferenceMentionResource } from './resource-mentions'

interface ResourceMentionTextareaProps {
  value: string
  placeholder: string
  resources: CanvasReferenceMentionResource[]
  minHeightClassName: string
  onChange: (value: string) => void
  onBlur: () => void
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; resource: CanvasReferenceMentionResource }

function getResourceIcon(resource: CanvasReferenceMentionResource) {
  if (resource.type === 'video') return Film
  if (resource.type === 'audio') return Music
  return ImageIcon
}

function getResourceColor(resource: CanvasReferenceMentionResource): string {
  if (resource.type === 'video') return 'text-violet-600 bg-violet-50 border-violet-200'
  if (resource.type === 'audio') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
  return 'text-blue-600 bg-blue-50 border-blue-200'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseSegments(value: string, resources: CanvasReferenceMentionResource[]): Segment[] {
  if (resources.length === 0 || !value) return value ? [{ type: 'text', text: value }] : []

  const resourceByMention = new Map(resources.map((resource) => [`@${resource.mentionLabel}`, resource]))
  const pattern = new RegExp(`@(${resources.map((resource) => escapeRegExp(resource.mentionLabel)).join('|')})(?=\\s|$|[，。,.])`, 'g')
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
  resources: CanvasReferenceMentionResource[],
) {
  editor.innerHTML = ''

  for (const segment of parseSegments(value, resources)) {
    if (segment.type === 'text') {
      editor.appendChild(document.createTextNode(segment.text))
      continue
    }

    const token = document.createElement('span')
    token.dataset.testid = 'resource-mention-token'
    token.dataset.mentionText = segment.text
    token.contentEditable = 'false'
    token.className = cn(
      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold align-baseline',
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
  resources: CanvasReferenceMentionResource[],
) {
  renderEditorContent(editor, value, resources)
  placeCaretAtEnd(editor)
}

/**
 * 获取光标相对于指定容器的像素位置（用于下拉框定位）
 */
function getCaretPixelPosition(editor: HTMLElement | null, wrapper: HTMLElement | null): { top: number; left: number } | null {
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
    return {
      top: lineBottom - wrapperRect.top + 4,
      left: Math.max(0, caretRect.left - wrapperRect.left),
    }
  } catch {
    return null
  }
}

export function ResourceMentionTextarea({
  value,
  placeholder,
  resources,
  minHeightClassName,
  onChange,
  onBlur,
}: ResourceMentionTextareaProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const isComposingRef = useRef(false)
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || document.activeElement === editor) return
    renderEditorContent(editor, value, resources)
  }, [resources, value])

  const syncValueFromEditor = () => {
    const editor = editorRef.current
    if (!editor) return

    const nextValue = limitPromptLength(getEditorPlainText(editor))
    if (nextValue !== value) onChange(nextValue)
    if (nextValue.length !== getEditorPlainText(editor).length) {
      replaceEditorContent(editor, nextValue, resources)
    }

    const caretIndex = getCaretOffset(editor)
    const beforeCaret = nextValue.slice(0, caretIndex)
    const matched = beforeCaret.match(/(^|[^@])@$/)
    if (matched) {
      setPickerPos(getCaretPixelPosition(editor, wrapperRef.current))
      setMentionStartIndex(caretIndex - 1)
    } else {
      setPickerPos(null)
      setMentionStartIndex(null)
    }
  }

  const handleSelectResource = (resource: CanvasReferenceMentionResource) => {
    const editor = editorRef.current
    if (!editor || mentionStartIndex == null) return

    const insertText = `@${resource.mentionLabel} `
    const before = value.slice(0, mentionStartIndex)
    const after = value.slice(mentionStartIndex + 1)
    const nextValue = limitPromptLength(`${before}${insertText}${after}`)

    onChange(nextValue)
    setMentionStartIndex(null)
    setPickerPos(null)

    window.requestAnimationFrame(() => {
      replaceEditorContent(editor, nextValue, resources)
      editor.focus()
      placeCaretAtEnd(editor)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingRef.current) return
    if (event.key === 'Escape' && mentionStartIndex != null) {
      event.preventDefault()
      setMentionStartIndex(null)
      setPickerPos(null)
      return
    }
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
        replaceEditorContent(editorRef.current!, nextValue, resources)
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
        replaceEditorContent(editorRef.current!, nextValue, resources)
      })
    }
  }

  const showPicker = mentionStartIndex != null
  const isEmpty = value.length === 0

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={editorRef}
        data-testid="resource-mention-editor"
        role="textbox"
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        className={cn(
          'w-full whitespace-pre-wrap break-words p-2 text-xs bg-muted/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary max-h-[400px] overflow-y-auto',
          minHeightClassName,
        )}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          window.setTimeout(() => {
            setMentionStartIndex(null)
            setPickerPos(null)
          }, 120)
          syncValueFromEditor()
          onBlur()
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
        onPaste={(event) => {
          pastePlainTextIntoContentEditable(event)
          window.requestAnimationFrame(syncValueFromEditor)
        }}
        onKeyDown={handleKeyDown}
      >
      </div>

      {isEmpty && !isFocused && (
        <div className="pointer-events-none absolute left-2 top-2 text-xs text-muted-foreground">
          {placeholder}
        </div>
      )}

      <div className="mt-1 flex justify-end text-[10px] text-muted-foreground">
        {Array.from(value).length}/{PROMPT_MAX_LENGTH}
      </div>

      {showPicker && (
        <div
          className={cn(
            'absolute z-50 w-60 max-h-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl',
            !pickerPos && 'left-0 right-0 top-full mt-1',
          )}
          style={pickerPos ? { top: pickerPos.top, left: pickerPos.left } : undefined}
        >
          {resources.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-muted-foreground">暂无可引用资源</div>
          ) : (
            resources.map((resource) => {
              const Icon = getResourceIcon(resource)
              return (
                <button
                  key={resource.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    handleSelectResource(resource)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-muted"
                >
                  <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium', getResourceColor(resource))}>
                    <Icon className="h-3 w-3" />
                    {resource.mentionLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{resource.sourceLabel}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
