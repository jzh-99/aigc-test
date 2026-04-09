# AIGC 无限画布工作流 (Canvas Workflow) 详细架构与落地实施方案

本文档是 AIGC 无限画布功能的完整设计方案，涵盖了从产品交互、前端架构、底层状态流转到后端资产隔离的所有技术细节。

---

## 一、 产品愿景与核心理念

将 AIGC 系统从“单次盲盒式生成工具”升级为“专业级内容生产流水线”。通过无限画布，让创作者（如编导、设计师、策划）能够以直观的节点连线方式，完成从剧本、分镜、生图到视频生成的全链路串联与精细化控制。

**四大核心设计原则：**
1. **画布极简，面板重交互**：保证千图同屏流畅不卡顿。画布只看结果，配置都在侧栏。
2. **底层彻底解耦**：UI 表现、参数配置与 API 执行逻辑三者分离。绝对不复用现有的 1700 行巨无霸 UI 组件，仅复用其底层的 API 逻辑。
3. **高度可扩展的基础设施**：引入节点注册表（Registry）与集中式快捷键管理，彻底抛弃硬编码，拥抱 OCP（开闭原则）。
4. **无缝融合现有资产，业务数据彻底隔离**：共用后端排队生成系统，但在历史记录和资产库展现上实现“普通生成”与“画布生成”的严格物理与视觉隔离。

---

## 二、 产品功能与 UX 体验细节设计

### 1. 基础工作区与画布交互 (Canvas UX)
* **工作空间权限隔离**：画布归属于 `Workspace` (工作空间级别)，同团队/空间的成员共享该画布资产。
* **极速画布大厅**：在 `/canvas` 路由下展示“我的画布”卡片列表。列表拉取时仅请求 `name` 和 `thumbnail_url`。点击进入画布详情时才拉取庞大的 `workflow_data` JSON。
* **无极缩放与导航**：支持鼠标滚轮平滑缩放、空格+左键拖拽平移，右下角提供全局微地图 (Mini-map) 一键定位视图中心。
* **集中式全局快捷键 (Hotkey Manager)**：
  * 使用 `tinykeys` 或 `react-hotkeys-hook` 结合 Zustand 构建。
  * 彻底抛弃散落在各处的 `onKeyDown`。
  * 支持配置表（如：`Space` 呼出节点创建轮盘，`Mod+Enter` 执行节点，双击空白处建节点等），支持上下文（仅在画布内生效）。

### 2. 节点视觉与检查器模式 (Minimal Nodes & Inspector)
* **极简节点 (Minimal Node)**：画布上的节点主体仅展示”定稿图/视频”和”节点名称”。**坚决不在画布上直接渲染 Prompt 输入框、下拉菜单和滑块组件**，避免严重掉帧。
* **节点引脚交互（Hover Handle UX）**：
  * 鼠标悬停节点时，左侧和右侧各浮现一个加号按钮，平时隐藏避免画布杂乱。
  * **左侧加号（输入引脚，接收参考）**：
    * **拖拽**：从加号拖出连线，可连接画布上任意已有节点的输出，作为本节点的参考输入，自动建立连线。
    * **单击**：弹出”添加参考”菜单，提供两个选项：
      1. **上传素材**：直接上传图片/视频，系统自动创建一个”素材节点”并连线到本节点。
      2. **从画布选取**：进入**拾取模式**（画布其他节点高亮可点击，当前节点高亮边框），单击目标节点即完成连线，按 `Esc` 取消。
  * **右侧加号（输出引脚，为下游提供参考）**：
    * **拖拽**：从加号拖出连线，连接到目标节点的输入引脚，作为目标节点的参考来源，自动建立连线。
    * **单击**：以本节点当前定稿为参考，在其右侧自动创建一个新的生图节点，并自动连线。新节点位置偏移当前节点右侧 280px。
  * **事件优先级**：加号区域触发 `stopPropagation`，不触发节点选中或 Inspector 打开；节点其他区域点击正常触发选中。
  * **引脚方向约定（写入 `types.ts` 契约）**：左侧 = `position: 'left'` = 输入引脚（target handle），右侧 = `position: 'right'` = 输出引脚（source handle）。连线方向：source → target，即右侧 → 左侧，代表”A 节点的输出作为 B 节点的参考输入”。
* **版本历史与定稿穿梭 (Snapshot History)**：
  * 节点支持多次重绘并保留历史版本。数据结构中保留 `history` 数组和 `selectedVersionIndex` 指针。
  * 节点下方提供轻量级分页器控件（如 `< 3 / 8 >`）。用户切换版本时，画布该节点展示即时更新，且将该版本设为”当前定稿”，自动将对应数据传递给下游关联节点。
* **侧边检查器面板 (Inspector Panel)**：
  * 点击画布节点，屏幕右侧滑出属性面板，完整展示当前定稿版本的 Prompt、模型、分辨率等参数。
  * 提供修改参数与“重新生成”/“追加生成”按钮。
* **高亮溯源 (Lineage Highlighting)**：
  * 选中某节点时，触发遍历 Edges，将其依赖的上游连线及源头节点的边框设置为高亮/流光发光动画，清晰展示“这张图是怎么来的”。

### 3. 沉浸式上下文工具与特殊节点
* **图片悬浮工具栏 (Floating Toolbar)**：单击定稿图，图片上方浮现快捷操作提示框，提供：高清放大、局部重绘、多角度生成、九宫格拆分等扩充功能。
* **节点定稿视频的画布内播放**：
  * 视频节点默认展示**视频首帧截图**（由后端 worker 完成时生成，存入 `canvas_node_outputs.thumbnail_url`），不加载 `<video>` 元素，避免多视频节点同时占用解码资源。
  * 用户在画布上点击视频节点的播放按钮时，才实例化 `<video>` 元素并开始加载播放；节点离开可视区域（`IntersectionObserver` 检测）时自动暂停并卸载 `<video>`，释放内存。
  * 同一时刻画布上最多允许 **1 个视频节点处于播放状态**，点击第二个时自动暂停第一个（全局播放状态在 `CanvasExecutionStore` 中维护 `activeVideoNodeId`）。
* **画布级放大缩小与高清图片切换**：
  * 画布缩放比例低于 60% 时，节点内图片展示压缩缩略图（`thumbnail_url`，≤100KB），减少带宽消耗。
  * 缩放比例超过 100% 时，可视区域内的图片节点自动切换加载原图 S3 URL（高清大图），实现”放大看清晰原图”效果。
  * 切换由 `IntersectionObserver` + `zoom` 比例双重判断触发，离开可视区域立即还原为缩略图。
