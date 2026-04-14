import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import type { CanvasNodeConfig } from '@/lib/canvas/types'

interface UseNodeConfigDraftParams {
  nodeId: string
  isTextInput: boolean
  isPromptNode: boolean
  textFromConfig: string
  promptFromConfig: string
}

export function useNodeConfigDraft({
  nodeId,
  isTextInput,
  isPromptNode,
  textFromConfig,
  promptFromConfig,
}: UseNodeConfigDraftParams) {
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)

  const [textDraft, setTextDraft] = useState(textFromConfig)
  const [promptDraft, setPromptDraft] = useState(promptFromConfig)

  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateCfg = useCallback((patch: Partial<CanvasNodeConfig>) => {
    const latestNode = useCanvasStructureStore.getState().nodes.find((n) => n.id === nodeId)
    const latestCfg = (latestNode?.data.config ?? {}) as CanvasNodeConfig
    updateNodeData(nodeId, { config: { ...latestCfg, ...patch } as CanvasNodeConfig })
  }, [nodeId, updateNodeData])

  useEffect(() => {
    setTextDraft(textFromConfig)
  }, [nodeId, textFromConfig])

  useEffect(() => {
    setPromptDraft(promptFromConfig)
  }, [nodeId, promptFromConfig])

  const flushTextDraft = useCallback(() => {
    if (!isTextInput) return

    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current)
      textDebounceRef.current = null
    }

    if (textDraft !== textFromConfig) {
      updateCfg({ text: textDraft })
    }
  }, [isTextInput, textDraft, textFromConfig, updateCfg])

  const flushPromptDraft = useCallback(() => {
    if (!isPromptNode) return

    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current)
      promptDebounceRef.current = null
    }

    if (promptDraft !== promptFromConfig) {
      updateCfg({ prompt: promptDraft })
    }
  }, [isPromptNode, promptDraft, promptFromConfig, updateCfg])

  useEffect(() => {
    if (!isTextInput) return
    if (textDraft === textFromConfig) return

    if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    textDebounceRef.current = setTimeout(() => {
      updateCfg({ text: textDraft })
      textDebounceRef.current = null
    }, 200)

    return () => {
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    }
  }, [isTextInput, textDraft, textFromConfig, updateCfg])

  useEffect(() => {
    if (!isPromptNode) return
    if (promptDraft === promptFromConfig) return

    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    promptDebounceRef.current = setTimeout(() => {
      updateCfg({ prompt: promptDraft })
      promptDebounceRef.current = null
    }, 200)

    return () => {
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    }
  }, [isPromptNode, promptDraft, promptFromConfig, updateCfg])

  useEffect(() => {
    return () => {
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current)
    }
  }, [])

  return {
    textDraft,
    setTextDraft,
    promptDraft,
    setPromptDraft,
    flushTextDraft,
    flushPromptDraft,
    updateCfg,
  }
}
