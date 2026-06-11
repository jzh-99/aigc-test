# 创作页面 @ 提及功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为创作页面的图片和视频面板添加 @ 提及功能，基于通用 MentionEditor 组件。

**Architecture:** 从画布和短剧/绘本的现有 @ 组件中提取公共逻辑到 `components/shared/mention-editor/`，通过 props 定制外观和行为。创作面板将 `<Textarea>` 替换为 `MentionEditor`，提交时将 `@标签` 替换为 `<标签>`。

**Tech Stack:** React 18、TypeScript、contentEditable API、Tailwind CSS、lucide-react

**Design Spec:** `docs/superpowers/specs/2026-06-11-generation-mention-editor-design.md`

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `apps/web/src/components/shared/mention-editor/types.ts` | MentionResource 类型定义 |
| Create | `apps/web/src/components/shared/mention-editor/mention-utils.ts` | 纯函数工具 |
| Create | `apps/web/src/components/shared/mention-editor/mention-utils.test.ts` | 工具函数测试 |
| Create | `apps/web/src/components/shared/mention-editor/mention-editor.tsx` | 通用 MentionEditor 组件 |
| Create | `apps/web/src/components/shared/mention-editor/index.ts` | 统一导出 |
| Modify | `apps/web/src/components/generation/image/image-panel.tsx` | 集成 MentionEditor |
| Modify | `apps/web/src/hooks/use-generate.ts` | 支持 overridePrompt 参数 |
| Modify | `apps/web/src/components/generation/video/video-panel.tsx` | 集成 MentionEditor |

---

### Task 1: 创建类型定义

**Files:**
- Create: `apps/web/src/components/shared/mention-editor/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
/** 通用 @ 提及资源 */
export interface MentionResource {
  id: string
  /** @标签显示文本，如 "图片1"、"角色A" */
  mentionLabel: string
  /** 选择器中的描述文字，如 "参考图"、"已生成图片" */
  sourceLabel?: string
  /** 资源种类，用于颜色/图标区分，如 "image"、"character" */
  kind: string
  /** 别名列表（可选），支持多个名称触发同一个 @ */
  aliases?: string[]
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/shared/mention-editor/types.ts
git commit -m "feat(mention): 添加 MentionResource 通用类型定义"
```

---

### Task 2: 创建工具函数

**Files:**
- Create: `apps/web/src/components/shared/mention-editor/mention-utils.ts`

- [ ] **Step 1: 创建 mention-utils.ts**

```typescript
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
    `@(${mentionPairs.map(({ label }) => escapeRegExp(label)).join('|')})(?=\\s|$|[，。,.])`,
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
    return {
      top: lineBottom - wrapperRect.top + 4,
      left: Math.max(0, caretRect.left - wrapperRect.left),
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
  const labels = resources
    .flatMap((r) => [r.mentionLabel, ...(r.aliases ?? [])])
    .sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `@(${labels.map(escapeRegExp).join('|')})(?=\\s|$|[，。,.])`,
    'g',
  )
  return prompt.replace(pattern, (_, label: string) => `<${label}>`)
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/shared/mention-editor/mention-utils.ts
git commit -m "feat(mention): 提取 @ 提及功能的纯函数工具"
```

---

### Task 3: 编写工具函数测试