* **画板与草图辅助节点 (Sketch Node)**：
  * 将”手绘”定义为一种产生数据的特殊业务节点。
  * 节点内包含 HTML5 Canvas（借助 `perfect-freehand` 等）。以原图作为底层背景，收集用户涂抹的笔触 (Strokes)。**笔触坐标数组**存入 `structure_data`（轻量），用户完成涂抹后将合并图片上传 S3，输出引脚传递 S3 URL 给下游节点。**严禁将 Base64 图片字符串存入 `structure_data`**，否则单节点可使保存体积膨胀 2-3MB。

* **素材节点（Asset Node）** — 画布上独立存在的资产载体：
  * **拖拽上传**：用户将图片/视频文件直接拖入画布空白处，触发 `drop` 事件，自动上传至 S3 并在落点位置创建一个素材节点，节点展示该文件的缩略图。
  * **从历史版本拖出**：用户在节点的历史版本分页器中，将某个非定稿版本拖拽到画布空白处，系统在落点位置创建独立素材节点，持有该版本的 S3 URL，原节点历史记录不变。
  * **素材节点的行为**：只有输出引脚（右侧加号），没有输入引脚，不能生成，只能被引用。Inspector 面板展示文件信息（尺寸、格式、上传时间），提供”下载”和”删除”操作。删除素材节点时直接删除，**不清理 S3 原始文件**（可能被其他节点引用）。
  * **节点类型标识**：`type: 'asset'`，在节点注册表中独立注册，不含 `executor`。

* **文本节点（Text Node）** — prompt 组件的独立化：
  * 用户双击画布空白处或点击工具栏文本按钮，在画布上创建一个文本框节点，可输入任意文字。
  * 文本节点只有输出引脚，下游生图节点通过连线引用文本节点的内容，连线类型为 `HandleType: 'text'`。
  * 生图节点执行时，将连入的所有文本节点内容**拼接或插入**到 prompt 的指定位置（Inspector 面板中配置插入方式：追加/前置/替换）。
  * 文字内容存储在 `structure_data` 的节点 `data.config.text` 字段，随画布整体保存，无需单独接口。

### 4. 智能连线与数据流控制
* **数据可视化连线**：采用平滑贝塞尔曲线，运行时线上带有光点流动的动画暗示数据传输。
* **批量生成与多选连线 (Grouping)**：
  * 单节点支持一次性生成多张图片。
  * 支持框选多个图片节点作为整体”参考组”，拉出单条连线传递给下游（如多机位视频生成、多图融合参考）。

* **框选多节点的连线操作（Selection Group Handle UX）**：

  框选结束后，选中的节点进入”组选中”状态，画布在这些节点外围渲染一个**虚线大框**，大框左右两侧各出现一个加号，语义与单节点一致但作用于整组：

  | 操作 | 行为 |
  |------|------|
  | 大框**右侧加号拖拽** | 将所有选中节点的输出一起拉出连线，连接到目标节点的一个输入引脚，形成”多节点→单节点”的扇入连线（多条 edge，目标节点的同一输入引脚接收多个来源） |
  | 大框**右侧加号单击** | 自动在右侧新建一个节点，并将所有选中节点分别连线到该新节点，新节点将这些节点的输出全部作为参考 |
  | 大框**左侧加号拖拽** | 从画布某个已有节点拖入，将该节点输出连线到所有选中节点的输入引脚（一对多扇出） |
  | 大框**左侧加号单击** | 弹出”添加参考”菜单（同单节点），所选的参考节点/上传素材批量连线到所有选中节点 |

  * 框选后拖拽大框本体：整体平移所有选中节点（React Flow 原生行为，不干扰）。
  * 点击画布空白处或按 `Esc`：取消框选，虚线大框消失，节点回到普通状态。
  * **框选模式与批量执行的语义区分**：框选后出现的加号操作属于”建立连线”语义；”批量执行”按钮独立存在于工具栏，不由框选加号触发，两种操作不混用。

* **批量执行策略（预检通过才跑，不等待依赖）**：
  * 用户框选多个节点后点击”批量执行”，前端对选中节点逐一做**依赖预检**，不进入任何异步等待或链式触发逻辑。
  * **预检规则**：遍历该节点的所有上游输入引脚，检查连线来源节点是否存在 `is_selected=true` 的输出（即已定稿）。
  * **预检通过**：该节点所有上游引脚均有定稿输出，加入本次执行队列。
  * **预检失败**：任意一条上游引脚无定稿输出，该节点跳过执行，在节点上方展示非阻塞角标提示”参考节点未定稿”，同时在操作完成后统一弹出 Toast：”X 个节点已跳过（参考节点未定稿）”。
  * **执行队列**：通过预检的节点通过 `p-limit` 并发队列（最大并发 3）依次发起请求，互相独立，无等待。
  * **无连线的孤立节点**：无上游引脚的节点（如文本节点、第一个生图节点）视为无依赖，直接通过预检进入执行队列。

  ```typescript
  // 批量执行核心逻辑
  async function runBatchExecution(selectedNodeIds: string[]) {
    const { nodes, edges } = canvasStructureStore.getState()
    const executionQueue: string[] = []
    const skippedNodes: string[] = []

    for (const nodeId of selectedNodeIds) {
      // 找到所有连入该节点的上游节点 id
      const upstreamNodeIds = edges
        .filter(e => e.target === nodeId)
        .map(e => e.source)

      if (upstreamNodeIds.length === 0) {
        // 无上游：直接入队
        executionQueue.push(nodeId)
        continue
      }

      // 检查每个上游节点是否有定稿输出
      const allReady = upstreamNodeIds.every(upId => {
        const upExec = canvasExecutionStore.getState().nodes[upId]
        return upExec?.selectedOutput != null  // is_selected=true 的输出
      })

      if (allReady) {
        executionQueue.push(nodeId)
      } else {
        skippedNodes.push(nodeId)
        // 在节点上标记”参考节点未定稿”角标
        canvasExecutionStore.setNodeWarning(nodeId, '参考节点未定稿')
      }
    }

    if (skippedNodes.length > 0) {
      toast.warning(`${skippedNodes.length} 个节点已跳过（参考节点未定稿）`)
    }

    // 并发队列执行，最大并发 3
    const limit = pLimit(3)
    await Promise.all(
      executionQueue.map(nodeId => limit(() => executeNode(nodeId)))
    )
  }
  ```
* **重跑与局部更新**：修改源头节点，下游节点边缘高亮”待更新”状态。提供”执行当前节点”按钮。批量执行时，上游节点尚未定稿的节点不参与执行，弹出提示”参考节点未定稿”（见第二节批量执行策略）。

---

## 三、 核心技术架构与“防御性设计”

### 1. 节点注册表模式 (Node Registry Pattern)
* **契约规范**：定义标准接口 `CanvasNodeDefinition<TConfig>`，必须提供：
  1. `type`: 唯一标识 (如 'image_gen')
  2. `CanvasComponent`: 画布上的极简 UI
  3. `InspectorComponent`: 右侧属性面板 UI
  4. `executor`: 接收配置和前置输入，调用 API 返回结果的纯异步函数。
