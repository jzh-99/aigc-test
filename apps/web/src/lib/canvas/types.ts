export type HandleType = 'image' | 'text' | 'video' | 'audio' | 'any';

// 引脚方向约定：
// position: 'left' -> 输入引脚 (Target Handle) -> 接收上游参考
// position: 'right' -> 输出引脚 (Source Handle) -> 为下游提供参考
export interface CanvasNodeHandle {
  id: string; // 唯一标识，例如 'image-in', 'text-out'
  type: HandleType;
  position: 'left' | 'right';
  label?: string;
  isList?: boolean; // 是否接受多条连线，默认为 false
}

// ---------------------------------------------------------
// 1. 结构层（CanvasStructureStore 管理的数据）
// 仅存静态信息，随画布全量保存，极其轻量
// ---------------------------------------------------------
export interface CanvasNodeData<TConfig = any> {
  label: string;
  config: TConfig; // 业务相关的参数配置，比如 prompt, model, aspectRatio
}

// Omit<Node, 'data'> 使得我们可以自己约束 data
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';

export type AppNode = ReactFlowNode<CanvasNodeData>;
export type AppEdge = ReactFlowEdge;

// ---------------------------------------------------------
// 2. 执行层（CanvasExecutionStore 管理的数据）
// 仅存动态信息，本地缓存，按需请求，绝对不存入 structure_data JSONB 中
// ---------------------------------------------------------
export interface NodeOutputAsset {
  id: string;           // 资产或快照 ID
  url: string;          // S3 访问地址
  type: HandleType;     // 输出类型 (image/video/text)
  paramsSnapshot?: any; // 当时的参数快照
}

export interface NodeExecutionState {
  isGenerating: boolean;
  progress: number;
  errorMessage?: string;

  // 对于支持多次生成的生图节点，可能有多个输出结果
  outputs: NodeOutputAsset[];

  // is_selected=true 的那条定稿输出，传给下游做参考
  selectedOutputId?: string | null;

  // UI 层附加的非阻塞告警，比如 "参考节点未定稿"
  warningMessage?: string;
}

// ---------------------------------------------------------
// 3. 节点注册表契约 (Node Registry Pattern)
// 所有新节点必须实现这个接口
// ---------------------------------------------------------
import { ComponentType } from 'react';

export interface CanvasNodeDefinition<TConfig = any> {
  type: string;             // 必须唯一，如 'image_gen', 'text_input', 'asset'
  label: string;            // 展示名称
  icon?: ComponentType;     // UI 图标

  // 画布上的极简 UI，只负责展示缩略图、进度和分页器
  CanvasComponent: ComponentType<{ id: string; data: CanvasNodeData<TConfig> }>;

  // 点击后右侧滑出的属性面板，负责修改 config 并触发执行
  InspectorComponent?: ComponentType<{ id: string; data: CanvasNodeData<TConfig> }>;

  // 引脚契约，用于在 onConnect 时做合法性拦截
  inputs: CanvasNodeHandle[];
  outputs: CanvasNodeHandle[];

  // 节点创建时的默认参数
  defaultConfig: TConfig;

  // (预留的扩展接口) 版本升级函数
  version?: number;
  migrate?: (oldConfig: any, oldVersion: number) => TConfig;
}
