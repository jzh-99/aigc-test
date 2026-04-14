export type E2ECanvasNodeType = 'text_input' | 'image_gen' | 'video_gen' | 'asset'

export interface E2ECanvasNode {
  id: string
  type: E2ECanvasNodeType
  position: { x: number; y: number }
  data: {
    label: string
    config: Record<string, unknown>
  }
}

export interface E2ECanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export function createTextNode(params: {
  id: string
  label?: string
  text?: string
  position?: { x: number; y: number }
}): E2ECanvasNode {
  return {
    id: params.id,
    type: 'text_input',
    position: params.position ?? { x: 100, y: 120 },
    data: {
      label: params.label ?? '文本输入',
      config: {
        text: params.text ?? '',
      },
    },
  }
}

export function createImageNode(params: {
  id: string
  label?: string
  prompt?: string
  position?: { x: number; y: number }
}): E2ECanvasNode {
  return {
    id: params.id,
    type: 'image_gen',
    position: params.position ?? { x: 360, y: 120 },
    data: {
      label: params.label ?? 'AI 生图',
      config: {
        prompt: params.prompt ?? '',
        modelType: 'gemini',
        resolution: '2k',
        aspectRatio: '1:1',
        quantity: 1,
        watermark: false,
      },
    },
  }
}

export function createVideoNode(params: {
  id: string
  label?: string
  prompt?: string
  videoMode?: 'multiref' | 'keyframe'
  model?: string
  position?: { x: number; y: number }
}): E2ECanvasNode {
  return {
    id: params.id,
    type: 'video_gen',
    position: params.position ?? { x: 620, y: 140 },
    data: {
      label: params.label ?? 'AI 视频',
      config: {
        prompt: params.prompt ?? '',
        model: params.model ?? 'seedance-2.0',
        videoMode: params.videoMode ?? 'multiref',
        aspectRatio: 'adaptive',
        duration: 5,
        generateAudio: true,
        cameraFixed: false,
        watermark: false,
      },
    },
  }
}

export function createAssetNode(params: {
  id: string
  label?: string
  url: string
  mimeType?: string
  position?: { x: number; y: number }
}): E2ECanvasNode {
  return {
    id: params.id,
    type: 'asset',
    position: params.position ?? { x: 380, y: 320 },
    data: {
      label: params.label ?? '素材',
      config: {
        url: params.url,
        name: params.label ?? '素材',
        mimeType: params.mimeType ?? 'image/jpeg',
      },
    },
  }
}

export function createEdge(params: {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}): E2ECanvasEdge {
  return {
    id: params.id,
    source: params.source,
    target: params.target,
    sourceHandle: params.sourceHandle,
    targetHandle: params.targetHandle,
  }
}