* **注册与调度**：建立 `NodeRegistry` Map，应用初始化时装载所有节点。画布引擎只根据 type 查表渲染，新增节点（如“九宫格切片”）仅需增加一份定义，不动核心逻辑。

### 2. 双轨状态管理架构 (Dual-Track State)
解决大工作流渲染卡顿与状态混淆的问题：
* **结构状态库 (`CanvasStructureStore`)**：仅存节点 `id`、`position`、`type` 及轻量级静态参数（工作流模板结构）。
* **执行状态库 (`CanvasExecutionStore`)**：以 `nodeId` 为 Key，独立存放 `isGenerating`, `progress`, `outputs`, `history` 快照。

### 3. 三大“隐形红线”防御机制 (Critical Defenses)
* **🛑 防御 1：组件卸载导致逻辑丢失 (The Unmount Trap)**
  * *现象*：React Flow 节点离开可视区域会被销毁，若 `isGenerating` 写在组件 `useState` 里，生成逻辑会中断。
  * *对策*：完全遵守双轨状态架构。API 调用和状态写入必须在 `CanvasExecutionStore` 和独立的调度层完成。组件内部**只做状态读取和被动渲染**，绝对不管理生命周期。
* **🛑 防御 2：连线逻辑复杂度爆炸 (Edge-Case Complexity)**
  * *现象*：出现环路连线（死循环）或无效类型连线（文本输入到视频引脚）。
  * *对策*：在 `types.ts` 明确定义端口的强类型（`HandleType: 'image' | 'text' | 'video'`）和方向约定（左侧 = `position: 'left'` = target handle，右侧 = `position: 'right'` = source handle，连线方向固定为 source → target）。在 `onConnect` 回调中编写拦截中间件：基于 DAG 算法检测环路，基于引脚类型检测匹配度，违规连线直接拒绝。加号拖拽创建连线也必须经过同一套 `onConnect` 拦截，不绕过校验。
* **🛑 防御 3：批量请求并发防爆 (The Bottleneck)**
  * *现象*：框选 20 个节点执行，同时发出 20 个请求导致前端炸裂或后端限流。
  * *对策*：批量执行前先做依赖预检，跳过未满足条件的节点；通过预检的节点通过 `p-limit` 并发队列限制最大并发 API 请求数（3 个），节点之间相互独立，无等待关系。后端利用已有的 BullMQ 排队，前端通过 `useCanvasPoller` 画布级智能轮询监听批次进度（见第四节），严禁为每个节点单独建立长连接。

### 4. 渲染性能专项防御

#### 4.1 连线动画的性能陷阱
方案中"线上带有光点流动的动画"在边数量超过 30 条时，CSS `animation` 会导致持续的 composite 层重绘，GPU 占用飙升。

**对策：**
- 默认关闭流动动画，仅在"执行中"状态的边上开启（通过 `edge.animated = true` 按需控制）。
- 静止状态的边使用纯 SVG path，无动画，零性能开销。
- 超过 50 条边时，自动降级：关闭所有动画，改用边颜色区分状态（执行中=蓝色，完成=绿色，待更新=橙色）。

#### 4.2 缩略图截图的性能陷阱
`html2canvas` 在节点数量多时会阻塞主线程 1-3 秒，造成明显卡顿。

**对策：**
- 使用 React Flow 内置的 `getViewportForBounds` + `toPng`（基于 `html-to-image`），性能优于 `html2canvas`。
- 截图操作放入 `requestIdleCallback`，在浏览器空闲时执行，不阻塞用户操作。
- 截图分辨率限制为 `800x450`，上传 S3 前压缩到 80% quality，缩略图文件控制在 100KB 以内。
- 截图频率：仅在自动保存触发时附带截图，不单独触发，避免重复截图。

```typescript
// 正确的截图实现
async function captureCanvasThumbnail(rfInstance: ReactFlowInstance) {
  return new Promise<Blob | null>((resolve) => {
    requestIdleCallback(async () => {
      const dataUrl = await toPng(document.querySelector('.react-flow__viewport'), {
        width: 800, height: 450, quality: 0.8
      })
      const blob = await (await fetch(dataUrl)).blob()
      resolve(blob)
    }, { timeout: 5000 })
  })
}
```

#### 4.3 大画布首屏加载优化
- 进入画布时，先渲染节点骨架（仅 position + type），再异步填充节点内容（缩略图、参数）。
- 节点缩略图（`output_urls[0]`）使用 `loading="lazy"` + `IntersectionObserver`，仅渲染可视区域内的图片。
- `CanvasExecutionStore` 的历史版本数据（`canvas_node_outputs`）在节点进入可视区域时才触发懒加载请求。

---

## 四、 后端架构、数据持久化与资产隔离方案

**原则：前端新建路由，后端微调建表，核心引擎与资产体系深度复用但严格隔离。**

### 1. 核心业务接口复用
* 画布发起的所有生图/视频请求，不造新轮子，直接改造并复用现有的 `POST /api/v1/batches` 接口及后端排队系统。

### 2. 数据库设计：新建画布核心表
按 Workspace 隔离，后端新增 `canvases` 表，用于存储画布文件元数据。

**表结构设计（补充版）：**

```sql
CREATE TABLE canvases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '未命名画布',
  thumbnail_url TEXT,
  -- 结构与执行数据分离存储
  structure_data JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  -- structure_data 仅存: nodes[]{id, type, position, data.config}
  -- 不存 history、outputs 等执行态数据，保持轻量
  version INTEGER NOT NULL DEFAULT 1,  -- 乐观锁版本号，用于多设备冲突检测
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 节点执行历史单独建表，避免 workflow_data 无限膨胀
CREATE TABLE canvas_node_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,               -- React Flow 节点 id
  batch_id UUID REFERENCES batches(id),-- 关联到现有 batches 表，复用资产体系
  output_urls TEXT[] NOT NULL,         -- 本次生成的所有输出 URL（可多张）
  params_snapshot JSONB,               -- 生成时的参数快照（prompt、model、resolution 等）
  is_selected BOOLEAN NOT NULL DEFAULT false, -- 是否为当前"定稿"版本
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 查询某节点所有历史版本：SELECT * FROM canvas_node_outputs WHERE canvas_id=? AND node_id=? ORDER BY created_at DESC
-- 查询某节点当前定稿：WHERE canvas_id=? AND node_id=? AND is_selected=true

CREATE INDEX idx_canvas_node_outputs_lookup ON canvas_node_outputs(canvas_id, node_id, created_at DESC);
CREATE INDEX idx_canvases_workspace ON canvases(workspace_id, updated_at DESC);
```

