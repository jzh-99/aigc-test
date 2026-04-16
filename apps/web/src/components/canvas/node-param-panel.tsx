'use client'

import { useCallback, useMemo, useState, type MutableRefObject } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { mutate } from 'swr'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import { CanvasApiError, executeCanvasNode, executeVideoNode } from '@/lib/canvas/canvas-api'
import type {
  AppNode,
  AssetConfig,
  ImageGenConfig,
  TextInputConfig,
  VideoGenConfig,
  ScriptWriterConfig,
  StoryboardSplitterConfig,
} from '@/lib/canvas/types'
import {
  isAssetConfig,
  isImageGenConfig,
  isTextInputConfig,
  isVideoGenConfig,
  isScriptWriterConfig,
  isStoryboardSplitterConfig,
} from '@/lib/canvas/types'
import { AssetPanel } from './panels/asset-panel'
import { ImageGenPanel } from './panels/image-gen-panel'
import {
  IMAGE_MODEL_OPTIONS,
  MODEL_CODE_MAP,
  VIDEO_MODEL_OPTIONS,
  type ModelType,
  type Resolution,
} from './panels/panel-constants'
import { TextInputPanel } from './panels/text-input-panel'
import { useNodeConfigDraft } from './panels/use-node-config-draft'
import { useNodeTopology } from './panels/use-node-topology'
import { VideoGenPanel } from './panels/video-gen-panel'
import { ScriptWriterPanel } from './panels/script-writer-panel'
import { StoryboardSplitterPanel } from './panels/storyboard-splitter-panel'

interface Props {
  node: AppNode
  canvasId: string
  onClose: () => void
  onExecuted: () => void
  onStoryboardExpandedRef?: MutableRefObject<((shotNodeIds: string[]) => void) | null>
}

const DEFAULT_IMAGE_CONFIG: ImageGenConfig = {
  prompt: '',
  modelType: 'gemini',
  resolution: '2k',
  aspectRatio: '1:1',
  quantity: 1,
  watermark: false,
}

const DEFAULT_VIDEO_CONFIG: VideoGenConfig = {
  prompt: '',
  model: 'seedance-2.0',
  videoMode: 'multiref',
  aspectRatio: 'adaptive',
  duration: 5,
  generateAudio: true,
  cameraFixed: false,
  watermark: false,
}

const DEFAULT_TEXT_CONFIG: TextInputConfig = { text: '' }
const DEFAULT_ASSET_CONFIG: AssetConfig = { url: '', name: '', mimeType: 'image/jpeg' }
const DEFAULT_SCRIPT_WRITER_CONFIG: ScriptWriterConfig = { description: '', style: '现代都市', duration: 60 }
const DEFAULT_STORYBOARD_SPLITTER_CONFIG: StoryboardSplitterConfig = { shotCount: 0 }

