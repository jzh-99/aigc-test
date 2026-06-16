'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { pastePlainTextIntoContentEditable } from '@/lib/contenteditable'
import type { MentionResource } from './types'
import {
  limitPromptLength,
  getEditorPlainText,
  renderEditorContent,
  replaceEditorContent,
  placeCaretAtEnd,
  getCaretOffset,
  getCaretPixelPosition,
} from './mention-utils'

const DEFAULT_MAX_LENGTH = 500

interface MentionEditorGroup {
  label: string
  kinds: string[]
}

export interface MentionEditorProps {
  /** 当前文本值（受控） */
  value: string
  onChange: (value: string) => void
  /** 可 @ 的资源列表 */
  resources: MentionResource[]
  /** 占位文字 */
  placeholder?: string
  /** 最大字符数，默认 500；传 null 表示不限长 */
  maxLength?: number | null
  /** 是否显示字数计数 */
  showCharacterCount?: boolean
  /** 失焦回调 */
  onBlur?: () => void
  /** 是否禁用 */
  disabled?: boolean
  /** 编辑器容器 className */
  className?: string
  /** 输入区域 className */
  editorClassName?: string
  /** 自定义提及标签样式，按 kind 返回 className */
  mentionClassName?: (kind: string) => string
  /** 自定义提及标签图标，按 kind 返回 LucideIcon 组件 */
  mentionIcon?: (kind: string) => React.ComponentType<{ className?: string }>
  /** 选择器分组定义，不传则扁平列表 */
  groups?: MentionEditorGroup[]
  /** 选择器空状态文案 */
  emptyText?: string
}

const defaultTokenClassName = (): string =>
  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold align-baseline text-blue-600 bg-blue-50 border-blue-200'

function renderPlaceholder(placeholder: string): React.ReactNode {
  const marker = '@ （紫色）参考内容'
  if (!placeholder.includes(marker)) return placeholder

  const parts = placeholder.split(marker)
  return (
    <>
      {parts[0]}
      <span className="font-medium text-violet-300">@参考内容</span>
      {parts.slice(1).join(marker)}
    </>
  )
}

function ResourcePickerItem({
  resource,
  tokenClassName,
  Icon,
  onSelect,
}: {
  resource: MentionResource
  tokenClassName: (kind: string) => string
  Icon: React.ComponentType<{ className?: string }> | null
  onSelect: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect()
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-muted"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium',
          tokenClassName(resource.kind),
        )}
      >
        {Icon && <Icon className="h-3 w-3" />}
        {resource.mentionLabel}
      </span>
      {resource.sourceLabel && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {resource.sourceLabel}
        </span>
      )}
    </button>
  )
}

function ResourcePickerGroup({
  label,
  resources,
  tokenClassName,
  getIcon,
  onSelect,
}: {
  label: string
  resources: MentionResource[]
  tokenClassName: (kind: string) => string
  getIcon: (kind: string) => React.ComponentType<{ className?: string }> | null
  onSelect: (resource: MentionResource) => void
}): React.ReactElement | null {
  if (resources.length === 0) return null
  return (
    <div className="py-1">
      <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      {resources.map((resource) => (
        <ResourcePickerItem
          key={resource.id}
          resource={resource}
          tokenClassName={tokenClassName}
          Icon={getIcon(resource.kind)}
          onSelect={() => onSelect(resource)}
        />
      ))}
    </div>
  )
}