**数据分层说明：**

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 节点位置、类型、参数配置 | `canvases.structure_data` JSONB | 轻量，随画布整体保存 |
| 连线拓扑 (Edges) | `canvases.structure_data` JSONB | 同上 |
| 节点历史版本输出 | `canvas_node_outputs` 独立表 | 按需查询，不随画布全量加载 |
| 图片/视频文件本体 | S3 对象存储（现有体系） | `output_urls` 存 S3 链接 |
| 画布缩略图 | S3 + `canvases.thumbnail_url` | 保存时异步截图上传 |

### 3. 自动保存策略与多设备冲突处理

**核心原则：用户永远不需要手动点"保存"，但也永远不会丢失超过 3 秒的操作。**

#### 3.1 前端自动保存机制

```typescript
// CanvasStructureStore 内部实现
const AUTOSAVE_DEBOUNCE_MS = 2500

// 每次 nodes/edges 变更后，debounce 触发保存
watch(
  () => [store.nodes, store.edges],
  debounce(async () => {
    const { canvasId, nodes, edges, localVersion } = store.getState()
    await saveCanvas({ canvasId, nodes, edges, version: localVersion })
  }, AUTOSAVE_DEBOUNCE_MS)
)
```

- 用户拖动节点、修改参数、连线等操作，均触发 debounce 计时器重置。
- 停止操作 2.5 秒后自动发起保存请求。
- 顶部状态栏显示"已保存 / 保存中..."，让用户感知保存状态。
- 页面卸载前（`beforeunload`）若有未保存变更，用 `fetch + keepalive: true` 强制发起最后一次保存（`sendBeacon` 不支持自定义 Header，无法携带 `Authorization` token）：
```typescript
fetch('/api/v1/canvases/beacon-save', {
  method: 'POST',
  keepalive: true, // 页面卸载后请求仍会完成
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ canvasId, nodes, edges, version }),
})
```

#### 3.2 乐观锁：多设备冲突检测

`canvases` 表的 `version` 字段是整数，每次成功保存后 +1。

**保存接口：**
```
PATCH /api/v1/canvases/:id
Body: { nodes, edges, version: <客户端持有的版本号> }
```

**后端逻辑：**
```sql
UPDATE canvases
SET structure_data = $nodes_edges, version = version + 1, updated_at = NOW()
WHERE id = $id AND version = $client_version  -- 乐观锁条件
RETURNING version
```

- 若 `UPDATE` 影响行数为 0，说明版本已被其他设备抢先写入，返回 `409 Conflict`。
- 前端收到 409 后，弹出非阻塞 Toast："检测到其他设备的更新，已加载最新版本"，自动拉取最新 `structure_data` 覆盖本地，不丢失用户当前正在编辑的节点参数（仅刷新位置/拓扑）。

#### 3.3 刷新/重登/退出后的恢复

- 进入画布 URL（`/canvas/:id`）时，始终从服务端拉取最新 `structure_data`，不依赖 localStorage。
- `CanvasExecutionStore`（生成状态）在刷新后通过以下方式恢复：
  1. 加载 `structure_data` 后，对每个节点查询 `canvas_node_outputs` 中 `is_selected=true` 的记录，回填 `outputs`。
  2. 正在生成中的任务（`isGenerating`）通过下一节的任务回填机制恢复。
- 画布列表页（`/canvas`）始终从服务端拉取，不做本地缓存，保证多设备一致。

---

### 4. 生成任务进度推送：放弃 SSE，改用智能轮询

#### 4.0 为什么不用 SSE（现有机制的问题）

现有的 SSE 实现（`/api/v1/sse/batches/:id`）在普通生成页面是够用的，但画布场景下有结构性缺陷：

| 问题 | 现象 |
|------|------|
| 连接数爆炸 | 画布 10 个节点同时生成 = 10 条 HTTP 长连接 + 10 个 Redis subscriber，服务端资源线性增长 |
| 静默断开 | 代理/负载均衡器通常有 60-90 秒连接超时，断开后前端 `reader.read()` 不会立即报错，节点永远卡在"生成中" |
| 重连丢事件 | 断线期间完成的任务不会重推，重连只能收到新事件，历史结果丢失 |
| 跨设备无法恢复 | 换设备登录后旧 SSE 连接已断，新设备无法感知正在进行的任务 |

#### 4.1 替代方案：画布级智能轮询（Redis 版本号驱动）

**核心思路：** 不维护任何长连接。前端对整个画布只维护**一个**轮询循环，后端用 Redis 存储画布级"脏版本号"，前端只在版本号变化时才处理数据，避免无效渲染。

**后端改动（极小，只改 `complete.ts`）：**

```typescript
// complete.ts — 在现有 publish 之后新增两行
await getPubRedis().publish(`sse:batch:${batchId}`, JSON.stringify({ event: 'batch_update' }))

// 新增：若该 batch 属于画布，递增画布的 Redis 脏版本号
if (jobData.canvasId) {
  await getPubRedis().incr(`canvas:dirty:${jobData.canvasId}`)
  await getPubRedis().expire(`canvas:dirty:${jobData.canvasId}`, 600) // 10 分钟 TTL
}
```

新增一个轻量接口，返回画布下所有活跃 batch 的状态快照：

```typescript
// GET /api/v1/canvases/:id/batch-status
// 响应：{ dirtyVersion: number, batches: [{ batchId, nodeId, status, completedCount, tasks[] }] }
// 只查 status IN ('pending','processing') 的 batch，已完成的不返回
// 响应体通常 < 2KB，无需分页
```

**前端：一个画布只有一个轮询循环（`useCanvasPoller`）：**

```typescript
// hooks/use-canvas-poller.ts
const POLL_INTERVAL = 2000  // 有活跃任务时每 2 秒

export function useCanvasPoller(canvasId: string) {
  const lastDirtyVersion = useRef<number>(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const poll = useCallback(async () => {
    const data = await fetchBatchStatus(canvasId)  // GET /api/v1/canvases/:id/batch-status

    // 版本号未变化：跳过处理，不触发任何 React 渲染
    if (data.dirtyVersion !== lastDirtyVersion.current) {
      lastDirtyVersion.current = data.dirtyVersion
      for (const batch of data.batches) {
        executionStore.updateNodeFromBatch(batch.nodeId, batch)
      }
    }

    // 有活跃任务则继续轮询，否则停止
    if (data.batches.length > 0) {
      timerRef.current = setTimeout(poll, POLL_INTERVAL)
    }
  }, [canvasId])

  useEffect(() => {
    poll()  // 进入画布立即执行一次（刷新后回填）
    return () => clearTimeout(timerRef.current)
  }, [canvasId, poll])

  // 用户触发生成时调用，立即启动轮询
  const startPolling = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(poll, 500)
  }, [poll])

  return { startPolling }
}
```

