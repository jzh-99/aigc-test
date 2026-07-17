# 画布资源 @ 引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在画布图片/视频节点参数面板中支持 `@` 选择上游参考资源，并在提交前转换为资源级约束提示词。

**Architecture:** 扩展现有 `useNodeTopology` 的参考资源元数据，新增可复用 textarea 组件处理 `@` 弹层和 500 字限制，新增纯函数负责 prompt 转换，并在 `NodeParamPanel` 提交前使用。后端接口保持不变。

**Tech Stack:** Next.js 14、React 18、TypeScript、Tailwind CSS、Playwright E2E。

---

### Task 1: 红测覆盖视频节点 @ 资源转换

**Files:**
- Modify: `apps/web/e2e/canvas/video-submit.spec.ts`

- [ ] 增加 E2E：打开视频节点参数面板，输入包含 `@图片1`、`@视频1`、`@音频1` 的 prompt，点击执行，断言提交 payload 的 `prompt` 含资源级转换文本，且 reference URL 数组保持不变。
- [ ] 运行 `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts`，预期新增断言失败。

### Task 2: 实现 prompt 转换纯函数

**Files:**
- Create: `apps/web/src/components/canvas/panels/resource-mentions.ts`

- [ ] 定义 `CanvasReferenceMentionResource` 类型。
- [ ] 实现 `buildPromptWithResourceMentions(upstreamTexts, promptDraft, resources)`。
- [ ] 规则：按行解析；命中 `@图片1`、`@视频1`、`@音频1` 后生成对应 `图片参考/视频参考/音频参考` 行；未命中文本保留为整体提示词。

### Task 3: 扩展上游资源元数据

**Files:**
- Modify: `apps/web/src/components/canvas/panels/use-node-topology.ts`

- [ ] `OrderedReferenceItem` 增加 `id`、`type`、`mentionLabel`、`sourceLabel`。
- [ ] 按媒体类型分别编号为 `图片1`、`视频1`、`音频1`。
- [ ] 保持现有 `multirefImages`、`multirefVideos`、`multirefAudios` 行为不变。

### Task 4: 新增 @ 输入组件

**Files:**
- Create: `apps/web/src/components/canvas/panels/resource-mention-textarea.tsx`
- Modify: `apps/web/src/components/canvas/panels/image-gen-panel.tsx`
- Modify: `apps/web/src/components/canvas/panels/video-gen-panel.tsx`

- [ ] 组件接收 `value`、`onChange`、`onBlur`、`resources`、`placeholder`。
- [ ] 输入 `@` 时展示资源选择框；点击资源后替换触发位置的 `@` 为 `@图片1 ` 等标记。
- [ ] 限制当前 prompt 500 字并显示字数。

### Task 5: 提交前接入转换与校验

**Files:**
- Modify: `apps/web/src/components/canvas/node-param-panel.tsx`

- [ ] 图片和视频提交前调用 `buildPromptWithResourceMentions`。
- [ ] 超过 500 字时 toast 提示并阻止提交。
- [ ] 历史记录中保存提交后的 `finalPrompt`，保持与接口 payload 一致。

### Task 6: 验证

**Files:**
- Run commands only

- [ ] 运行 `pnpm --filter @aigc/web test:e2e -- canvas/video-submit.spec.ts`。
- [ ] 运行 `pnpm --filter @aigc/web build` 或 `pnpm --filter @aigc/web lint`；若项目无 lint 脚本则说明实际可运行命令。
