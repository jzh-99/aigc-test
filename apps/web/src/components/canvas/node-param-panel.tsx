'use client'

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { mutate } from 'swr'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useCanvasExecutionStore } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCanvasSidebarDataStore } from '@/stores/canvas/sidebar-data-store'
import { CanvasApiError, executeAudioNode, executeCanvasNode, executeVideoNode } from '@/lib/canvas/canvas-api'
import { getCategoryReferencesForModel, validateImageReferencesForModel } from '@/lib/image-categories'
import { useModels } from '@/hooks/use-models'
import { getModelResolutions, extractSchemaEnums } from '@/components/generation/shared/schema-utils'
import { parseCategoryReferences, validateCategoryReferenceLimits, type ModelItem, type VideoCategory, type VideoReferenceCounts } from '@aigc/types'
import type {
  AppNode,
  AssetConfig,
  AudioGenConfig,
  ImageGenConfig,
  TextInputConfig,
  VideoGenConfig,
  VideoStitchConfig,
  ScriptWriterConfig,
  StoryboardSplitterConfig,
} from '@/lib/canvas/types'
import {
  DEFAULT_IMAGE_CATEGORY_LIMITS,
  DEFAULT_TEXT_CATEGORY_LIMITS,
  DEFAULT_VIDEO_CATEGORY_LIMITS,
  isAssetConfig,
  isAudioGenConfig,
  isImageGenConfig,
  isTextInputConfig,
  isVideoGenConfig,
  isVideoStitchConfig,
  isScriptWriterConfig,
  isStoryboardSplitterConfig,
} from '@/lib/canvas/types'
import { AssetPanel } from './panels/asset-panel'
import { AudioGenPanel } from './panels/audio-gen-panel'
import { ImageGenPanel } from './panels/image-gen-panel'
import {
  type ModelType,
  type Resolution,
} from './panels/panel-constants'
import { TextInputPanel } from './panels/text-input-panel'
import { useNodeConfigDraft } from './panels/use-node-config-draft'
import { useNodeTopology } from './panels/use-node-topology'
import { VideoGenPanel } from './panels/video-gen-panel'
import { ScriptWriterPanel } from './panels/script-writer-panel'
import { StoryboardSplitterPanel } from './panels/storyboard-splitter-panel'
import { VideoStitchPanel } from './panels/video-stitch-panel'
import {
  buildPromptWithResourceMentions,
  PROMPT_MAX_LENGTH,
  removeResourceReferenceFromPrompt,
} from './panels/resource-mentions'

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
  categoryReferences: DEFAULT_IMAGE_CATEGORY_LIMITS,
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
  categoryReferences: DEFAULT_VIDEO_CATEGORY_LIMITS,
}

const DEFAULT_TEXT_CONFIG: TextInputConfig = { text: '', model: 'qwen3.6-plus', categoryReferences: DEFAULT_TEXT_CATEGORY_LIMITS }
const DEFAULT_ASSET_CONFIG: AssetConfig = { url: '', name: '', mimeType: 'image/jpeg' }
const DEFAULT_AUDIO_CONFIG: AudioGenConfig = {
  text: '',
  model: 'speech-2.8-turbo',
  voiceId: 'female-yujie',
  speed: 1,
  pitch: 0,
  volume: 1,
  emotion: '',
}
const DEFAULT_SCRIPT_WRITER_CONFIG: ScriptWriterConfig = { description: '', style: '现代都市', duration: 60 }
const DEFAULT_STORYBOARD_SPLITTER_CONFIG: StoryboardSplitterConfig = { shotCount: 0 }
const DEFAULT_VIDEO_STITCH_CONFIG: VideoStitchConfig = { inputOrder: [] }

const CANVAS_MODE_TO_CATEGORY: Record<VideoGenConfig['videoMode'], VideoCategory> = {
  multiref: 'multimodal',
  keyframe: 'frames',
}