**与 SSE 的对比：**

| 维度 | SSE（现有） | 画布级智能轮询 |
|------|------------|--------------|
| 10 节点并发 | 10 条长连接 + 10 个 Redis sub | **1 个**轮询循环，无持久连接 |
| 网络断开恢复 | 断线期间事件丢失 | 下一次 poll 自动拿到最新状态 |
| 刷新/换设备 | 需重新订阅，有窗口期 | 进入画布时 poll 一次，立即同步 |
| 服务端资源 | 每连接占用 fd + Redis TCP | 无状态，零持久资源 |
| 实时性 | 毫秒级 | 最大 2 秒延迟（生成耗时 5-60 秒，完全可接受） |
| 实现复杂度 | 高（连接生命周期管理） | 低（setTimeout 链，天然自清理） |

> 现有普通生成页面的 SSE **完全不动**，两套机制并行，互不干扰。

#### 4.2 任务绑定：batch 与画布节点关联

```sql
ALTER TABLE task_batches ADD COLUMN canvas_id UUID REFERENCES canvases(id);
ALTER TABLE task_batches ADD COLUMN canvas_node_id TEXT;
```

调用现有 `POST /api/v1/batches` 时附带：
```json
{ "canvas_id": "xxx", "canvas_node_id": "node_42", ...原有参数 }
```

`GET /api/v1/canvases/:id/batch-status` 通过 `canvas_id` 字段查询，天然支持刷新后回填，无需额外逻辑。

#### 4.3 任务完成后写入 canvas_node_outputs（原子操作）

在 `complete.ts` 的事务内新增，用单条 SQL 原子完成"插入新版本 + 取消旧定稿"，无竞态风险：

```sql
WITH new_output AS (
  INSERT INTO canvas_node_outputs
    (canvas_id, node_id, batch_id, output_urls, params_snapshot, is_selected)
  VALUES ($canvas_id, $node_id, $batch_id, $urls, $params, true)
  RETURNING id
)
UPDATE canvas_node_outputs
SET is_selected = (id = (SELECT id FROM new_output))
WHERE canvas_id = $canvas_id AND node_id = $node_id
```

#### 4.4 轮询方案的已知性能隐患与对策

##### 隐患 1：多标签页叠加轮询 🔴

用户同时打开多个画布标签页时，每个标签页各自维护一个轮询循环，后台标签页的请求会和前台的图片加载竞争浏览器连接数（HTTP/1.1 限制同域 6 个并发连接）。

**对策：** 用 `visibilitychange` 事件在页面进入后台时暂停轮询，重新可见时立即补一次 poll：

```typescript
useEffect(() => {
  const onVisibility = () => {
    if (document.hidden) {
      clearTimeout(timerRef.current)
    } else {
      poll() // 重新可见时立即同步一次，补回后台期间的状态变化
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => document.removeEventListener('visibilitychange', onVisibility)
}, [poll])
```

##### 隐患 2：`canvas_id` 字段无索引导致全表扫描 🔴

`batch-status` 接口查询：
```sql
SELECT ... FROM task_batches WHERE canvas_id = ? AND status IN ('pending','processing')
```
`canvas_id` 是新加字段，`task_batches` 是核心高频写入表，无索引时每次轮询都是全表扫描。10 个并发用户、每 2 秒一次 = 每秒 5 次全表扫描。

**对策：** 建列时同步建部分索引（Partial Index），只索引活跃行，极小：

```sql
CREATE INDEX idx_task_batches_canvas_active
ON task_batches(canvas_id)
WHERE status IN ('pending', 'processing');
-- 绝大多数 batch 是已完成状态，此索引实际体积极小
```

##### 隐患 3：Redis INCR + EXPIRE 非原子 🟡

```typescript
await getPubRedis().incr(`canvas:dirty:${canvasId}`)
await getPubRedis().expire(`canvas:dirty:${canvasId}`, 600)
```

若 `INCR` 成功但 `EXPIRE` 因网络抖动失败，key 永不过期，内存泄漏。

**对策：** 改用 Lua 脚本原子执行：

```typescript
await getPubRedis().eval(
  `local v = redis.call('INCR', KEYS[1])
   redis.call('EXPIRE', KEYS[1], 600)
   return v`,
  1,
  `canvas:dirty:${canvasId}`
)
```

##### 隐患 4：版本号比较逻辑在任务刚完成时漏调 reconcile 🟡

当前逻辑：版本号变化时才处理，但若所有任务恰好在同一次 poll 间隔内全部完成，`batches` 返回空数组，`reconcileCompletedNodes` 不会被调用，节点状态卡在"生成中"。

**对策：** 版本号变化时无论 `batches` 是否为空都执行 reconcile，停止轮询的条件也需修正：

```typescript
if (data.dirtyVersion !== lastDirtyVersion.current) {
  lastDirtyVersion.current = data.dirtyVersion
  executionStore.reconcileNodes(data.batches) // 空数组也传入，让 store 清理已完成节点
}

// 停止条件：无活跃任务 且 版本号已稳定（不再有新完成事件）
const shouldStop = data.batches.length === 0 && data.dirtyVersion === lastDirtyVersion.current
if (!shouldStop) {
  timerRef.current = setTimeout(poll, POLL_INTERVAL)
}
```

##### 隐患 5：fetch 无超时，轮询可能静默挂起 🟢

若后端慢查询导致响应超过 10 秒，`fetchBatchStatus` 挂起期间不会调度下一次 poll，实际轮询间隔远超 2 秒，用户看到节点长时间无进度更新。

**对策：** 用 `AbortSignal.timeout` 加 5 秒超时（Node 18+ 和现代浏览器均支持）：

```typescript
const res = await fetch(`/api/v1/canvases/${canvasId}/batch-status`, {
  headers: { Authorization: `Bearer ${getToken()}` },
  signal: AbortSignal.timeout(5000),
})
```

---

### 5. 其他鲁棒性与安全漏洞

#### 5.1 Zustand 选择器导致全量重渲染 🔴

双轨状态架构能否真正发挥作用，取决于组件如何订阅 `CanvasExecutionStore`。常见的错误写法会导致任何节点的状态变化都触发所有节点重渲染，完全抵消双轨设计的收益。

```typescript
// ❌ 错误：订阅整个 store，节点 A 进度更新 → 节点 B/C/D 全部重渲染
const executionState = useCanvasExecutionStore()

// ✅ 正确：每个节点只订阅自己的 slice，用 useShallow 做浅比较
const { isGenerating, outputs } = useCanvasExecutionStore(
  useShallow((s) => s.nodes[nodeId] ?? DEFAULT_NODE_STATE)
)
// 节点 A 更新 → 只有节点 A 重渲染
```