export function NodeParamPanel({ node, canvasId, onClose, onExecuted, onStoryboardExpandedRef }: Props) {
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const token = useAuthStore((s) => s.accessToken)
  const setNodeStatus = useCanvasExecutionStore((s) => s.setNodeStatus)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const [executing, setExecuting] = useState(false)

  const isImageGen = node.type === 'image_gen'
  const isTextInput = node.type === 'text_input'
  const isAsset = node.type === 'asset'
  const isVideoGen = node.type === 'video_gen'
  const isScriptWriter = node.type === 'script_writer'
  const isStoryboardSplitter = node.type === 'storyboard_splitter'

  const imageCfg = isImageGen && isImageGenConfig(node.data.config)
    ? node.data.config
    : DEFAULT_IMAGE_CONFIG
  const videoCfg = isVideoGen && isVideoGenConfig(node.data.config)
    ? node.data.config
    : DEFAULT_VIDEO_CONFIG
  const textCfg = isTextInput && isTextInputConfig(node.data.config)
    ? node.data.config
    : DEFAULT_TEXT_CONFIG
  const assetCfg = isAsset && isAssetConfig(node.data.config)
    ? node.data.config
    : DEFAULT_ASSET_CONFIG
  const scriptWriterCfg = isScriptWriter && isScriptWriterConfig(node.data.config)
    ? node.data.config
    : DEFAULT_SCRIPT_WRITER_CONFIG
  const storyboardSplitterCfg = isStoryboardSplitter && isStoryboardSplitterConfig(node.data.config)
    ? node.data.config
    : DEFAULT_STORYBOARD_SPLITTER_CONFIG

  const {
    upstreamTexts,
    upstreamTextNodeLabels,
    orderedImageRefs,
    multirefImages,
    multirefVideos,
    multirefAudios,
    keyframeImages,
  } = useNodeTopology(node.id)

  const [keyframeSwapped, setKeyframeSwapped] = useState(false)
  const displayedKeyframes = useMemo(() => {
    if (keyframeSwapped && keyframeImages.length === 2) return [keyframeImages[1], keyframeImages[0]]
    return keyframeImages
  }, [keyframeImages, keyframeSwapped])

  const promptFromConfig = isImageGen ? imageCfg.prompt : isVideoGen ? videoCfg.prompt : ''
  const textFromConfig = isTextInput ? textCfg.text : ''

  const {
    textDraft,
    setTextDraft,
    promptDraft,
    setPromptDraft,
    flushTextDraft,
    flushPromptDraft,
    updateCfg,
  } = useNodeConfigDraft({
    nodeId: node.id,
    isTextInput,
    isPromptNode: isImageGen || isVideoGen,
    textFromConfig,
    promptFromConfig,
  })

  const modelType: ModelType = imageCfg.modelType
  const resolution: Resolution = imageCfg.resolution
  const aspectRatio = imageCfg.aspectRatio
  const quantity = imageCfg.quantity
  const watermark = imageCfg.watermark

  const videoModel = videoCfg.model
  const videoMode = videoCfg.videoMode
  const videoAspect = videoCfg.aspectRatio
  const videoDuration = videoCfg.duration
  const generateAudio = videoCfg.generateAudio
  const cameraFixed = videoCfg.cameraFixed
  const videoWatermark = videoCfg.watermark

  const handleModelChange = useCallback((val: ModelType) => {
    const model = IMAGE_MODEL_OPTIONS.find((m) => m.value === val)
    if (!model) return
    const nextResolution = model.resolutions.includes(resolution) ? resolution : model.resolutions[0]
    updateCfg({ modelType: val, resolution: nextResolution })
  }, [resolution, updateCfg])

  const handleExecuteImage = useCallback(async () => {
    const modelCode = MODEL_CODE_MAP[modelType][resolution]
    if (!modelCode) {
      toast.error('模型配置错误')
      return
    }

    const finalPrompt = [...upstreamTexts, promptDraft].filter(Boolean).join('\n')
    if (!canvasId || !finalPrompt.trim()) {
      toast.error('请先填写提示词')
      return
    }

    setExecuting(true)
    setNodeStatus(node.id, 'pending', { progress: 0 })

    try {
      const result = await executeCanvasNode(
        {
          canvasId,
          canvasNodeId: node.id,
          type: 'image_gen',
          config: {
            prompt: finalPrompt,
            model: modelCode,
            aspectRatio,
            quantity,
            watermark,
            resolution,
          },
          workspaceId: workspaceId ?? undefined,
          referenceImageUrls: orderedImageRefs.length > 0 ? orderedImageRefs.map((r) => r.url) : undefined,
        },
        token ?? undefined
      )

      useCanvasSidebarDataStore.getState().prependHistoryItem(canvasId, {
        id: result.id,
        canvas_node_id: node.id,
        model: modelCode,
        prompt: finalPrompt,
        quantity: result.quantity ?? quantity,
        completed_count: 0,
        failed_count: 0,
        status: 'pending',
        actual_credits: result.estimated_credits ?? 0,
        created_at: new Date().toISOString(),
      })

      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      toast.success('已提交生成任务')
      onExecuted()
    } catch (err: unknown) {
      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      const message = err instanceof Error ? err.message : '执行失败'
      const code = err instanceof CanvasApiError ? err.code : undefined
      toast.error(message)
      setNodeError(node.id, message, code)
    } finally {
      setExecuting(false)
    }
  }, [
    aspectRatio,
    canvasId,
    modelType,
    node.id,
    onExecuted,
    orderedImageRefs,
    promptDraft,
    quantity,
    resolution,
    setNodeError,
    setNodeStatus,
    token,
    upstreamTexts,
    watermark,
    workspaceId,
  ])

  const handleVideoModelChange = useCallback((val: string) => {
    const model = VIDEO_MODEL_OPTIONS.find((o) => o.value === val)
    if (!model) return

    const newMode = videoMode === 'multiref' && !model.supportsMultiref ? 'keyframe' : videoMode
    const newAspect = model.isSeedance ? (videoAspect || 'adaptive') : ''
    updateCfg({ model: val, videoMode: newMode, aspectRatio: newAspect })
  }, [updateCfg, videoAspect, videoMode])

  const handleVideoModeChange = useCallback((newMode: VideoGenConfig['videoMode']) => {
    if (newMode === videoMode) return
    updateCfg({ videoMode: newMode })
    setKeyframeSwapped(false)
  }, [updateCfg, videoMode])

  const handleExecuteVideo = useCallback(async () => {
    const finalPrompt = [...upstreamTexts, promptDraft].filter(Boolean).join('\n')
    if (!canvasId || !finalPrompt.trim()) {
      toast.error('请先填写提示词')
      return
    }

    setExecuting(true)
    setNodeStatus(node.id, 'pending', { progress: 0 })

    try {
      const result = await executeVideoNode(
        {
          canvasId,
          canvasNodeId: node.id,
          workspaceId: workspaceId ?? undefined,
          prompt: finalPrompt,
          model: videoModel,
          videoMode,
          aspectRatio: videoAspect || undefined,
          duration: videoDuration,
          generateAudio,
          cameraFixed,
          watermark: videoWatermark,
          referenceImages: videoMode === 'multiref' ? multirefImages : undefined,
          referenceVideos: videoMode === 'multiref' ? multirefVideos : undefined,
          referenceAudios: videoMode === 'multiref' ? multirefAudios : undefined,
          frameStart: videoMode === 'keyframe' ? displayedKeyframes[0]?.url : undefined,
          frameEnd: videoMode === 'keyframe' ? displayedKeyframes[1]?.url : undefined,
        },
        token ?? undefined
      )

      useCanvasSidebarDataStore.getState().prependHistoryItem(canvasId, {
        id: result.id,
        canvas_node_id: node.id,
        model: videoModel,
        prompt: finalPrompt,
        quantity: result.quantity ?? 1,
        completed_count: 0,
        failed_count: 0,
        status: 'pending',
        actual_credits: result.estimated_credits ?? 0,
        created_at: new Date().toISOString(),
        module: 'video',
      })

      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      toast.success('已提交视频生成任务')
      onExecuted()
    } catch (err: unknown) {
      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      const message = err instanceof Error ? err.message : '执行失败'
      const code = err instanceof CanvasApiError ? err.code : undefined
      const isSubmitFail = message.includes('视频生成服务暂时不可用') || message.includes('任务创建失败')
      const displayMessage = isSubmitFail ? `${message}（积分已退回）` : message
      toast.error(displayMessage)
      setNodeError(node.id, isSubmitFail ? '提交失败，积分已退回' : message, code)
    } finally {
      setExecuting(false)
    }
  }, [
    cameraFixed,
    canvasId,
    displayedKeyframes,
    generateAudio,
    multirefAudios,
    multirefImages,
    multirefVideos,
    node.id,
    onExecuted,
    promptDraft,
    setNodeError,
    setNodeStatus,
    token,
    upstreamTexts,
    videoAspect,
    videoDuration,
    videoMode,
    videoModel,
    videoWatermark,
    workspaceId,
  ])

  const hasImagePrompt = promptDraft.trim() || upstreamTexts.length > 0
  const hasVideoPrompt = promptDraft.trim() || upstreamTexts.length > 0

  return (
    <div data-testid="canvas-node-param-panel" className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <span className="text-xs font-semibold text-foreground">{node.data.label} · 参数</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isAsset && <AssetPanel config={assetCfg} />}

      {isTextInput && (
        <TextInputPanel
          textDraft={textDraft}
          setTextDraft={setTextDraft}
          flushTextDraft={flushTextDraft}
          upstreamTextNodeLabels={upstreamTextNodeLabels}
        />
      )}

      {isImageGen && (
        <ImageGenPanel
          promptDraft={promptDraft}
          setPromptDraft={setPromptDraft}
          flushPromptDraft={flushPromptDraft}
          upstreamTextNodeLabels={upstreamTextNodeLabels}
          orderedImageRefs={orderedImageRefs}
          modelType={modelType}
          resolution={resolution}
          aspectRatio={aspectRatio}
          quantity={quantity}
          watermark={watermark}
          executing={executing}
          hasPrompt={!!hasImagePrompt}
          onModelChange={handleModelChange}
          onUpdateCfg={updateCfg}
          onExecute={handleExecuteImage}
        />
      )}

      {isVideoGen && (
        <VideoGenPanel
          promptDraft={promptDraft}
          setPromptDraft={setPromptDraft}
          flushPromptDraft={flushPromptDraft}
          upstreamTextNodeLabels={upstreamTextNodeLabels}
          orderedImageRefCount={orderedImageRefs.length}
          multirefImages={multirefImages}
          multirefVideos={multirefVideos}
          multirefAudios={multirefAudios}
          keyframeImages={keyframeImages}
          displayedKeyframes={displayedKeyframes}
          keyframeSwapped={keyframeSwapped}
          setKeyframeSwapped={setKeyframeSwapped}
          videoModel={videoModel}
          videoMode={videoMode}
          videoAspect={videoAspect}
          videoDuration={videoDuration}
          generateAudio={generateAudio}
          cameraFixed={cameraFixed}
          videoWatermark={videoWatermark}
          executing={executing}
          hasPrompt={!!hasVideoPrompt}
          onVideoModelChange={handleVideoModelChange}
          onVideoModeChange={handleVideoModeChange}
          onUpdateCfg={updateCfg}
          onExecute={handleExecuteVideo}
        />
      )}

      {isScriptWriter && (
        <ScriptWriterPanel
          nodeId={node.id}
          canvasId={canvasId}
          config={scriptWriterCfg}
          onExecuted={onExecuted}
        />
      )}

      {isStoryboardSplitter && (
        <StoryboardSplitterPanel
          nodeId={node.id}
          canvasId={canvasId}
          config={storyboardSplitterCfg}
          onExecuted={onExecuted}
          onExpanded={(shotNodeIds) => onStoryboardExpandedRef?.current?.(shotNodeIds)}
        />
      )}
    </div>
  )
}
