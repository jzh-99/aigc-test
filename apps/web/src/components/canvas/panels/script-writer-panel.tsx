'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Clock, Palette, Sparkles } from 'lucide-react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { CanvasApiError, executeScriptWriterNode } from '@/lib/canvas/canvas-api'
import type { ScriptWriterConfig } from '@/lib/canvas/types'
import { generateUUID } from '@/lib/utils'
import { PopoverSelect, ExecuteButton, PanelToolbar } from './panel-shared'

const STYLE_OPTIONS = ['现代都市', '古装', '科幻', '动漫', '纪录片', '悬疑', '奇幻']

const DURATION_OPTIONS = [
  { value: '30', label: '30秒' },
  { value: '60', label: '1分钟' },
  { value: '120', label: '2分钟' },
  { value: '180', label: '3分钟' },
  { value: '300', label: '5分钟' },
  { value: '600', label: '10分钟' },
]

interface Props {
  nodeId: string
  canvasId: string
  config: ScriptWriterConfig
  onExecuted: () => void
}

export function ScriptWriterPanel({ nodeId, canvasId, config, onExecuted }: Props) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const setNodeStatus = useCanvasExecutionStore((s) => s.setNodeStatus)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const addNodeOutput = useCanvasExecutionStore((s) => s.addNodeOutput)
  const execState = useCanvasExecutionStore((s) => s.nodes[nodeId])
  const token = useAuthStore((s) => s.accessToken)

  const [executing, setExecuting] = useState(false)

  const script = (execState?.outputs[0]?.paramsSnapshot as { script?: string } | undefined)?.script ?? ''
  const characters = (execState?.outputs[0]?.paramsSnapshot as { characters?: string[] } | undefined)?.characters ?? []
  const scenes = (execState?.outputs[0]?.paramsSnapshot as { scenes?: string[] } | undefined)?.scenes ?? []
  const isDone = execState?.submissionStatus === 'completed'

  const updateCfg = useCallback((patch: Partial<ScriptWriterConfig>) => {
    updateNodeData(nodeId, { config: { ...config, ...patch } })
  }, [nodeId, config, updateNodeData])

  const handleExecute = useCallback(async () => {
    if (!config.description.trim()) {
      toast.error('请先填写故事描述')
      return
    }
    setExecuting(true)
    setNodeStatus(nodeId, 'pending', { progress: 0 })
    try {
      const result = await executeScriptWriterNode(
        { description: config.description, style: config.style, duration: config.duration },
        token ?? undefined,
      )
      addNodeOutput(nodeId, {
        id: generateUUID(),
        url: '',
        type: 'text',
        paramsSnapshot: { script: result.script, characters: result.characters, scenes: result.scenes },
      })
      setNodeStatus(nodeId, 'completed', { progress: 100 })
      toast.success('剧本生成完成')
      onExecuted()
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行失败'
      const code = err instanceof CanvasApiError ? err.code : undefined
      toast.error(message)
      setNodeError(nodeId, message, code)
    } finally {
      setExecuting(false)
    }
  }, [config, nodeId, token, addNodeOutput, setNodeStatus, setNodeError, onExecuted])

  const styleOptions = STYLE_OPTIONS.map((s) => ({ value: s, label: s }))

  return (
    <div className="p-4 space-y-4">
      {/* 故事描述 — 大文本框 */}
      <textarea
        className="w-full min-h-[180px] p-3 text-sm leading-relaxed bg-muted/40 border border-border/60 rounded-xl resize-none focus:outline-none focus:border-primary/40 transition-colors placeholder:text-muted-foreground/70"
        placeholder="简单描述你想要的故事内容…"
        value={config.description}
        onChange={(e) => updateCfg({ description: e.target.value })}
      />

      {/* 底部工具栏 */}
      <div className="flex items-center justify-between pt-1">
        <PanelToolbar>
          {/* 风格选择 */}
          <PopoverSelect
            icon={<Palette className="h-3.5 w-3.5" />}
            label="风格"
            value={config.style}
            options={styleOptions}
            onChange={(val) => updateCfg({ style: val })}
          />

          {/* 时长选择 */}
          <PopoverSelect
            icon={<Clock className="h-3.5 w-3.5" />}
            label="时长"
            value={String(config.duration)}
            options={DURATION_OPTIONS}
            onChange={(val) => updateCfg({ duration: Number(val) })}
          />
        </PanelToolbar>

        <ExecuteButton
          icon={<Sparkles className="h-4 w-4" />}
          credits={0}
          executing={executing}
          disabled={!config.description.trim()}
          onClick={handleExecute}
        />
      </div>

      {/* 生成结果展示 */}
      {isDone && script && (
        <div className="space-y-3 pt-2 border-t border-border/60">
          {characters.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">角色</p>
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c, i) => (
                  <span key={i} className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-md">{c}</span>
                ))}
              </div>
            </div>
          )}
          {scenes.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">场景</p>
              <div className="flex flex-wrap gap-1.5">
                {scenes.map((s, i) => (
                  <span key={i} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded-md">{s}</span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">剧本</p>
            <div className="max-h-48 overflow-y-auto text-[11px] text-foreground bg-muted/30 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
              {script}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