const CATEGORY_TO_CANVAS_MODE: Record<VideoCategory, VideoGenConfig['videoMode']> = {
  multimodal: 'multiref',
  frames: 'keyframe',
}

function normalizeImageConfig(config: unknown, models?: ModelItem[]): ImageGenConfig {
  const raw = (config && typeof config === 'object' ? config : {}) as Partial<ImageGenConfig>

  if (!models || models.length === 0) {
    return { ...DEFAULT_IMAGE_CONFIG, ...raw, quantity: 1 }
  }

  const dbModel = models.find((m) => m.code === raw.modelType) ?? models[0]
  const modelCode = dbModel.code
  const resolutions = extractSchemaEnums(dbModel.params_schema, 'resolution').map((e) => e.value)
  const resolution = raw.resolution && resolutions.includes(raw.resolution) ? raw.resolution : (resolutions[0] ?? '2k')
  const categoryReferences = getCategoryReferencesForModel(dbModel)

  return {
    ...DEFAULT_IMAGE_CONFIG,
    ...raw,
    modelType: modelCode,
    resolution,
    quantity: 1,
    categoryReferences,
  }
}

function normalizeTextConfig(config: unknown, models?: ModelItem[]): TextInputConfig {
  const raw = (config && typeof config === 'object' ? config : {}) as Partial<TextInputConfig>
  const dbModel = models?.find((m) => m.code === raw.model) ?? models?.find((m) => m.provider_code === 'qwen') ?? models?.[0]
  const parsed = parseCategoryReferences(dbModel?.category_references ?? raw.categoryReferences)
  return {
    ...DEFAULT_TEXT_CONFIG,
    ...raw,
    model: dbModel?.code ?? raw.model ?? DEFAULT_TEXT_CONFIG.model,
    categoryReferences: Object.keys(parsed).length > 0 ? parsed : DEFAULT_TEXT_CATEGORY_LIMITS,
  }
}

function normalizeVideoConfig(config: unknown, models?: ModelItem[]): VideoGenConfig {
  const raw = (config && typeof config === 'object' ? config : {}) as Partial<VideoGenConfig>
  const dbModel = models?.find((m) => m.code === raw.model) ?? models?.[0]
  const modelCode = dbModel?.code ?? raw.model ?? DEFAULT_VIDEO_CONFIG.model
  const resolutions = extractSchemaEnums(dbModel?.params_schema, 'resolution').map((e) => e.value)
  const resolution = raw.resolution && resolutions.includes(raw.resolution)
    ? raw.resolution
    : resolutions[0]
  const videoMode = raw.videoMode === 'keyframe' || raw.videoMode === 'multiref' ? raw.videoMode : DEFAULT_VIDEO_CONFIG.videoMode
  const duration = typeof raw.duration === 'number' ? raw.duration : DEFAULT_VIDEO_CONFIG.duration
  // 使用 parseCategoryReferences 确保数据格式正确
  const parsed = parseCategoryReferences(dbModel?.category_references ?? raw.categoryReferences)
  const categoryReferences = Object.keys(parsed).length > 0 ? parsed : DEFAULT_VIDEO_CATEGORY_LIMITS

  return {
    ...DEFAULT_VIDEO_CONFIG,
    ...raw,
    model: modelCode,
    videoMode,
    duration,
    categoryReferences,
    ...(resolution ? { resolution } : {}),
  }
}

function normalizeAudioConfig(config: unknown, models?: ModelItem[]): AudioGenConfig {
  const raw = (config && typeof config === 'object' ? config : {}) as Partial<AudioGenConfig>
  const dbModel = models?.find((m) => m.code === raw.model) ?? models?.[0]
  return {
    ...DEFAULT_AUDIO_CONFIG,
    ...raw,
    model: dbModel?.code ?? raw.model ?? DEFAULT_AUDIO_CONFIG.model,
    speed: typeof raw.speed === 'number' ? raw.speed : DEFAULT_AUDIO_CONFIG.speed,
    pitch: typeof raw.pitch === 'number' ? raw.pitch : DEFAULT_AUDIO_CONFIG.pitch,
    volume: typeof raw.volume === 'number' ? raw.volume : DEFAULT_AUDIO_CONFIG.volume,
    emotion: raw.emotion ?? DEFAULT_AUDIO_CONFIG.emotion,
  }
}