**这是双轨架构的关键实现细节，必须在 `types.ts` 契约中强制规定**，所有节点组件的 store 订阅方式统一使用 `useShallow` slice 模式，禁止直接调用 `useCanvasExecutionStore()` 不传选择器。

#### 5.2 节点删除后的孤儿历史数据与 Undo/Redo 的冲突

用户在画布中删除节点后，`structure_data` 中该节点信息随自动保存消失，但其在 `canvas_node_outputs` 表中产生的历史生成记录会成为孤儿数据。

**设计挑战（Undo/Redo 冲突）：**
如果用户删除节点时立刻触发后端硬删除并清理 S3，当用户按下 `Ctrl+Z` (Undo) 恢复该节点时，节点外壳会恢复，但历史记录和图片已永久丢失，造成严重 Bug。

**对策（延迟垃圾回收机制 Delayed GC）：**
- 用户删除节点时，前端**不调用**任何删除接口，仅从 `CanvasStructureStore` 移除并触发正常的自动保存（此时支持纯前端的 Undo/Redo，节点随时可无损恢复）。
- 真正的硬删除由后端的 **Cron Job 延迟执行**：每天低谷期扫描 `canvas_node_outputs`，查找 `updated_at` 超过 7 天且其 `node_id` 已不存在于对应画布 `structure_data` 中的记录。
- 将这些确定被永久抛弃的孤儿记录硬删除，并将对应的 S3 URL 压入清理队列。这样既保证了存储不无限膨胀，又给 Undo 留足了安全窗口期。

#### 5.3 画布 API 权限校验缺失 🟡

方案提到"画布归属于 Workspace"，但未定义 API 层的校验逻辑。若只校验 `canvas.user_id`，同 Workspace 的其他成员无法访问；若完全不校验，任何知道 `canvas_id` 的用户都能读取数据。

**对策：**
- 所有画布相关接口，后端统一校验 `canvas.workspace_id` 是否在当前用户的 workspace 成员列表中。
- 在路由中间件层注入校验，而不是在每个 handler 里单独写：

```typescript
// middleware/canvas-auth.ts
app.addHook('preHandler', async (req) => {
  const canvas = await db.selectFrom('canvases')
    .select(['workspace_id'])
    .where('id', '=', req.params.canvasId)
    .executeTakeFirst()
  if (!canvas) throw app.httpErrors.notFound()
  const member = await db.selectFrom('workspace_members')
    .where('workspace_id', '=', canvas.workspace_id)
    .where('user_id', '=', req.user.id)
    .executeTakeFirst()
  if (!member) throw app.httpErrors.forbidden()
})
```

- 用户离开 Workspace 后，其创建的画布归属 Workspace，不随用户转移，`ON DELETE CASCADE` 由 `workspace_id` 外键控制。

#### 5.4 Mini-map 节点内容泄漏 🟢

React Flow 的 `<MiniMap>` 若使用自定义 `nodeComponent` 渲染，会在缩略图中显示节点内容（图片、提示词），在录屏或截图时意外暴露。

**对策：** 只使用 `nodeColor` 属性渲染纯色块，不传 `nodeComponent`：

```tsx
<MiniMap
  nodeColor={(node) => {
    if (node.data.isGenerating) return '#3b82f6'  // 生成中：蓝
    if (node.data.hasOutput) return '#22c55e'      // 已完成：绿
    return '#6b7280'                               // 待执行：灰
  }}
  // 不传 nodeComponent，确保不渲染任何节点内容
/>
```

#### 5.5 `sendBeacon` 无法携带 Authorization Header 🟢

`navigator.sendBeacon` 不支持自定义 Header，无法携带 `Authorization: Bearer token`，导致页面卸载时的保存请求被后端鉴权拦截。

**对策：** 改用 `fetch` + `keepalive: true`，页面卸载后请求仍会完成，且支持完整 Header（已在第三节自动保存策略中修正）：

```typescript
window.addEventListener('beforeunload', () => {
  if (!hasPendingChanges()) return
  fetch('/api/v1/canvases/beacon-save', {
    method: 'POST',
    keepalive: true,
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: JSON.stringify({ canvasId, nodes, edges, version }),
  })
})
```

---

### 6. 极致的防污染资产隔离方案 (项目制资产库)
为防止画布产生的庞大调试过程图污染现有的用户的单次生成历史：

* **防污染标识注入**：画布调用生成 API 时，强制设置 `parent_batch_id = canvas_id`（或在 params JSON 中注入 `{"source":"canvas"}`）。
* **全局历史/资产库隔离**：现有的 `/history` 接口和资产库页面，查询时默认加上 `WHERE parent_batch_id IS NULL` 等条件，将画布产生的任何垃圾完美隐藏。
* **取消画布置内的子资产库**：
  * 画布本身就是资产的最佳呈现载体。废弃原计划的"在全局资产库中下钻浏览单画布资产"功能。
  * 用户想看画布产出了什么，直接点击进入画布大厅的该画布卡片，在连线图中直观查看即可。
  * 任何在画布内生成的高价值内容，如需在画布外独立使用，用户通过节点悬浮工具栏点击"下载"导出。

---

## 五、 拥抱 Agent：自动搭建工作流

基于将工作流完全抽象为纯粹 JSON 结构 (`workflow_data`) 的架构，本方案天生完美支持未来的 Agent 自动化接管：
1. **用户输入指令**：“帮我建一个先写小说，然后分出 3 个镜头的短剧工作流”。
2. **大模型处理**：通过 Tool Calling，输出一段严格符合 React Flow Node/Edge 规范的 JSON 文本。
3. **前端渲染落地**：接收 JSON，调用 `CanvasStructureStore` 的 `setNodes` 与 `setEdges`，瞬间在画布上自动铺展、连线一个完整的工作流模板，真正实现“一语成图”。

---

## 六、 最小可测试原型 (MVP) 开发方案与后续计划

为保证项目平稳落地且方便后期拓展，画布将作为一个全新的路由页面 (`/canvas`) 独立开发，采用**原子化、高度解耦**的架构设计。

### 1. 原子化架构设计原则 (Architecture)

MVP 的核心是建立稳固的基础设施，绝不为了赶进度写死逻辑。

* **核心层 (`/core`)**：纯 TypeScript 逻辑。包含 `types.ts` (所有类型契约)、`registry.ts` (节点注册表)、`dag.ts` (图遍历与依赖计算算法)。这一层不依赖 React。
* **状态层 (`/stores`)**：严格执行**双轨状态架构**。
  * `useCanvasStructureStore`：仅管理 Nodes 拓扑、位置、连线。
  * `useCanvasExecutionStore`：仅管理进度、输出历史。强制使用 `useShallow` 切片订阅。