**Files:**
- Create: `apps/web/src/components/shared/mention-editor/mention-utils.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  parseSegments,
  resolveMentionPrompt,
  limitPromptLength,
  escapeRegExp,
} from './mention-utils'
import type { MentionResource } from './types'

const imageResources: MentionResource[] = [
  { id: 'img-1', mentionLabel: '图片1', sourceLabel: '参考图1', kind: 'image' },
  { id: 'img-2', mentionLabel: '图片2', sourceLabel: '参考图2', kind: 'image' },
]

const mixedResources: MentionResource[] = [
  { id: 'img-1', mentionLabel: '图片1', kind: 'image' },
  { id: 'vid-1', mentionLabel: '视频1', kind: 'video' },
  { id: 'aud-1', mentionLabel: '音频1', kind: 'audio' },
]

const aliasResources: MentionResource[] = [
  { id: 'char-1', mentionLabel: '角色A', kind: 'character', aliases: ['A', '主角'] },
]

describe('parseSegments', () => {
  test('空字符串返回空数组', () => {
    assert.deepEqual(parseSegments('', imageResources), [])
  })

  test('无资源时返回纯文本段落', () => {
    assert.deepEqual(parseSegments('hello world', []), [
      { type: 'text', text: 'hello world' },
    ])
  })

  test('解析单个 @ 标签', () => {
    const segments = parseSegments('参考 @图片1 的风格', imageResources)
    assert.equal(segments.length, 3)
    assert.equal(segments[0].type, 'text')
    assert.equal((segments[0] as { type: 'text'; text: string }).text, '参考 ')
    assert.equal(segments[1].type, 'mention')
    assert.equal((segments[1] as { type: 'mention'; text: string }).text, '@图片1')
    assert.equal(segments[2].type, 'text')
    assert.equal((segments[2] as { type: 'text'; text: string }).text, ' 的风格')
  })

  test('解析多个不同类型的 @ 标签', () => {
    const segments = parseSegments('结合 @视频1 和 @音频1', mixedResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 2)
  })

  test('匹配别名', () => {
    const segments = parseSegments('画 @主角 站在门口', aliasResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 1)
    assert.equal((mentions[0] as { type: 'mention'; text: string }).text, '@主角')
  })

  test('不匹配连续 @@', () => {
    const segments = parseSegments('@@图片1', imageResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 0)
  })

  test('标签后紧跟逗号正常匹配', () => {
    const segments = parseSegments('@图片1，继续描述', imageResources)
    const mentions = segments.filter((s) => s.type === 'mention')
    assert.equal(mentions.length, 1)
  })
})

describe('resolveMentionPrompt', () => {
  test('将 @标签 替换为 <标签>', () => {
    assert.equal(
      resolveMentionPrompt('参考 @图片1 的风格生成', imageResources),
      '参考 <图片1> 的风格生成',
    )
  })

  test('多个标签全部替换', () => {
    assert.equal(
      resolveMentionPrompt('@图片1 和 @图片2', imageResources),
      '<图片1> 和 <图片2>',
    )
  })

  test('没有 @ 标签时原样返回', () => {
    assert.equal(
      resolveMentionPrompt('生成一张森林海报', imageResources),
      '生成一张森林海报',
    )
  })

  test('空资源列表时原样返回', () => {
    assert.equal(resolveMentionPrompt('@图片1', []), '@图片1')
  })

  test('别名也能替换', () => {
    assert.equal(
      resolveMentionPrompt('画 @主角', aliasResources),
      '画 <角色A>',
    )
  })
})

describe('limitPromptLength', () => {
  test('不超过最大长度时原样返回', () => {
    assert.equal(limitPromptLength('hello', 10), 'hello')
  })

  test('超过最大长度时截断', () => {
    assert.equal(limitPromptLength('hello world', 5), 'hello')
  })

  test('正确处理 emoji 等多字节字符', () => {
    assert.equal(limitPromptLength('🎉🎊🎈', 2), '🎉🎊')
  })
})

describe('escapeRegExp', () => {
  test('转义正则特殊字符', () => {
    assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c')
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

```bash
node --import tsx --test apps/web/src/components/shared/mention-editor/mention-utils.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/shared/mention-editor/mention-utils.test.ts
git commit -m "test(mention): 添加 mention-utils 工具函数测试"
```

---

### Task 4: 创建 MentionEditor 组件

**Files:**
- Create: `apps/web/src/components/shared/mention-editor/mention-editor.tsx`

- [ ] **Step 1: 创建 mention-editor.tsx**

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
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
  /** 最大字符数，默认 500 */
  maxLength?: number
  /** 失焦回调 */
  onBlur?: () => void
  /** 是否禁用 */
  disabled?: boolean
  /** 编辑器容器 className */
  className?: string
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
  onBlur,
  disabled = false,
  className,
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

  /** 渲染选择器内容（分组或扁平） */
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
        suppressContentEditableWarning
        className={cn(
          'w-full whitespace-pre-wrap break-words p-2 text-xs bg-muted/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary max-h-[400px] overflow-y-auto',
          disabled && 'cursor-not-allowed opacity-70',
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
        onKeyDown={handleKeyDown}
      />

      {isEmpty && !isFocused && (
        <div className="pointer-events-none absolute left-2 top-2 text-xs text-muted-foreground">
          {placeholder}
        </div>
      )}

      <div className="mt-1 flex justify-end text-[10px] text-muted-foreground">
        {Array.from(value).length}/{maxLength}
      </div>

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
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/shared/mention-editor/mention-editor.tsx
git commit -m "feat(mention): 创建通用 MentionEditor 组件"
```