export function MentionEditor({
  value,
  onChange,
  resources,
  placeholder = '',
  maxLength = DEFAULT_MAX_LENGTH,
  showCharacterCount = true,
  onBlur,
  disabled = false,
  className,
  editorClassName,
  mentionClassName,
  mentionIcon,
  groups,
  emptyText = '暂无可引用资源',
}: MentionEditorProps): React.ReactElement {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const isComposingRef = useRef(false)
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const tokenCls = mentionClassName ?? defaultTokenClassName
  const getIcon = (kind: string): React.ComponentType<{ className?: string }> | null =>
    mentionIcon ? mentionIcon(kind) : null

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || document.activeElement === editor) return
    renderEditorContent(editor, value, resources, tokenCls)
  }, [resources, value, tokenCls])

  const syncValueFromEditor = (): void => {
    const editor = editorRef.current
    if (!editor) return

    const nextValue = limitPromptLength(getEditorPlainText(editor), maxLength)
    if (nextValue !== value) onChange(nextValue)
    if (nextValue.length !== getEditorPlainText(editor).length) {
      replaceEditorContent(editor, nextValue, resources, tokenCls)
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

  const handleSelectResource = (resource: MentionResource): void => {
    const editor = editorRef.current
    if (!editor || mentionStartIndex == null) return

    const insertText = `@${resource.mentionLabel} `
    const before = value.slice(0, mentionStartIndex)
    const after = value.slice(mentionStartIndex + 1)
    const nextValue = limitPromptLength(`${before}${insertText}${after}`, maxLength)

    onChange(nextValue)
    setMentionStartIndex(null)
    setPickerPos(null)

    window.requestAnimationFrame(() => {
      replaceEditorContent(editor, nextValue, resources, tokenCls)
      editor.focus()
      placeCaretAtEnd(editor)
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
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
    const parent =
      container.nodeType === Node.ELEMENT_NODE
        ? (container as HTMLElement)
        : container.parentElement
    const mentionElement = parent?.closest('[data-mention-text]')
    if (mentionElement) {
      event.preventDefault()
      const tokenText = (mentionElement as HTMLElement).dataset.mentionText ?? ''
      const nextValue = limitPromptLength(value.replace(tokenText, ''), maxLength)
      onChange(nextValue)
      window.requestAnimationFrame(() => {
        replaceEditorContent(editorRef.current!, nextValue, resources, tokenCls)
      })
      return
    }

    const neighbor =
      event.key === 'Backspace'
        ? (container.childNodes?.[offset - 1] ?? parent?.previousSibling)
        : (container.childNodes?.[offset] ?? parent?.nextSibling)
    if (neighbor instanceof HTMLElement && neighbor.dataset.mentionText) {
      event.preventDefault()
      const tokenText = neighbor.dataset.mentionText
      const nextValue = limitPromptLength(value.replace(tokenText, ''), maxLength)
      onChange(nextValue)
      window.requestAnimationFrame(() => {
        replaceEditorContent(editorRef.current!, nextValue, resources, tokenCls)
      })
    }
  }

  const showPicker = mentionStartIndex != null
  const isEmpty = value.length === 0

  const renderPickerContent = (): React.ReactElement => {
    if (resources.length === 0) {
      return <div className="px-2 py-2 text-[11px] text-muted-foreground">{emptyText}</div>
    }
    if (groups) {
      return (
        <>
          {groups.map((group) => (
            <ResourcePickerGroup
              key={group.label}
              label={group.label}
              resources={resources.filter((r) => group.kinds.includes(r.kind))}
              tokenClassName={tokenCls}
              getIcon={getIcon}
              onSelect={handleSelectResource}
            />
          ))}
        </>
      )
    }
    return (
      <>
        {resources.map((resource) => (
          <ResourcePickerItem
            key={resource.id}
            resource={resource}
            tokenClassName={tokenCls}
            Icon={getIcon(resource.kind)}
            onSelect={() => handleSelectResource(resource)}
          />
        ))}
      </>
    )
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <div
        ref={editorRef}
        data-testid="mention-editor"
        role="textbox"
        aria-label={placeholder}
        contentEditable={!disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        suppressContentEditableWarning
        className={cn(
          'w-full whitespace-pre-wrap break-words p-2 text-xs bg-muted/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary max-h-[400px] overflow-y-auto',
          disabled && 'cursor-not-allowed opacity-70',
          editorClassName,
        )}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          window.setTimeout(() => {
            setMentionStartIndex(null)
            setPickerPos(null)
          }, 120)
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
        onPaste={(event) => {
          pastePlainTextIntoContentEditable(event)
          window.requestAnimationFrame(syncValueFromEditor)
        }}
        onKeyDown={handleKeyDown}
      />

      {isEmpty && !isFocused && (
        <div className="pointer-events-none absolute left-2 top-2 text-xs text-muted-foreground">
          {renderPlaceholder(placeholder)}
        </div>
      )}

      {showCharacterCount && maxLength != null && (
        <div className="mt-1 flex justify-end text-[10px] text-muted-foreground">
          {Array.from(value).length}/{maxLength}
        </div>
      )}

      {showPicker && !disabled && (
        <div
          className={cn(
            'absolute z-50 w-60 max-h-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl',
            !pickerPos && 'left-0 right-0 top-full mt-1',
          )}
          style={pickerPos ? { top: pickerPos.top, left: pickerPos.left } : undefined}
        >
          {renderPickerContent()}
        </div>
      )}
    </div>
  )
}