export function NodeParamPanel({ node, canvasId, onClose, onExecuted, onStoryboardExpandedRef }: Props) {
  const workspaceId = useCanvasStructureStore((s) => s.workspaceId)
  const removeEdgeById = useCanvasStructureStore((s) => s.removeEdgeById)
  const token = useAuthStore((s) => s.accessToken)
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId)
  const setNodeStatus = useCanvasExecutionStore((s) => s.setNodeStatus)
  const setNodeError = useCanvasExecutionStore((s) => s.setNodeError)
  const replaceNodeOutput = useCanvasExecutionStore((s) => s.replaceNodeOutput)
  const selectNodeOutput = useCanvasExecutionStore((s) => s.selectNodeOutput)
  const [executing, setExecuting] = useState(false)
  const globalWatermark = useGenerationStore((s) => s.watermark)

  // 动态模型列表，与创作生成板块共用同一 API
  const { models: imageModels, isReady: imageModelsReady } = useModels('image', activeWorkspaceId)
  const { models: videoModels, isReady: videoModelsReady } = useModels('video', activeWorkspaceId)
  const { models: audioModels, isReady: audioModelsReady } = useModels('tts', activeWorkspaceId)
  const { models: agentModels, isReady: agentModelsReady } = useModels('agent', activeWorkspaceId)

  const isImageGen = node.type === 'image_gen'
  const isTextInput = node.type === 'text_input'
  const isAsset = node.type === 'asset'
  const isVideoGen = node.type === 'video_gen'
  const isAudioGen = node.type === 'audio_gen'
  const isVideoStitch = node.type === 'video_stitch'
  const isScriptWriter = node.type === 'script_writer'
  const isStoryboardSplitter = node.type === 'storyboard_splitter'

  const imageCfg = isImageGen
    ? normalizeImageConfig(node.data.config, imageModelsReady ? imageModels : undefined)
    : DEFAULT_IMAGE_CONFIG
  const videoCfg = isVideoGen
    ? normalizeVideoConfig(node.data.config, videoModelsReady ? videoModels : undefined)
    : DEFAULT_VIDEO_CONFIG
  const textCfg = isTextInput && isTextInputConfig(node.data.config)
    ? normalizeTextConfig(node.data.config, agentModelsReady ? agentModels : undefined)
    : DEFAULT_TEXT_CONFIG
  const assetCfg = isAsset && isAssetConfig(node.data.config)
    ? node.data.config
    : DEFAULT_ASSET_CONFIG
  const audioCfg = isAudioGen && isAudioGenConfig(node.data.config)
    ? normalizeAudioConfig(node.data.config, audioModelsReady ? audioModels : undefined)
    : DEFAULT_AUDIO_CONFIG
  const scriptWriterCfg = isScriptWriter && isScriptWriterConfig(node.data.config)
    ? node.data.config
    : DEFAULT_SCRIPT_WRITER_CONFIG
  const storyboardSplitterCfg = isStoryboardSplitter && isStoryboardSplitterConfig(node.data.config)
    ? node.data.config
    : DEFAULT_STORYBOARD_SPLITTER_CONFIG
  const videoStitchCfg = isVideoStitch && isVideoStitchConfig(node.data.config)
    ? node.data.config
    : DEFAULT_VIDEO_STITCH_CONFIG

  const {
    upstreamTexts,
    upstreamTextNodeLabels,
    orderedImageRefs,
    multirefImages,
    multirefVideos,
    multirefVideoDurations,
    multirefAudios,
    keyframeImages,
  } = useNodeTopology(node.id)

  const [keyframeSwapped, setKeyframeSwapped] = useState(false)
  const displayedKeyframes = useMemo(() => {
    if (keyframeSwapped && keyframeImages.length === 2) return [keyframeImages[1], keyframeImages[0]]
    return keyframeImages
  }, [keyframeImages, keyframeSwapped])

  const promptFromConfig = isImageGen ? imageCfg.prompt : isVideoGen ? videoCfg.prompt : ''
  const textFromConfig = isTextInput ? textCfg.text : isAudioGen ? audioCfg.text : ''

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
    isTextInput: isTextInput || isAudioGen,
    isPromptNode: isImageGen || isVideoGen,
    textFromConfig,
    promptFromConfig,
  })

  const commitTextDraft = useCallback((value: string) => {
    updateCfg({ text: value })
  }, [updateCfg])

  const modelType: ModelType = imageCfg.modelType
  const resolution: Resolution = imageCfg.resolution
  const aspectRatio = imageCfg.aspectRatio
  const quantity = 1
  const watermark = globalWatermark

  const videoModel = videoCfg.model
  const videoMode = videoCfg.videoMode
  const videoAspect = videoCfg.aspectRatio
  const videoDuration = videoCfg.duration
  const generateAudio = videoCfg.generateAudio
  const cameraFixed = videoCfg.cameraFixed
  const videoWatermark = globalWatermark
  // 视频分辨率（可选）
  const videoResolution = videoCfg.resolution ?? ''
  const currentVideoDbModel = videoModels.find((m) => m.code === videoModel)
  const currentCategoryReferences = useMemo(
    () => parseCategoryReferences(currentVideoDbModel?.category_references),
    [currentVideoDbModel?.category_references],
  )

  const handleModelChange = useCallback((val: ModelType) => {
    // 优先从 DB 模型列表获取新模型的首个可用分辨率
    const nextResolutions = getModelResolutions(val, imageModels)
    const nextResolution = nextResolutions.includes(resolution) ? resolution : (nextResolutions[0] ?? resolution)
    const nextModel = imageModels.find((m) => m.code === val)
    updateCfg({ modelType: val, resolution: nextResolution, categoryReferences: getCategoryReferencesForModel(nextModel) })
  }, [resolution, updateCfg, imageModels])

  // 确保图片节点配置中的 categoryReferences 始终与当前模型数据同步，供画布连线限制使用。
  useEffect(() => {
    if (!isImageGen || !imageModelsReady) return
    const currentImageDbModel = imageModels.find((m) => m.code === modelType)
    const parsed = getCategoryReferencesForModel(currentImageDbModel)
    if (JSON.stringify(parsed) !== JSON.stringify(imageCfg.categoryReferences)) {
      updateCfg({ categoryReferences: parsed })
    }
  }, [imageCfg.categoryReferences, imageModels, imageModelsReady, isImageGen, modelType, updateCfg])

  // 确保节点配置中的 categoryReferences 始终与模型数据同步
  useEffect(() => {
    if (!isVideoGen || !videoModelsReady || !currentVideoDbModel) return
    const parsed = parseCategoryReferences(currentVideoDbModel.category_references)
    // 只有当确实有变化时才更新，避免无限循环
    if (JSON.stringify(parsed) !== JSON.stringify(videoCfg.categoryReferences)) {
      updateCfg({ categoryReferences: parsed })
    }
  }, [currentVideoDbModel, isVideoGen, updateCfg, videoModelsReady, videoCfg.categoryReferences])

  // 文本节点也使用模型数据里的 categoryReferences，默认模型暂时固定为 Qwen。
  useEffect(() => {
    if (!isTextInput || !agentModelsReady) return
    const currentTextDbModel = agentModels.find((m) => m.code === textCfg.model) ?? agentModels.find((m) => m.provider_code === 'qwen')
    const parsed = parseCategoryReferences(currentTextDbModel?.category_references)
    const nextCategoryReferences = Object.keys(parsed).length > 0 ? parsed : DEFAULT_TEXT_CATEGORY_LIMITS
    if (textCfg.model !== (currentTextDbModel?.code ?? textCfg.model)
      || JSON.stringify(nextCategoryReferences) !== JSON.stringify(textCfg.categoryReferences)) {
      updateCfg({
        model: currentTextDbModel?.code ?? textCfg.model,
        categoryReferences: nextCategoryReferences,
      })
    }
  }, [agentModels, agentModelsReady, isTextInput, textCfg.categoryReferences, textCfg.model, updateCfg])

  const handleExecuteImage = useCallback(async () => {
    if (Array.from(promptDraft).length > PROMPT_MAX_LENGTH) {
      toast.error(`提示词不能超过 ${PROMPT_MAX_LENGTH} 字`)
      return
    }

    const dbModel = imageModels.find((m) => m.code === modelType)
    const modelCode = (() => {
      if (dbModel && dbModel.params_pricing.length > 0) {
        const rule = dbModel.params_pricing.find((r) => r.resolution === resolution)
        if (rule?.model) return rule.model
      }
      // 无 pricing 规则时直接用 model code 本身
      return dbModel?.code
    })()
    if (!modelCode) {
      toast.error('模型配置错误')
      return
    }

    const imageLimitResult = validateImageReferencesForModel(dbModel, orderedImageRefs.length)
    if (!imageLimitResult.valid) {
      toast.error(imageLimitResult.message ?? '当前参考图数量不符合模型限制')
      return
    }

    const finalPrompt = buildPromptWithResourceMentions(upstreamTexts, promptDraft, orderedImageRefs)
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
    imageModels,
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
    const dbModel = videoModels.find((m) => m.code === val)
    const isSeedanceModel = val.startsWith('seedance-')
    const categories = parseCategoryReferences(dbModel?.category_references)
    const targetCategory = CANVAS_MODE_TO_CATEGORY[videoMode]
    const nextCategory = categories[targetCategory]
      ? targetCategory
      : (categories.multimodal ? 'multimodal' : categories.frames ? 'frames' : targetCategory)
    const newAspect = isSeedanceModel ? (videoAspect || 'adaptive') : ''
    const nextResolutions = extractSchemaEnums(dbModel?.params_schema, 'resolution').map((e) => e.value)
    const nextResolution = videoResolution && nextResolutions.includes(videoResolution)
      ? videoResolution
      : nextResolutions[0]

    updateCfg({
      model: val,
      videoMode: CATEGORY_TO_CANVAS_MODE[nextCategory],
      aspectRatio: newAspect,
      categoryReferences: categories,
      ...(nextResolution ? { resolution: nextResolution } : {}),
    })
  }, [updateCfg, videoAspect, videoMode, videoModels, videoResolution])

  const getCanvasVideoCounts = useCallback((_mode: VideoGenConfig['videoMode']): VideoReferenceCounts => {
    return orderedImageRefs.reduce<VideoReferenceCounts>((counts, ref) => {
      if (ref.mimeType?.startsWith('video')) return { ...counts, video: counts.video + 1 }
      if (ref.mimeType?.startsWith('audio')) return { ...counts, audio: counts.audio + 1 }
      return { ...counts, image: counts.image + 1 }
    }, { image: 0, video: 0, audio: 0, text: 0 })
  }, [orderedImageRefs])

  const handleVideoModeChange = useCallback((newMode: VideoGenConfig['videoMode']) => {
    if (newMode === videoMode) return
    const category = CANVAS_MODE_TO_CATEGORY[newMode]
    const validation = validateCategoryReferenceLimits(currentCategoryReferences, category, getCanvasVideoCounts(newMode))
    if (!validation.valid) {
      toast.error(validation.message ?? '当前连线不符合目标模式限制')
      return
    }
    updateCfg({ videoMode: newMode })
    setKeyframeSwapped(false)
  }, [currentCategoryReferences, getCanvasVideoCounts, updateCfg, videoMode])

  // 视频分辨率变更回调
  const handleVideoResolutionChange = useCallback((val: string) => {
    updateCfg({ resolution: val })
  }, [updateCfg])

  const handleAudioModelChange = useCallback((val: string) => {
    updateCfg({ model: val })
  }, [updateCfg])

  const handleRemoveReference = useCallback((resourceId: string) => {
    const nextPrompt = removeResourceReferenceFromPrompt(promptDraft, orderedImageRefs, resourceId)
    setPromptDraft(nextPrompt)
    updateCfg({ prompt: nextPrompt })
    removeEdgeById(resourceId)
  }, [orderedImageRefs, promptDraft, removeEdgeById, setPromptDraft, updateCfg])

  const handleExecuteVideo = useCallback(async () => {
    if (Array.from(promptDraft).length > PROMPT_MAX_LENGTH) {
      toast.error(`提示词不能超过 ${PROMPT_MAX_LENGTH} 字`)
      return
    }

    const finalPrompt = buildPromptWithResourceMentions(upstreamTexts, promptDraft, orderedImageRefs)
    if (!canvasId || !finalPrompt.trim()) {
      toast.error('请先填写提示词')
      return
    }

    const category = CANVAS_MODE_TO_CATEGORY[videoMode]
    const validation = validateCategoryReferenceLimits(currentCategoryReferences, category, getCanvasVideoCounts(videoMode))
    if (!validation.valid) {
      toast.error(validation.message ?? '当前参考素材不符合模型限制')
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
          resolution: videoResolution || undefined,
          duration: videoDuration,
          generateAudio,
          cameraFixed,
          watermark: videoWatermark,
          referenceImages: videoMode === 'multiref' ? multirefImages : undefined,
          referenceVideos: videoMode === 'multiref' ? multirefVideos : undefined,
          referenceVideoDurations: videoMode === 'multiref' ? multirefVideoDurations : undefined,
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
    currentCategoryReferences,
    displayedKeyframes,
    generateAudio,
    getCanvasVideoCounts,
    multirefAudios,
    multirefImages,
    multirefVideos,
    multirefVideoDurations,
    node.id,
    onExecuted,
    promptDraft,
    orderedImageRefs,
    setNodeError,
    setNodeStatus,
    token,
    upstreamTexts,
    videoAspect,
    videoDuration,
    videoMode,
    videoModel,
    videoResolution,
    videoWatermark,
    workspaceId,
  ])

  const handleExecuteAudio = useCallback(async () => {
    const finalText = textDraft.trim()
    if (!finalText) {
      toast.error('请先输入要合成的文本')
      return
    }
    if (!audioCfg.voiceId) {
      toast.error('请先选择音色')
      return
    }

    setExecuting(true)
    setNodeStatus(node.id, 'pending', { progress: 0 })

    try {
      const result = await executeAudioNode(
        {
          canvasId,
          canvasNodeId: node.id,
          workspaceId: workspaceId ?? undefined,
          config: { ...audioCfg, text: finalText },
        },
        token ?? undefined,
      ) as { id: string; output_id?: string | null; output_url?: string; estimated_credits?: number }

      if (result.output_url) {
        const outputId = result.output_id ?? result.id
        replaceNodeOutput(node.id, { id: outputId, url: result.output_url, type: 'audio' })
        selectNodeOutput(node.id, outputId)
      }
      setNodeStatus(node.id, 'completed', { progress: 100 })

      useCanvasSidebarDataStore.getState().prependHistoryItem(canvasId, {
        id: result.id,
        canvas_node_id: node.id,
        model: audioCfg.model,
        prompt: finalText,
        quantity: 1,
        completed_count: 1,
        failed_count: 0,
        status: 'completed',
        actual_credits: result.estimated_credits ?? 0,
        created_at: new Date().toISOString(),
        module: 'tts',
      })

      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      toast.success('音频生成完成')
      onExecuted()
    } catch (err: unknown) {
      const activeTeamId = useAuthStore.getState().activeTeamId
      if (activeTeamId) mutate(`/teams/${activeTeamId}`)

      const message = err instanceof Error ? err.message : '音频生成失败'
      const code = err instanceof CanvasApiError ? err.code : undefined
      toast.error(message)
      setNodeError(node.id, message, code)
    } finally {
      setExecuting(false)
    }
  }, [
    audioCfg,
    canvasId,
    node.id,
    onExecuted,
    replaceNodeOutput,
    selectNodeOutput,
    setNodeError,
    setNodeStatus,
    textDraft,
    token,
    workspaceId,
  ])

  const hasImagePrompt = promptDraft.trim() || upstreamTexts.length > 0
  const hasVideoPrompt = promptDraft.trim() || upstreamTexts.length > 0

  return (
    <div data-testid="canvas-node-param-panel" className="w-[380px] bg-background border border-border/60 rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/30">
        <span className="text-sm font-semibold text-foreground">{node.data.label} · 参数</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isAsset && <AssetPanel config={assetCfg} />}

      {isTextInput && (
        <TextInputPanel
          setTextDraft={setTextDraft}
          commitTextDraft={commitTextDraft}
          onGeneratingChange={(generating) => setNodeStatus(node.id, generating ? 'processing' : 'completed')}
          onProgressChange={(progress) => setNodeStatus(node.id, progress >= 100 ? 'completed' : 'processing', { progress })}
        />
      )}

      {isImageGen && (
        <ImageGenPanel
          promptDraft={promptDraft}
          setPromptDraft={setPromptDraft}
          flushPromptDraft={flushPromptDraft}
          upstreamTextNodeLabels={upstreamTextNodeLabels}
          orderedImageRefs={orderedImageRefs}
          mentionResources={orderedImageRefs}
          modelType={modelType}
          resolution={resolution}
          aspectRatio={aspectRatio}
          quantity={quantity}
          executing={executing}
          hasPrompt={!!hasImagePrompt}
          models={imageModels}
          onModelChange={handleModelChange}
          onUpdateCfg={updateCfg}
          onRemoveReference={handleRemoveReference}
          onExecute={handleExecuteImage}
        />
      )}

      {isVideoGen && (
        <VideoGenPanel
          promptDraft={promptDraft}
          setPromptDraft={setPromptDraft}
          flushPromptDraft={flushPromptDraft}
          upstreamTextNodeLabels={upstreamTextNodeLabels}
          mentionResources={orderedImageRefs}
          multirefImages={multirefImages}
          multirefVideos={multirefVideos}
          multirefVideoDurations={multirefVideoDurations}
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
          executing={executing}
          hasPrompt={!!hasVideoPrompt}
          models={videoModels}
          videoResolution={videoResolution}
          onVideoResolutionChange={handleVideoResolutionChange}
          onVideoModelChange={handleVideoModelChange}
          onVideoModeChange={handleVideoModeChange}
          onUpdateCfg={updateCfg}
          onRemoveReference={handleRemoveReference}
          onExecute={handleExecuteVideo}
        />
      )}

      {isAudioGen && (
        <AudioGenPanel
          textDraft={textDraft}
          setTextDraft={setTextDraft}
          flushTextDraft={flushTextDraft}
          model={audioCfg.model}
          voiceId={audioCfg.voiceId}
          speed={audioCfg.speed}
          pitch={audioCfg.pitch}
          volume={audioCfg.volume}
          executing={executing}
          models={audioModels}
          onModelChange={handleAudioModelChange}
          onUpdateCfg={updateCfg}
          onExecute={handleExecuteAudio}
        />
      )}

      {isVideoStitch && (
        <VideoStitchPanel
          nodeId={node.id}
          canvasId={canvasId}
          config={videoStitchCfg}
          onUpdateCfg={updateCfg}
          onExecuted={onExecuted}
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