---

### Task 5: 创建统一导出

**Files:**
- Create: `apps/web/src/components/shared/mention-editor/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
export type { MentionResource } from './types'
export { MentionEditor } from './mention-editor'
export type { MentionEditorProps } from './mention-editor'
export { resolveMentionPrompt } from './mention-utils'
```

- [ ] **Step 2: 提交**

```bash
git add apps/web/src/components/shared/mention-editor/index.ts
git commit -m "feat(mention): 添加统一导出"
```

---

### Task 6: 集成到 ImagePanel

**Files:**
- Modify: `apps/web/src/components/generation/image/image-panel.tsx`

- [ ] **Step 1: 添加导入**

在 image-panel.tsx 顶部 import 区域添加：

```typescript
import { Film, Music, ImageIcon } from 'lucide-react' // 在已有 lucide 导入行中追加 Film, Music（如果没有的话）
import { MentionEditor, resolveMentionPrompt } from '@/components/shared/mention-editor'
import type { MentionResource } from '@/components/shared/mention-editor'
```

- [ ] **Step 2: 构建 mentionResources 映射**

在 `ImagePanel` 函数体中，`estimatedCredits` 之后添加：

```typescript
/** 将已上传的参考图映射为 @ 提及资源 */
const mentionResources: MentionResource[] = referenceImages.map((img, index) => ({
  id: img.id,
  mentionLabel: `图片${index + 1}`,
  sourceLabel: '参考图',
  kind: 'image',
}))
```

- [ ] **Step 3: 替换 Textarea 为 MentionEditor**

将 image-panel.tsx 中的 Textarea 区域（约 265-273 行）：

```tsx
<div className="flex-1 min-h-0">
  <Textarea
    placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
    value={prompt}
    onChange={(e) => setPrompt(e.target.value)}
    onKeyDown={handleKeyDown}
    className="h-full resize-none"
    disabled={isGenerating || disabled}
  />
</div>
```

替换为：

```tsx
<div className="flex-1 min-h-0">
  <MentionEditor
    value={prompt}
    onChange={setPrompt}
    resources={mentionResources}
    placeholder="描述你想要生成的图片...&#10;&#10;Ctrl+Enter 快速生成"
    className="h-full"
    disabled={isGenerating || disabled}
    mentionClassName={() =>
      'text-blue-600 bg-blue-50 border-blue-200'
    }
    mentionIcon={() => ImageIcon}
    emptyText="暂无可引用资源，请先上传参考图"
  />
</div>
```

- [ ] **Step 4: 提交 prompt 替换逻辑**

在 `handleGenerate` 中，将 `const batch = await generate()` 改为：

```typescript
const resolvedPrompt = resolveMentionPrompt(prompt, mentionResources)
const batch = await generate(resolvedPrompt)
```

- [ ] **Step 5: 移除未使用的导入**