* **节点组件层 (`/nodes`)**：UI 表现层。画布上的 Node 组件只负责展示状态，绝对不允许内部发起 API 请求或维护复杂的 `useState`。
* **原子化 API 层 (`/services`)**：将原有的 `use-generate.ts` 中的参数组装和请求发送逻辑剥离出来，变成纯粹的异步函数 `executeImageGeneration(params)`。不与任何 UI 状态库绑定。

### 2. MVP 需要实现的核心功能

MVP 阶段（Phase 1）只聚焦跑通“节点创建 -> 参数配置 -> 单点执行 -> 简单连线取值”的核心闭环，忽略花哨的动画与复杂连线。

#### ① 画布大厅与持久化底座
- [x] **画布大厅页面**：创建 `/canvas` 路由，展示"新建画布"大按钮，以及陈列所有历史画布（卡片形式展示名称与缩略图）。
- [x] **后端基建**：新增 `canvases` 表（存画布结构）与 `canvas_node_outputs` 表（存节点产出的历史结果），实现配套 CRUD 接口。
- [x] **复用生成引擎**：画布后端完全复用现有的 `POST /api/v1/batches` 接口触发 BullMQ 异步生成，并注入防污染标识隔离历史记录。

#### ② 画布编辑器底座与基本操作
- [x] 进入编辑器页面，集成 React Flow，实现画布的无限缩放与平移。
- [x] 严格落实双轨状态 Store (`CanvasStructureStore` & `CanvasExecutionStore`)，通过 `useShallow` 切片避免全量重绘。
- [x] 实现画布加载时的结构拉取，并在用户点击"保存"或退出时全量上传 `structure_data`。

#### ③ 极简节点与 Inspector (右侧面板)
- [x] **生图节点**：极简展示（缩略图、标题、状态）。提供基于 `< 1/3 >` 的本地状态分页器，切换预览当前节点的不同历史输出（不再另建子资产库）。
- [x] **文本节点**：基础的富文本输入功能。
- [x] **右侧 Inspector 面板**：点击节点时右侧滑出，提供该节点的表单参数修改（Prompt、模型等）及"执行生成"按钮。

#### ④ 核心数据流转与进度呈现
- [x] **连线与参数传递**：支持文本框连线生图节点。生图节点触发时，能自动遍历上游计算最终 Prompt。
- [x] **无感进度同步**：前端基于 Redis 脏版本号，实现画布级的智能轮询 `useCanvasPoller` 统一更新所有正在生成中节点的状态，解决连接数爆炸问题。

---

### 3. 后续开发计划 (Roadmap)

当 MVP 跑通主干流程后，后续功能以插件或独立模块的形式渐进增强。

#### Phase 2: 交互体验强化与自动保存
- 左右加号引脚交互（拖拽连线、单击从画布拾取参考）。
- 拖拽本地图片/视频到画布自动创建”素材节点 (Asset Node)”。
- 实现 2.5 秒无感自动保存（防抖）与 `beforeunload` 兜底。
- 后端增加乐观锁冲突检测。
- **[Tapnow UX] 右键上下文菜单**：右键画布空白处弹出节点类型菜单，在鼠标位置创建节点（比顶部按钮更自然）。用 ReactFlow 的 `onPaneContextMenu` + 自定义 Portal 实现。
- **[Tapnow UX] Delete 键删除节点**：监听 `keydown` 事件，选中节点时按 Delete/Backspace 直接删除，无需悬浮点击 × 按钮。通过集中式快捷键管理（`useEffect` + `document.addEventListener`）实现，避免 `onKeyDown` 散落各处。
- **[Tapnow UX] Ctrl+C / Ctrl+V 复制粘贴节点**：复制选中节点（含 config 数据），粘贴到当前鼠标位置，位置偏移 +20px 避免重叠。新节点生成新 `id`，不复用旧 id。
- **[Tapnow UX] 生成计时器（Elapsed Timer）**：节点生成中时，Header 区域实时显示已耗时（如 `⏱ 12.3s`）。在 `CanvasExecutionStore` 中存储 `startedAt: number | null`，节点组件用 `useEffect` + `setInterval(1000)` 计算显示，生成完成后清除。
- **[Tapnow UX] 多标签页轮询暂停**：`visibilitychange` 事件在页面进入后台时暂停轮询，重新可见时立即补一次 poll（防止后台标签页抢占浏览器连接数，详见第四节 4.4 隐患 1）。

#### Phase 3: 批量执行与 DAG 调度
- 框选多个节点，大虚线框交互。
- 实现”批量执行”按钮与前端依赖预检（跳过无参考的节点）。
- 引入 `p-limit` 控制并发。
- 实现节点高亮溯源与状态颜色区分。
- **[Tapnow UX] 框选视觉优化**：ReactFlow 内置框选功能已支持，但样式需精调为 `border-2 border-blue-500 bg-blue-500/10`，通过覆盖 `.react-flow__selection` CSS 实现。
- **[Tapnow UX] 节点标题双击重命名**：双击节点 Header 区域进入 inline 编辑模式，修改 `data.label`，失焦或回车确认，同步写入 `CanvasStructureStore`。
- **[Tapnow UX] 历史版本右键菜单**：右键节点 `< 1/3 >` 分页器上的图片缩略图，弹出操作菜单（”下载 / 设为定稿 / 发送到画布新节点”）。当前分页器只能切换，不能操作。
- **[Tapnow UX] 性能模式自动切换（perf-mode）**：节点数量超过阈值（如 50 个）时，自动给 canvas 容器添加 `.perf-mode` class，通过 CSS 全局关闭 `box-shadow`、`backdrop-filter`、`border-radius`、`transition`，保证大画布流畅度。

#### Phase 4: 性能极致优化与进阶节点
- 实现视窗外的视频节点自动销毁播放器，图片节点高清与缩略图的无缝切换。
- 加入 Sketch Node 手绘涂抹节点。
- 实现”定稿存为素材”剥离功能。
- （备案功能）探索”节点折叠为 Group”的复杂交互逻辑。
- **[Tapnow UX] LOD 细节等级（Level of Detail）**：`zoom < 0.4` 时自动切换到低细节模式，节点组件通过 `useStore((s) => s.transform[2])` 订阅 zoom，低于阈值时移除 `shadow`、`border-radius`、`transition`，Preview 区域只渲染核心图片，大幅提升大画布（100+ 节点）性能。注意用 `React.memo` + stable selector 避免 LOD 切换触发全量重渲染。
- **[Tapnow UX] 视口裁剪（Viewport Culling）**：手动计算视口范围（从 ReactFlow `transform` 反推画布坐标），只渲染可视区域内 + 200px padding 的节点；视口外节点替换为极轻量的占位 `<div>`（只保留 position/size，不渲染任何内容）。ReactFlow 内置的虚拟化不够激进，此方案可将大画布 DOM 节点数控制在常量级别。
- **[Tapnow UX] 双击图片节点 → 全屏灯箱（Lightbox）**：双击 ImageGenNode 的预览图，弹出全屏预览弹窗，使用 `createPortal` 挂载到 `document.body`，支持键盘 `Esc` 关闭、左右键翻页历史版本、点击遮罩关闭。不引入第三方 lightbox 库，避免包体积增大。

