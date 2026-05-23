# Canvas Audio Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在画布中新增可生成 TTS 音频的 `audio_gen` 节点，支持模型、音色、提示文本、停顿/语气词、语速、音调、音量、情绪、计费估算、音色 Demo 和音频输出。

**Architecture:** 复用现有模型表 `provider_models`、音色表 `provider_system_voices`、画布输出表 `canvas_node_outputs` 和执行态轮询。后端新增 TTS 路由直接调用 MiniMax T2A，同步文本走非流式，长文本走服务端流式汇总后上传为音频资产。

**Tech Stack:** Fastify 4、Kysely、Next.js 14 App Router、React 18、Zustand、SWR、ReactFlow、Tailwind CSS、pnpm。

---

### Task 1: 后端 TTS 能力与单元测试

**Files:**
- Modify: `apps/api/src/services/minimax-tts.ts`
- Create: `apps/api/src/services/minimax-tts.test.ts`
- Create: `apps/api/src/routes/tts/post-generate.ts`
- Modify: `packages/types/src/api.ts`

- [ ] **Step 1: Write failing tests**

新增测试覆盖文本字数统计、3000 字以内非流式、3000 字以上流式策略、返回音频 Buffer 解析。

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @aigc/api exec tsx --test src/services/minimax-tts.test.ts`
Expected: FAIL，因为新导出的策略函数和流式实现尚不存在。

- [ ] **Step 3: Implement minimal backend**

扩展 MiniMax TTS 服务，新增 TTS 请求/响应类型、`shouldUseMiniMaxStreaming`、流式响应解析、统一生成函数；新增 `/tts/generate` 路由，完成权限校验、模型/音色校验、积分冻结、调用 TTS、上传音频、写入 `task_batches` / `tasks` / `assets` / `canvas_node_outputs`。

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @aigc/api exec tsx --test src/services/minimax-tts.test.ts`
Expected: PASS。

### Task 2: 模型音色接口

**Files:**
- Modify: `apps/api/src/routes/models/get.ts`
- Modify: `packages/types/src/api.ts`
- Modify: `packages/db/scripts/seed.ts`

- [ ] **Step 1: Add public voice list type and endpoint**

新增 `SystemVoiceItem` 类型；在 `/models/system-voices` 支持按 provider/language 查询活跃音色，返回 `id`、`voice_id`、`name`、`language`、`demo_audio_url`。

- [ ] **Step 2: Ensure seed schema is usable**

保持 `params_schema` 包含 `voice_id`、`speed`、`volume`、`pitch`、`emotion`，并将 TTS 单价语义明确为“每千字积分”。

### Task 3: 画布类型、注册表和执行态支持音频节点

**Files:**
- Modify: `apps/web/src/lib/canvas/types.ts`
- Modify: `apps/web/src/lib/canvas/registry.ts`
- Modify: `apps/web/src/lib/canvas/node-theme.ts`
- Modify: `apps/web/src/lib/canvas/canvas-api.ts`
- Modify: `apps/web/src/hooks/canvas/use-canvas-poller.ts`
- Modify: `apps/web/src/components/canvas/canvas-editor.tsx`
- Create: `apps/web/src/components/canvas/nodes/audio-gen-node.tsx`

- [ ] **Step 1: Add `audio_gen` config and node definition**

新增 `AudioGenConfig`，节点默认模型为 `speech-2.8-turbo`，输出 handle 类型为 `audio`。

- [ ] **Step 2: Add API client and poller audio output**

新增 `executeAudioNode`，poller 支持 `asset_type === 'audio'` 写入执行态。

- [ ] **Step 3: Add canvas menu entry**

右键/添加菜单显示“音频”，使用独立主题色。

### Task 4: 音频节点面板

**Files:**
- Modify: `apps/web/src/components/canvas/node-param-panel.tsx`
- Create: `apps/web/src/components/canvas/panels/audio-gen-panel.tsx`
- Create: `apps/web/src/components/canvas/panels/audio-tts-utils.ts`
- Create: `apps/web/src/components/canvas/panels/audio-tts-utils.test.ts`

- [ ] **Step 1: Write failing frontend utility tests**

测试字数统计、价格估算、停顿标记插入、语气词插入、参数范围归一。

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @aigc/web exec tsx --test src/components/canvas/panels/audio-tts-utils.test.ts`
Expected: FAIL，因为工具模块不存在。

- [ ] **Step 3: Implement panel utilities and UI**

面板使用现有图片/视频面板紧凑样式；包含加载/错误/空状态，音色列表、demo 播放、模型切换、文本输入、字数与价格、停顿/语气词快捷按钮、语速/音调/音量/情绪控制和执行按钮。

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @aigc/web exec tsx --test src/components/canvas/panels/audio-tts-utils.test.ts`
Expected: PASS。

### Task 5: E2E 和整体验证

**Files:**
- Modify: `apps/web/e2e/fixtures/api-mocks.ts`
- Modify: `apps/web/e2e/fixtures/canvas.ts`
- Create: `apps/web/e2e/canvas/audio-submit.spec.ts`

- [ ] **Step 1: Add E2E fixture and test**

测试添加音频节点、填写文本、选择音色、点击 Demo、提交 payload 包含 TTS 参数和 canvas node id。

- [ ] **Step 2: Run verification**

Run:
- `pnpm --filter @aigc/web exec tsc --noEmit`
- `pnpm --filter @aigc/api build`
- `pnpm --filter @aigc/web exec tsx --test src/components/canvas/panels/audio-tts-utils.test.ts`
- `pnpm --filter @aigc/api exec tsx --test src/services/minimax-tts.test.ts`

Expected: all pass。