检查是否还需要 `Textarea` 导入（如果面板中其他地方不再使用 `Textarea`，则移除该导入）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/generation/image/image-panel.tsx
git commit -m "feat(image): ImagePanel 集成 @ 提及功能"
```

---

### Task 7: 修改 useGenerate 支持 overridePrompt

**Files:**
- Modify: `apps/web/src/hooks/use-generate.ts`

- [ ] **Step 1: 修改 generate 函数签名**

将 `generate` 回调的参数改为接受可选的 `overridePrompt`：

```typescript
const generate = useCallback(async (overridePrompt?: string): Promise<BatchResponse | null> => {
  const finalPrompt = (overridePrompt ?? prompt).trim()
  if (!finalPrompt) return null
  // ... 后续所有 prompt.trim() 替换为 finalPrompt
```

- [ ] **Step 2: 替换所有 prompt.trim() 为 finalPrompt**

在 generate 函数体内，将 `prompt.trim()` 替换为 `finalPrompt`（应该只有两处：判断和 body 构建）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/hooks/use-generate.ts
git commit -m "feat(generate): useGenerate 支持 overridePrompt 参数"
```

---

### Task 8: 集成到 VideoPanel

**Files:**
- Modify: `apps/web/src/components/generation/video/video-panel.tsx`

- [ ] **Step 1: 添加导入**

```typescript
import { MentionEditor, resolveMentionPrompt } from '@/components/shared/mention-editor'
import type { MentionResource } from '@/components/shared/mention-editor'
```

- [ ] **Step 2: 构建 mentionResources 映射**

在 `VideoPanel` 函数体中，`multimodalAudios` state 之后添加：

```typescript
/** 将已上传的参考资源映射为 @ 提及资源 */
const mentionResources: MentionResource[] = useMemo(() => {
  const items: MentionResource[] = []
  multimodalImages.forEach((img, i) => {
    items.push({ id: img.id, mentionLabel: `图片${i + 1}`, sourceLabel: '参考图', kind: 'image' })
  })
  multimodalVideos.forEach((vid, i) => {
    items.push({ id: vid.name, mentionLabel: `视频${i + 1}`, sourceLabel: vid.name, kind: 'video' })
  })
  multimodalAudios.forEach((aud, i) => {
    items.push({ id: aud.id, mentionLabel: `音频${i + 1}`, sourceLabel: aud.name, kind: 'audio' })
  })
  return items
}, [multimodalImages, multimodalVideos, multimodalAudios])
```

注意：需要确认 `useMemo` 已在导入中。

- [ ] **Step 3: 替换 Textarea 为 MentionEditor**

将 video-panel.tsx 中的 Textarea 区域（约 366-374 行）：

```tsx
<div className="flex-1 min-h-0">
  <Textarea
    placeholder="描述你想要生成的视频内容..."
    value={videoPrompt}
    onChange={(e) => setVideoPrompt(e.target.value)}
    className="h-full resize-none"
    disabled={isVideoGenerating || disabled}
  />
</div>
```

替换为：

```tsx
<div className="flex-1 min-h-0">
  <MentionEditor
    value={videoPrompt}
    onChange={setVideoPrompt}
    resources={mentionResources}
    placeholder="描述你想要生成的视频内容..."
    className="h-full"
    disabled={isVideoGenerating || disabled}
    mentionClassName={(kind) => {
      if (kind === 'video') return 'text-violet-600 bg-violet-50 border-violet-200'
      if (kind === 'audio') return 'text-emerald-600 bg-emerald-50 border-emerald-200'
      return 'text-blue-600 bg-blue-50 border-blue-200'
    }}
    mentionIcon={(kind) => {
      if (kind === 'video') return Film
      if (kind === 'audio') return Music
      return ImageIcon
    }}
    emptyText="暂无可引用资源"
  />
</div>
```

注意：`Film`、`Music`、`ImageIcon` 需要在 lucide-react 导入中。

- [ ] **Step 4: 替换提交 prompt**

在 `handleVideoGenerate` 中，将 `prompt: videoPrompt.trim()` 改为：

```typescript
const resolvedPrompt = resolveMentionPrompt(videoPrompt, mentionResources)
// ...
prompt: resolvedPrompt.trim(),
```

- [ ] **Step 5: 移除未使用的 Textarea 导入**

如果 Textarea 不再被 video-panel.tsx 使用，移除导入。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/generation/video/video-panel.tsx
git commit -m "feat(video): VideoPanel 集成 @ 提及功能"
```

---

## Self-Review Checklist

### 1. Spec Coverage
- ✅ 通用 MentionResource 类型 → Task 1
- ✅ 工具函数提取 → Task 2
- ✅ 工具函数测试 → Task 3
- ✅ MentionEditor 组件 → Task 4
- ✅ 统一导出 → Task 5
- ✅ ImagePanel 集成 → Task 6
- ✅ useGenerate overridePrompt → Task 7
- ✅ VideoPanel 集成 → Task 8
- ✅ @ → <> 替换 → Task 2 (resolveMentionPrompt) + Task 6/8 (调用)
- ✅ AvatarPanel 排除 → 未包含，符合设计
- ✅ ActionImitationPanel 排除 → 未包含，符合设计

### 2. Placeholder Scan
- ✅ 无 TBD、TODO、"implement later"、"fill in details"
- ✅ 每一步都包含完整代码
- ✅ 无 "similar to Task N" 的偷懒引用

### 3. Type Consistency
- ✅ `MentionResource` 在所有文件中使用同一类型
- ✅ `resolveMentionPrompt` 签名一致（prompt, resources）→ string
- ✅ `mentionClassName` / `mentionIcon` 命名全文统一
- ✅ `useGenerate` 的 `overridePrompt` 参数名一致
