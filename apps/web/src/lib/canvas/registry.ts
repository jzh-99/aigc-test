import type { CanvasNodeDefinition, CanvasNodeData, AppNode } from './types'
import { TextNode } from '@/components/canvas/nodes/text-node'
import { ImageGenNode } from '@/components/canvas/nodes/image-gen-node'

// 节点类型的单例注册表
// 通过解耦 `useCanvasStructureStore` 与具体的节点实现
export class NodeRegistry {
  private static instance: NodeRegistry
  private nodes: Map<string, CanvasNodeDefinition> = new Map()

  private constructor() {
    this.initDefaultNodes()
  }

  private initDefaultNodes() {
    // 文本节点
    this.register({
      type: 'text_input',
      label: '文本输入',
      CanvasComponent: TextNode as any,
      inputs: [],
      outputs: [{ id: 'text-out', type: 'text', position: 'right' }],
      defaultConfig: { text: '' },
    })

    // 生图节点
    this.register({
      type: 'image_gen',
      label: 'AI 生图',
      CanvasComponent: ImageGenNode as any,
      inputs: [{ id: 'any-in', type: 'any', position: 'left' }],
      outputs: [{ id: 'image-out', type: 'image', position: 'right' }],
      defaultConfig: {
        prompt: '',
        model: 'flux',
        aspectRatio: '1:1',
      },
    })
  }

  public static getInstance(): NodeRegistry {
    if (!NodeRegistry.instance) {
      NodeRegistry.instance = new NodeRegistry()
    }
    return NodeRegistry.instance
  }


  // 注册一个新的画布节点类型
  public register<TConfig>(definition: CanvasNodeDefinition<TConfig>) {
    if (this.nodes.has(definition.type)) {
      console.warn(`[NodeRegistry] 节点类型 '${definition.type}' 已被注册并覆盖。`)
    }
    this.nodes.set(definition.type, definition as CanvasNodeDefinition<any>)
  }

  // 获取节点定义
  public getDefinition(type: string): CanvasNodeDefinition | undefined {
    return this.nodes.get(type)
  }

  // 获取所有的节点类型（用于左侧菜单栏或悬浮创建面板）
  public getAllDefinitions(): CanvasNodeDefinition[] {
    return Array.from(this.nodes.values())
  }

  // 快捷创建一个新的空节点实例
  public createNodeInstance(
    type: string,
    position: { x: number; y: number },
    id?: string
  ): AppNode {
    const definition = this.getDefinition(type)
    if (!definition) {
      throw new Error(`[NodeRegistry] 未知的节点类型: '${type}'，请先注册。`)
    }

    return {
      id: id || `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: definition.type,
      position,
      data: {
        label: definition.label,
        config: JSON.parse(JSON.stringify(definition.defaultConfig)), // 深拷贝默认参数
      } as CanvasNodeData,
    }
  }

  // 为 React Flow 提供渲染组件的 mapping 对象
  // 这能解决 `Unmount Trap`，让组件纯粹地作为被动 view 存在
  public getReactFlowTypesMapping(): Record<string, any> {
    const mapping: Record<string, any> = {}
    this.nodes.forEach((def, type) => {
      mapping[type] = def.CanvasComponent
    })
    return mapping
  }
}

export const nodeRegistry = NodeRegistry.getInstance()
