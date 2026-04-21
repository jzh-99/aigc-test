'use client'

import { useRef, useEffect, useState, useCallback, KeyboardEvent, MutableRefObject } from 'react'
import { X, Send, Sparkles, AtSign } from 'lucide-react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasAgent } from '@/hooks/canvas/use-canvas-agent'
import type { AgentMessage, AgentInstruction } from '@/lib/canvas/agent-types'
import { AskUploadCard } from './agent-instructions/ask-upload-card'
import { AnnotateAssetsCard } from './agent-instructions/annotate-assets-card'
import { ConfirmPlanCard } from './agent-instructions/confirm-plan-card'
import { ConfirmStoryboardCard } from './agent-instructions/confirm-storyboard-card'
import { GuideStepCard } from './agent-instructions/guide-step-card'
import { DoneCard } from './agent-instructions/done-card'

interface Props {
  canvasId: string
  kickPoll: () => void
  onClose: () => void
  onNodeSelectedRef?: MutableRefObject<((nodeId: string) => boolean) | null>
  onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null>
  hidden?: boolean
  fullWidth?: boolean  // chat mode: panel takes full width
}

// ── Instruction renderer ─────────────────────────────────────────────────────

function InstructionWidget({
  instruction,
  canvasId,
  onAction,
  onNodeSelectedRef,
}: {
  instruction: AgentInstruction
  canvasId: string
  onAction: (type: string, payload?: unknown) => void
  onNodeSelectedRef?: MutableRefObject<((nodeId: string) => boolean) | null>
}) {
  if (instruction.type === 'ask_upload') {
    return (
      <AskUploadCard
        assetTypes={instruction.assetTypes}
        canvasId={canvasId}
        onUploaded={(files) => onAction('uploaded', files)}
        onSkip={() => onAction('skip_upload')}
        onNodeSelectedRef={onNodeSelectedRef}
      />
    )
  }
  if (instruction.type === 'annotate_assets') {
    return (
      <AnnotateAssetsCard
        assets={instruction.assets}
        options={instruction.options}
        onConfirm={(annotated) => onAction('annotated', annotated)}
      />
    )
  }
  if (instruction.type === 'confirm_plan') {
    return (
      <ConfirmPlanCard
        items={instruction.items}
        onConfirm={(selected) => onAction('plan_confirmed', selected)}
        onModify={() => onAction('plan_modify')}
      />
    )
  }
  if (instruction.type === 'confirm_storyboard') {
    return (
      <ConfirmStoryboardCard
        items={instruction.items}
        onConfirm={(confirmed) => onAction('storyboard_confirmed', confirmed)}
        onModify={() => onAction('storyboard_modify')}
      />
    )
  }
  if (instruction.type === 'done') {
    return <DoneCard />
  }
  return null
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  canvasId,
  isActiveStep,
  isRunning,
  onInstructionAction,
  onConfirmStep,
  onNodeSelectedRef,
}: {
  message: Extract<AgentMessage, { role: 'user' | 'assistant' }>
  canvasId: string
  isActiveStep: boolean  // true only for the current guide_step card
  isRunning: boolean
  onInstructionAction: (type: string, payload?: unknown) => void
  onConfirmStep: (params: import('@/lib/canvas/agent-types').StepParams) => void
  onNodeSelectedRef?: MutableRefObject<((nodeId: string) => boolean) | null>
}) {
  const isUser = message.role === 'user'

  // Render @[label|id] tokens as blue chips in user messages
  const renderUserContent = (text: string) => {
    const parts = text.split(/(@\[[^\]]+\])/g)
    return parts.map((part, i) => {
      const m = part.match(/^@\[([^\]|]+)\|[^\]]+\]$/)
      if (m) {
        return (
          <span key={i} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">
            <AtSign className="w-2.5 h-2.5" />
            {m[1]}
          </span>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
        } ${message.status === 'error' ? 'opacity-60' : ''}`}
      >
        {isUser ? renderUserContent(message.content) : message.content}
        {message.status === 'streaming' && (
          <span className="inline-block w-1 h-3.5 bg-current ml-0.5 animate-pulse rounded-sm" />
        )}
      </div>

      {/* Instruction widget — only show on assistant messages with instruction */}
      {!isUser && message.status === 'done' && message.instruction && (
        <div className="w-full max-w-[95%]">
          {message.instruction.type === 'guide_step' ? (
            <GuideStepCard
              step={message.instruction.step}
              onConfirm={onConfirmStep}
              disabled={!isActiveStep || isRunning}
              completed={!isActiveStep}
            />
          ) : (
            <InstructionWidget
              instruction={message.instruction}
              canvasId={canvasId}
              onAction={onInstructionAction}
              onNodeSelectedRef={onNodeSelectedRef}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Result bubble ────────────────────────────────────────────────────────────

function ResultBubble({ message }: { message: Extract<AgentMessage, { role: 'result' }> }) {
  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="text-xs text-muted-foreground px-1">{message.nodeLabel}</div>
      <div className={`grid gap-1.5 max-w-[95%] ${message.outputs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {message.outputs.map((o, i) =>
          o.type === 'image' ? (
            <img
              key={i}
              src={o.url}
              alt=""
              className="rounded-lg object-cover w-full cursor-pointer hover:opacity-90 transition-opacity"
              style={{ aspectRatio: '1/1' }}
              onClick={() => window.open(o.url, '_blank')}
            />
          ) : (
            <video
              key={i}
              src={o.url}
              className="rounded-lg w-full"
              style={{ aspectRatio: '16/9' }}
              controls
              muted
              loop
              playsInline
            />
          )
        )}
      </div>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function CanvasAgentPanel({ canvasId, kickPoll, onClose, onNodeSelectedRef, onStoryboardExpandedRef, hidden, fullWidth }: Props) {
  const {
    phase,
    messages,
    activeWorkflow,
    currentStepIndex,
    implicitNodeId,
    setImplicitNodeId,
    sendMessage,
    confirmStep,
    reset,
  } = useCanvasAgent(canvasId, kickPoll)

  const nodes = useCanvasStructureStore((s) => s.nodes)
  const implicitNode = implicitNodeId ? nodes.find((n) => n.id === implicitNodeId) : null

  const [input, setInput] = useState('')
  const [showNodePicker, setShowNodePicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isWaiting = phase === 'waiting_llm' || phase === 'running'

  // When the user has typed @ and the node picker is open, clicking a canvas node inserts @[label|id]
  useEffect(() => {
    if (!onNodeSelectedRef) return
    onNodeSelectedRef.current = (nodeId: string): boolean => {
      if (!showNodePicker) return false
      const node = useCanvasStructureStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return false
      setInput((prev) => {
        const lastAt = prev.lastIndexOf('@')
        return lastAt !== -1 ? prev.slice(0, lastAt) + `@[${node.data.label}|${nodeId}]` : prev
      })
      setShowNodePicker(false)
      setTimeout(() => inputRef.current?.focus(), 0)
      return true
    }
    return () => { onNodeSelectedRef.current = null }
  }, [onNodeSelectedRef, showNodePicker])

  // Expose sendMessage so StoryboardSplitterPanel can trigger agent continuation
  useEffect(() => {
    if (!onStoryboardExpandedRef) return
    onStoryboardExpandedRef.current = (shotNodeIds: string[]) => {
      sendMessage(`分镜已展开到画布，共 ${shotNodeIds.length} 个分镜节点（nodeId: ${shotNodeIds.join(', ')}），请继续搭建后续工作流`)
    }
    return () => { onStoryboardExpandedRef.current = null }
  }, [onStoryboardExpandedRef, sendMessage])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Pre-fill input for empty canvases — user decides whether to send or edit
  useEffect(() => {
    if (messages.length === 0 && useCanvasStructureStore.getState().nodes.length === 0) {
      setInput('你好，请介绍一下你能帮我做什么')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text && !implicitNodeId) return
    setInput('')
    setShowNodePicker(false)
    sendMessage(text)
  }, [input, implicitNodeId, sendMessage])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showNodePicker) return
      handleSend()
    }
    if (e.key === 'Escape') setShowNodePicker(false)
  }

  const handleInputChange = (value: string) => {
    setInput(value)
    const lastAt = value.lastIndexOf('@')
    // @ at end of input activates canvas-click-to-mention mode
    if (lastAt !== -1 && lastAt === value.length - 1) {
      setShowNodePicker(true)
    } else if (lastAt === -1 || value.slice(lastAt).includes(' ')) {
      setShowNodePicker(false)
    }
  }

  // Handle instruction widget actions
  const handleInstructionAction = useCallback(
    (type: string, payload?: unknown) => {
      if (type === 'skip_upload') {
        sendMessage('没有现成素材，直接开始搭建')
      } else if (type === 'uploaded') {
        const files = payload as import('@/lib/canvas/agent-types').UploadedFile[]
        // Include nodeId so LLM can reference asset nodes in apply_workflow
        const fileList = files.map((f) => `- ${f.name}（nodeId: ${f.nodeId}, mimeType: ${f.mimeType}, url: ${f.url}）`).join('\n')
        sendMessage(`已上传素材：\n${fileList}`)
      } else if (type === 'annotated') {
        const annotated = payload as Array<{ nodeId: string; name: string; mimeType: string; url: string; assetType: string; role: string }>
        // Pass full annotation details so LLM knows which asset is which character/scene
        const lines = annotated.map((a) => `- ${a.name}（nodeId: ${a.nodeId}, 用途: ${a.assetType}, 归属: ${a.role || '未指定'}）`).join('\n')
        sendMessage(`素材标注完成：\n${lines}\n请根据以上素材搭建工作流。`)
      } else if (type === 'plan_confirmed') {
        sendMessage('方案已确认，请搭建工作流')
      } else if (type === 'plan_modify') {
        inputRef.current?.focus()
      } else if (type === 'storyboard_confirmed') {
        const items = payload as import('@/lib/canvas/agent-types').StoryboardItem[]
        const lines = items.map((item) => `【${item.label}】\n${item.content}`).join('\n\n')
        sendMessage(`分镜文案已确认：\n\n${lines}\n\n请根据以上分镜文案搭建工作流，将每条分镜文案写入对应的 text_input 节点。`)
      } else if (type === 'storyboard_modify') {
        inputRef.current?.focus()
      }
    },
    [sendMessage],
  )

  const handleConfirmStep = useCallback(
    (params: import('@/lib/canvas/agent-types').StepParams) => {
      confirmStep(currentStepIndex, params)
    },
    [confirmStep, currentStepIndex],
  )

  const nodeTypeIcon = (type: string | undefined) => {
    if (type === 'image_gen') return '🖼'
    if (type === 'video_gen') return '🎬'
    if (type === 'text_input') return '📝'
    if (type === 'asset') return '📁'
    return '◻'
  }

  return (
    <div data-agent-panel className={`flex flex-col h-full border-l border-border bg-background shrink-0${fullWidth ? ' w-full border-l-0' : ' w-[360px]'}${hidden ? ' hidden' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">画布助手</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
          >
            清空
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg, idx) => {
          if (msg.role === 'result') {
            return <ResultBubble key={msg.id} message={msg} />
          }
          // A guide_step card is "active" only if it's the latest guide_step message
          // and the workflow is still in progress
          const isActiveStep = (() => {
            if (msg.instruction?.type !== 'guide_step') return false
            // Find the last guide_step message index
            const lastGuideIdx = messages.reduce((last, m, i) =>
              m.role !== 'result' && m.instruction?.type === 'guide_step' ? i : last, -1)
            return idx === lastGuideIdx && activeWorkflow !== null
          })()
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              canvasId={canvasId}
              isActiveStep={isActiveStep}
              isRunning={phase === 'running'}
              onInstructionAction={handleInstructionAction}
              onConfirmStep={handleConfirmStep}
              onNodeSelectedRef={onNodeSelectedRef}
            />
          )
        })}
        {isWaiting && (() => {
          const last = messages[messages.length - 1]
          return last?.role !== 'result' && last?.status !== 'streaming'
        })() && (
          <div className="flex items-start gap-2">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-muted-foreground">
              <span className="animate-pulse">思考中...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t px-3 py-2.5 shrink-0 space-y-2">
        {/* Implicit node tag */}
        {implicitNode && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">已关联：</span>
            <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
              {nodeTypeIcon(implicitNode.type)} {implicitNode.data.label}
              <button onClick={() => setImplicitNodeId(null)} className="ml-0.5 hover:text-primary/70">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
        )}

        {/* @ mode hint */}
        {showNodePicker && (
          <div className="absolute bottom-16 left-3 right-3 bg-popover border border-border rounded-lg shadow-lg z-10 px-3 py-2 text-xs text-muted-foreground">
            点击画布上的节点来引用它
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              phase === 'running'
                ? '执行中，也可以输入新需求...'
                : '描述你的需求，聚焦后点击节点可 @ 引用'
            }
            rows={1}
            className="flex-1 resize-none bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/60 max-h-24 overflow-y-auto"
            style={{ minHeight: '2.25rem' }}
            disabled={isWaiting && phase !== 'running'}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !implicitNodeId) || (isWaiting && phase !== 'running')}
            className="shrink-0 w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
