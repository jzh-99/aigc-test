import type { CanvasNodeDefinition, CanvasNodeData, AppNode } from './types'
import { TextNode } from '@/components/canvas/nodes/text-node'
import { ImageGenNode } from '@/components/canvas/nodes/image-gen-node'
import { AssetNode } from '@/components/canvas/nodes/asset-node'
import { VideoGenNode } from '@/components/canvas/nodes/video-gen-node'

export class NodeRegistry {
  private static instance: NodeRegistry
  private nodes: Map<string, CanvasNodeDefinition> = new Map()

  private constructor() {
    this.initDefaultNodes()
  }

  private initDefaultNodes() {
    this.register({
      type: 'text_input',
      label: '文本输入',
      CanvasComponent: TextNode as any,
      inputs: [{ id: 'any-in', type: 'any', position: 'left' }],
      outputs: [{ id: 'text-out', type: 'text', position: 'right' }],
      defaultConfig: { text: '' },
    })

    this.register({
      type: 'image_gen',
      label: 'AI 生图',
      CanvasComponent: ImageGenNode as any,
      inputs: [
        { id: 'any-in', type: 'any', position: 'left', isList: true },
      ],
      outputs: [{ id: 'image-out', type: 'image', position: 'right' }],
      defaultConfig: { prompt: '', modelType: 'gemini', resolution: '2k', aspectRatio: '1:1', quantity: 1, watermark: false },
    })

    this.register({
      type: 'asset',
      label: '素材',
      CanvasComponent: AssetNode as any,
      inputs: [],
      outputs: [{ id: 'image-out', type: 'image', position: 'right' }],
      defaultConfig: { url: '', name: '', mimeType: 'image/jpeg' },
    })

    this.register({
      type: 'video_gen',
      label: 'AI 视频',
      CanvasComponent: VideoGenNode as any,
      inputs: [
        // 全能参考 mode: single handle, accepts multiple connections (images/videos/audios)
        { id: 'any-in', type: 'any', position: 'left', isList: true },
        // keyframe mode handles
        { id: 'frame-start', type: 'image', position: 'left', label: '首帧' },
        { id: 'frame-end',   type: 'image', position: 'left', label: '尾帧' },
        { id: 'text-in',     type: 'text',  position: 'left', label: '文本' },
      ],
      outputs: [{ id: 'video-out', type: 'video', position: 'right' }],
      defaultConfig: {
        prompt: '',
        model: 'seedance-2.0',
        videoMode: 'multiref',
        aspectRatio: 'adaptive',
        duration: 5,
        generateAudio: true,
        cameraFixed: false,
        watermark: false,
      },
    })
  }

  public static getInstance(): NodeRegistry {
    if (!NodeRegistry.instance) {
      NodeRegistry.instance = new NodeRegistry()
    }
    return NodeRegistry.instance
  }

  public register<TConfig>(definition: CanvasNodeDefinition<TConfig>) {
    if (this.nodes.has(definition.type)) {
      console.warn(`[NodeRegistry] 节点类型 '${definition.type}' 已被注册并覆盖。`)
    }
    this.nodes.set(definition.type, definition as CanvasNodeDefinition<any>)
  }

  public getDefinition(type: string): CanvasNodeDefinition | undefined {
    return this.nodes.get(type)
  }

  public getAllDefinitions(): CanvasNodeDefinition[] {
    return Array.from(this.nodes.values())
  }

  public createNodeInstance(type: string, position: { x: number; y: number }, id?: string): AppNode {
    const definition = this.getDefinition(type)
    if (!definition) throw new Error(`[NodeRegistry] 未知的节点类型: '${type}'，请先注册。`)
    return {
      id: id || `node_${crypto.randomUUID()}`,
      type: definition.type,
      position,
      data: {
        label: definition.label,
        config: JSON.parse(JSON.stringify(definition.defaultConfig)),
      } as CanvasNodeData,
    }
  }

  public getReactFlowTypesMapping(): Record<string, any> {
    const mapping: Record<string, any> = {}
    this.nodes.forEach((def, type) => { mapping[type] = def.CanvasComponent })
    return mapping
  }
}

export const nodeRegistry = NodeRegistry.getInstance()