## 七、 功能备案（暂不实现，设计已定稿存档）

### 📦 备案 1：迭代节点折叠为 Group（Node Collapse to Group）

#### 背景与设计动机

当用户对节点 a 的输出不满意，通过右侧加号不断建立迭代节点（a→a1→a2→c），画布上会积累大量中间节点。最终满意后，这些中间节点是"过程垃圾"，但直接删除又会丢失迭代历史。折叠 Group 设计用来解决这个问题。

**当前阶段（MVP）行为**：分支节点和中间迭代节点与普通节点无异，通过正常连线操作管理，不做任何自动折叠。

#### 折叠触发方式

用户将最终满意的节点 c **拖拽到起始节点 a 上，两节点发生重叠时**，触发折叠意图识别：

- 重叠时在 a 节点上显示折叠图标和简易说明文字（如"松手以折叠为组"）
- 用户松手确认后执行折叠，中途移走则取消

#### Group 边界规则

- **主路径**：从 a 到 c 的最短有向路径上的所有节点全部折入 group
- **放弃的分支**：a 到 c 路径之外的分支节点（如 a→a2 这条放弃路线）**一并折入 group**，视为中间放弃的迭代
- **分支节点有活跃下游连线时的处理**：**暂未决策**，待实现前讨论确认（方案A：强制断开并折入；方案B：跳过该分支节点不折叠）
- 折叠前在画布上高亮预览将被收入 group 的所有节点，让用户确认范围

#### 折叠后的视觉与行为

- Group 在画布上呈现为**单节点卡片**，缩略图为 c 的定稿图
- 左下角显示展开图标和节点数角标（如 `⊞ 4`）
- **连线继承**：group 的输入引脚 = 原 a 的所有输入引脚；group 的输出引脚 = c 的输出引脚
- 原先 a→b 的连线自动变为 group→b，b 无需感知内部变化
- 点击展开图标：恢复显示内部所有子节点和连线，group 卡片消失
- 对下游节点 b 而言，group 与普通节点无视觉和数据差异

#### 二次迭代规则

用户展开 group 后继续迭代，最终将新节点 d 拖到 group 上：**合并进现有 group**，不做嵌套 group，避免嵌套带来的实现和交互复杂度。

#### 数据结构（预留）

```typescript
// structure_data 中 group 节点的数据结构
interface CanvasGroupNode {
  type: 'group'
  id: string
  position: { x: number; y: number }
  data: {
    label: string
    thumbnailUrl: string          // c 节点的定稿图 URL
    childNodeIds: string[]        // group 内所有子节点 id
    entryNodeId: string           // 原始起始节点 a 的 id（继承输入引脚）
    exitNodeId: string            // 最终节点 c 的 id（继承输出引脚）
    isExpanded: boolean           // 当前是否展开
  }
}
```


### 📦 备案 2：长远架构级隐患与治理预案

为保证画布在后期向“复杂工业化大流水线”演进时的稳健性，以下架构级隐患在 MVP 阶段记录在案，待产品体量放大后针对性解决：

#### 1. 工作流数据的“版本碎片化” (Schema Drift)
- **隐患**：随着产品演进，节点的参数配置（`TConfig`）必然变更。半年后打开曾经存入数据库的旧版 JSON，前端解析旧格式会崩溃。
- **治理预案 (Schema Versioning)**：
  在后期的 `NodeRegistry` 接口中，要求为每个节点强制声明 `version` 字段，并提供数据迁移函数：
  `migrate: (oldData, oldVersion) => newData`。在 `structure_data` 反序列化加载时，自动执行数据升级。

#### 2. 异步执行与画布编辑的“竞态条件” (Race Conditions)
- **隐患**：用户点击生图后（任务仍在排队执行），瞬间删除了该节点，或者改动了它的连线和核心参数。几十秒后，Worker 的图片生成完并返回，这时候如果不管不顾直接回填渲染，会引发僵尸节点或脏数据写入。
- **治理预案 (Execution ID 校验)**：
  后期的 `canvas_node_outputs` 每次入库必须校验当前节点在 `structure_data` 中是否还存活；
  前端 `ExecutionStore` 在收到轮询完毕的结果时，严格比对当前的 `nodeId` 和发请求时的拓扑状态，若判定环境已发生变动，则丢弃过期的渲染事件。

#### 3. DAG 错误状态的“传导雪崩” (Error Propagation)
- **隐患**：在复杂的长链路批量生成中（如 A→B→C→D），如果 B 节点因参数不合法或欠费返回 `Failed`，那么 C 和 D 节点不应傻等，也不应传入空指针导致前端崩溃。
- **治理预案 (节点状态机雪崩阻断)**：
  在 `dag.ts` 的调度器中，严格定义节点生命周期 `Idle -> Pending -> Running -> Success | Failed`。
  当下游节点 C 的前置依赖 B 被标记为 `Failed` 时，调度器主动将 C 和 D 标记为 `Skipped` (级联跳过)，及时终止整条链路的无用请求。

#### 4. 高频自动保存导致的数据库写放大 (MVCC Bloat)
- **隐患**：画布 MVP 阶段采用 JSONB 直写 PG/MySQL 数据库。当未来用户体量达到 1000 人同时在线协同，每隔 2.5 秒触发自动保存时，产生的高频 UPDATE 请求会打满数据库 IO（每次改动数据库底层会由于 MVCC 机制复制几十 KB 的新整行，导致表极速膨胀并拖垮查询）。
- **治理预案 (Redis 写缓冲池与读写分离)**：
  - **切勿直接改成写 OSS**，OSS 的 PUT 请求高达 100-300ms 且高频小文件写入收费昂贵。
  - **中间件演进**：前端高频写全部打向 **Redis (Write-Behind Cache)**。由于 JSONB 只有 30KB - 80KB，Redis 可轻松扛下十万级 QPS 更新。
  - **后端低频刷盘**：后端起 Cron Job，每 3 分钟或监听用户 WebSocket/SSE 断开离线时，将 Redis 的最新快照批量 `UPDATE` 落库。
  - **终极 OSS 方案**：只有当未来某个极端的“长篇小说生成”节点使得单图 JSON 大于 200KB、触及数据库溢出 (TOAST) 瓶颈时，才将 `structure_data` 转存为 OSS 文件并仅将 S3 URL 存入数据库。
