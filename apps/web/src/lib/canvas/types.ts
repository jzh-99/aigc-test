import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { ComponentType } from 'react'

export type HandleType = 'image' | 'text' | 'video' | 'audio' | 'any'

// Slot roles for named handles — used by video/image nodes to distinguish
// which upstream connection fills which semantic slot
export type HandleRole =
  | 'ref-1' | 'ref-2' | 'ref-3'          // multiref: ordered reference images
  | 'frame-start' | 'frame-end'           // keyframe: first/last frame
  | 'text-in' | 'image-out' | 'video-out' // generic I/O

export type CanvasNodeType = 'text_input' | 'image_gen' | 'video_gen' | 'asset' | 'script_writer' | 'storyboard_splitter' | 'video_stitch'
export type VideoMode = 'multiref' | 'keyframe'

// 保留 union 类型供静态 fallback 使用，实际存储和运行时用 string
export type ImageModelType = string
export type ImageResolution = string

export interface TextInputConfig {
  text: string
}

export interface ImageGenConfig {
  prompt: string
  modelType: ImageModelType
  resolution: ImageResolution
  aspectRatio: string
  quantity: number
  watermark: boolean
}

export interface VideoGenConfig {
  prompt: string
  model: string
  videoMode: VideoMode
  aspectRatio: string
  duration: number
  generateAudio: boolean
  cameraFixed: boolean
  watermark: boolean
}

export interface AssetConfig {
  url: string
  name?: string
  mimeType?: string
  duration?: number
}

export interface ScriptWriterConfig {
  description: string
  style: string
  duration: number
}

export interface StoryboardSplitterConfig {
  shotCount: number
}

export interface VideoStitchConfig {
  inputOrder: string[]
}

export interface CanvasNodeConfigMap {
  text_input: TextInputConfig
  image_gen: ImageGenConfig
  video_gen: VideoGenConfig
  asset: AssetConfig
  script_writer: ScriptWriterConfig
  storyboard_splitter: StoryboardSplitterConfig
  video_stitch: VideoStitchConfig
}

export type CanvasNodeConfig = CanvasNodeConfigMap[CanvasNodeType]

// 引脚方向约定：
// position: 'left' -> 输入引脚 (Target Handle) -> 接收上游参考
// position: 'right' -> 输出引脚 (Source Handle) -> 为下游提供参考
export interface CanvasNodeHandle {
  id: string // 唯一标识，例如 'ref-1', 'frame-start', 'text-out'
  type: HandleType
  position: 'left' | 'right'
  label?: string   // 显示在引脚旁的短标签，如 "参1" "首帧"
  isList?: boolean // 是否接受多条连线，默认为 false
}

// ---------------------------------------------------------
// 1. 结构层（CanvasStructureStore 管理的数据）
// 仅存静态信息，随画布全量保存，极其轻量
// ---------------------------------------------------------
export interface CanvasNodeData<TConfig = CanvasNodeConfig> {
  label: string
  config: TConfig // 业务相关的参数配置，比如 prompt, model, aspectRatio
}

export type AppNode = ReactFlowNode<CanvasNodeData, CanvasNodeType>
export type AppTypedNode<T extends CanvasNodeType> = ReactFlowNode<CanvasNodeData<CanvasNodeConfigMap[T]>, T>
export type AppEdge = ReactFlowEdge

export function isCanvasNodeType(type: string): type is CanvasNodeType {
  return type === 'text_input' || type === 'image_gen' || type === 'video_gen' || type === 'asset'
    || type === 'script_writer' || type === 'storyboard_splitter' || type === 'video_stitch'
}

export function isTextInputConfig(config: unknown): config is TextInputConfig {
  return typeof (config as TextInputConfig | undefined)?.text === 'string'
}

export function isImageGenConfig(config: unknown): config is ImageGenConfig {
  const c = config as Partial<ImageGenConfig> | null | undefined
  return typeof c?.prompt === 'string' && typeof c?.modelType === 'string'
}

export function isVideoGenConfig(config: unknown): config is VideoGenConfig {
  const c = config as Partial<VideoGenConfig> | null | undefined
  return typeof c?.prompt === 'string' && typeof c?.model === 'string' && (c?.videoMode === 'multiref' || c?.videoMode === 'keyframe')
}

export function isAssetConfig(config: unknown): config is AssetConfig {
  return typeof (config as AssetConfig | undefined)?.url === 'string'
}

export function isScriptWriterConfig(config: unknown): config is ScriptWriterConfig {
  const c = config as Partial<ScriptWriterConfig> | null | undefined
  return typeof c?.description === 'string' && typeof c?.style === 'string'
}

export function isStoryboardSplitterConfig(config: unknown): config is StoryboardSplitterConfig {
  return typeof (config as StoryboardSplitterConfig | undefined)?.shotCount === 'number'
}

export function isVideoStitchConfig(config: unknown): config is VideoStitchConfig {
  const c = config as Partial<VideoStitchConfig> | null | undefined
  return Array.isArray(c?.inputOrder)
}

// ---------------------------------------------------------
// 2. 执行层（CanvasExecutionStore 管理的数据）
// 仅存动态信息，本地缓存，按需请求，绝对不存入 structure_data JSONB 中
// ---------------------------------------------------------
export interface NodeOutputAsset {
  id: string           // 资产或快照 ID
  url: string          // S3 访问地址
  type: HandleType     // 输出类型 (image/video/text)
  paramsSnapshot?: unknown // 当时的参数快照
}

export type NodeSubmissionStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed' | 'partial_complete'
export type TaskBatchStatus = Exclude<NodeSubmissionStatus, 'idle'>

export interface NodeExecutionState {
  submissionStatus: NodeSubmissionStatus
  isGenerating: boolean
  progress: number
  errorMessage?: string
  errorCode?: string
  outputs: NodeOutputAsset[]
  selectedOutputId?: string | null
  warningMessage?: string
  startedAt: number | null // timestamp ms, for elapsed timer
}

// ---------------------------------------------------------
// 3. 节点注册表契约 (Node Registry Pattern)
// 所有新节点必须实现这个接口
// ---------------------------------------------------------
export interface CanvasNodeDefinition<
  TType extends CanvasNodeType = CanvasNodeType,
  TConfig = CanvasNodeConfigMap[TType],
> {
  type: TType             // 必须唯一，如 'image_gen', 'text_input', 'asset'
  label: string           // 展示名称
  icon?: ComponentType    // UI 图标

  // 画布上的极简 UI，只负责展示缩略图、进度和分页器
  CanvasComponent: ComponentType<{ id: string; data: CanvasNodeData<TConfig> }>

  // 点击后右侧滑出的属性面板，负责修改 config 并触发执行
  InspectorComponent?: ComponentType<{ id: string; data: CanvasNodeData<TConfig> }>

  // 引脚契约，用于在 onConnect 时做合法性拦截
  inputs: CanvasNodeHandle[]
  outputs: CanvasNodeHandle[]

  // 节点创建时的默认参数
  defaultConfig: TConfig

  // (预留的扩展接口) 版本升级函数
  version?: number
  migrate?: (oldConfig: unknown, oldVersion: number) => TConfig
}
