# 画布新增节点修改清单

新增或调整画布节点时，按下面清单逐项检查，避免只改了 Agent 创建路径而漏掉用户入口、类型、参数栏或连线规则。

## 必改位置

1. `apps/web/src/lib/canvas/types.ts`
   - `CanvasNodeType` 增加节点类型。
   - 新增节点 config interface。
   - `CanvasNodeConfigMap` 增加映射。
   - `isCanvasNodeType()` 增加类型判断。
   - 新增对应 config type guard。

2. `apps/web/src/lib/canvas/registry.ts`
   - 导入节点画布组件。
   - `nodeRegistry.register()` 注册节点类型、展示名、handles、默认 config。
   - 确认输入/输出 handle id 与节点组件、参数栏、连线规则一致。

3. `apps/web/src/components/canvas/nodes/*.tsx`
   - 新增或更新画布卡片组件。
   - 至少包含：节点标题、删除入口、执行状态/错误态、必要的 preview、ReactFlow `Handle`。

4. `apps/web/src/components/canvas/panels/*.tsx`
   - 新增或更新参数面板。
   - 参数变更通过 `updateNodeData()` 或上层传入的 `onUpdateCfg()` 写回节点 config。
   - 执行型节点通过 `useCanvasExecutionStore` 写入状态、错误和输出。

5. `apps/web/src/components/canvas/node-param-panel.tsx`
   - 导入 config 类型、type guard 和参数面板组件。
   - 增加默认 config。
   - 增加 `node.type` 分支。
   - 渲染对应参数面板。

6. `apps/web/src/stores/canvas/structure-store.ts`
   - 在 `onConnect()` 中补充连线合法性。
   - 对媒体类型节点，优先根据源节点类型和 `AssetConfig.mimeType` 判断是否允许连接。
   - 保留 `hasCycle()` 检查。

7. `apps/web/src/components/canvas/canvas-editor.tsx`
   - 顶部/左上角手动添加按钮。
   - 右键添加节点菜单。
   - `NODE_CANVAS_H` 等硬编码节点尺寸。
   - MiniMap `nodeColor`。
   - 如参数面板宽度有特殊需求，也在这里处理。

8. `apps/web/src/lib/canvas/agent-types.ts`
   - 如果 Agent workflow、step 或 instruction 中硬编码了节点类型 union，同步增加新节点类型。

9. `apps/web/src/lib/canvas/canvas-api.ts`
   - 如果节点需要提交任务、轮询状态或调用后端能力，在这里新增 API helper。
   - 参数面板优先调用 helper，不要散落 raw fetch。

## 视功能而定

10. `apps/web/src/components/canvas/panels/use-node-topology.ts`
    - 如果节点需要读取上游文本、图片、视频、音频或 selected output，检查这里是否已有可复用拓扑解析逻辑。

11. `apps/web/e2e/canvas/*`
    - 用户关键路径节点需要补 e2e：创建节点、连线、参数更新、执行/输出展示。

12. 后端路由与服务
    - 如果节点需要新的服务能力，补 `apps/api/src/routes/*` 和对应 service。
    - 如果已有服务可复用，优先在 `canvas-api.ts` 增加前端 helper。

## 约定

- 多输入排序优先存到节点 config 中，例如 `inputOrder: string[]`；不要为了排序扩展 edge data。
- handle id 必须在 registry、节点组件、连线校验和参数面板中保持一致。
- Agent 可创建节点不等于用户可手动创建节点；需要同时补 canvas editor 的按钮和右键菜单。
- 节点输出统一写入 `useCanvasExecutionStore.addNodeOutput()`，并设置合适的 `type`，方便下游节点读取。
