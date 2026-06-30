# A豆 / 积分体系说明

> 本文档梳理系统各模块的 A 豆（积分）扣费模式、计费标准和完整流程。
>
> 最后更新：2026-06-07

---

## 目录

- [一、通用扣费流程（三阶段模型）](#一通用扣费流程三阶段模型)
- [二、通用定价引擎](#二通用定价引擎)
- [三、各模块扣费详情](#三各模块扣费详情)
  - [3.1 创作生成](#31-创作生成)
  - [3.2 灵动画布](#32-灵动画布)
  - [3.3 Toby Studio](#33-toby-studio)
- [四、总览对比表](#四总览对比表)

---

## 一、通用扣费流程（三阶段模型）

所有模块共享统一的积分生命周期，核心实现在 `apps/api/src/services/credit.ts`。

```
┌──────────┐     成功      ┌──────────┐
│  Freeze  │──────────────▶│ Confirm  │  正式扣减 balance
│  预冻结   │              │  确认扣费  │
└──────────┘              └──────────┘
     │
     │ 失败
     ▼
┌──────────┐
│  Refund  │  解冻返还 frozen_credits + 回退成员额度
│  退款     │
└──────────┘
```

| 阶段 | 动作 | 余额影响 | Ledger 类型 |
|------|------|---------|-------------|
| **Freeze** | 检查余额 ≥ 金额 → `frozen_credits += amount`，检查成员个人配额 | 可用余额减少 | `freeze` |
| **Confirm** | `balance -= actual`，`frozen_credits -= estimated` | 正式扣减 | `confirm` |
| **Refund** | `frozen_credits -= amount`，成员 `credit_used -= amount` | 恢复可用 | `refund` |

### 安全机制

- 使用 `SELECT ... FOR UPDATE` 行锁防止并发竞态
- 成员配额支持周（weekly）/月（monthly）自动重置周期
- 实际扣费与预估值不同时，自动补差或退还差额

### 权限校验链路（所有模块通用）

```
用户请求 → 工作区成员校验（至少 editor 角色）→ 团队身份确认 → 模型可用性校验 → 积分冻结 → 任务创建
```

---

## 二、通用定价引擎

核心函数 `resolveUnitPrice()`（`apps/api/src/lib/pricing.ts`）：

```
积分 = 单价(unitPrice) × 数量
```

### 单价来源

所有模型统一通过 `provider_models.params_pricing` JSON 规则数组定价：

```json
[
  { "model": "seedance-2.0", "resolution": "720p", "unit_price": 15 },
  { "model": "seedance-2.0", "resolution": "1080p", "unit_price": 35 }
]
```

### 匹配逻辑

- 有 `resolution` 参数时：精确匹配规则中的 `resolution`
- 无 `resolution` 时：取规则数组的第一条
- 规则数组为空时：**视为配置异常，直接报错**（所有模型必须在 `params_pricing` 中配置定价规则）

---

## 三、各模块扣费详情

### 3.1 创作生成

#### 3.1.1 图片生成

| 项目 | 说明 |
|------|------|
| **路由** | `POST /generate/image` |
| **源文件** | `apps/api/src/routes/generate/post-image.ts` |
| **计费公式** | `积分 = unitPrice × quantity` |
| **数量** | quantity 默认 1，最大 5 |
| **单价确定** | 按 `params.resolution` 匹配 `params_pricing` |
| **限流** | 每用户每分钟 10 次；最多 20 个 pending 批次 |
| **异步流程** | Freeze → 创建 batch + tasks → 入队 BullMQ → Worker 处理 → Confirm/Refund |
| **幂等** | 通过 `idempotency_key` 支持幂等重入 |

#### 3.1.2 视频生成

| 项目 | 说明 |
|------|------|
| **路由** | `POST /videos/generate` |
| **源文件** | `apps/api/src/routes/videos/post-generate.ts` |
| **计费公式** | `积分 = (生成视频秒数 + 参考视频总秒数) × unitPrice` |
| **时长来源** | `params.duration`（>0 时）+ `params.reference_video_durations[]` |
| **自动时长** | `duration=-1`（自动）时，生成部分用默认 5 秒预估 |
| **计费函数** | `calculateVideoEstimatedCredits()`（`packages/types/src/api.ts`） |

计费公式拆解：

```
总积分 = 生成时长积分 + 参考视频积分
       = (生成秒数 > 0 ? 生成秒数 × unitPrice : unitPrice × 5)
       + 参考视频总秒数 × unitPrice
```

#### 3.1.3 数字人（Avatar）

| 项目 | 说明 |
|------|------|
| **路由** | `POST /avatar/generate` |
| **源文件** | `apps/api/src/routes/avatar/post-generate.ts` |
| **计费公式** | `积分 = Math.ceil(audio_duration) × unitPrice` |
| **单价来源** | 查询 `module='avatar' AND is_active=true` 的模型 `params_pricing` |
| **并发限制** | 全局同时仅 1 个任务 |
| **团队权限** | 需 `team_type` 为 `standard` 或 `avatar_enabled` |
| **外部服务** | 火山引擎 OmniHuman API |

#### 3.1.4 动作模仿（Action Imitation）

| 项目 | 说明 |
|------|------|
| **路由** | `POST /action-imitation/generate` |
| **源文件** | `apps/api/src/routes/action-imitation/post-generate.ts` |
| **计费公式** | `积分 = Math.ceil(video_duration) × unitPrice` |
| **时长范围** | 1-30 秒 |
| **单价来源** | 查询 `module='action_imitation' AND is_active=true` 的模型 `params_pricing` |
| **并发限制** | 全局同时仅 1 个任务 |
| **团队权限** | 同数字人，需 `avatar_enabled` |
| **外部服务** | 火山引擎 Action Imitation 2.0 API |

#### 3.1.5 TTS 语音合成

| 项目 | 说明 |
|------|------|
| **路由** | `POST /tts/generate` |
| **源文件** | `apps/api/src/routes/tts/post-generate.ts` |
| **计费公式** | `积分 = Math.max(1, Math.ceil(字符数 / 1000)) × unitPrice` |
| **字符统计** | `Array.from(text).length`（正确处理 Unicode / emoji） |
| **文本上限** | 10,000 字符 |
| **同步流程** | Freeze → 同步调用 MiniMax TTS → 上传 TOS → Confirm → 返回结果；失败则 Refund |

---

### 3.2 灵动画布（Canvas）

画布节点**复用创作生成的 API**，通过 `canvas_id` + `canvas_node_id` 参数关联到画布节点，**无独立积分路由**。

| 节点类型 | 实际调用 | 计费方式 | 费用 |
|---------|---------|---------|------|
| **图片节点** | `POST /generate/image`（传 canvas_id） | 同图片生成：`unitPrice × quantity` | 有 |
| **视频节点** | `POST /videos/generate`（传 canvas_id） | 同视频生成：按秒计费 | 有 |
| **音频节点** | `POST /tts/generate`（传 canvas_id） | 同 TTS：按千字符计费 | 有 |
| **文本节点** | 纯前端操作 | 无 | **0** |
| **脚本节点** | 纯前端操作 | 无 | **0** |

---

### 3.3 Toby Studio

#### 3.3.1 AI 音乐

| 项目 | 说明 |
|------|------|
| **路由** | `POST /music/generate` |
| **源文件** | `apps/api/src/routes/music/post-generate.ts` |
| **计费公式** | 按「模式 × 轨道类型」固定积分，从 `params_pricing` 中按 pricingKey 匹配 |
| **异步流程** | Freeze → 创建 batch + task + music_track → 入队 music-queue → Worker 异步 → Confirm |

**定价键（pricingKey）映射规则**（`packages/types/src/music.ts`）：

| 模式 | 轨道类型 | pricingKey | 说明 |
|------|---------|------------|------|
| inspiration（灵感） | song（歌曲） | `inspiration_song` | 灵感歌曲 |
| inspiration（灵感） | instrumental（纯乐） | `instrumental` | 纯音乐 |
| custom（自定义） | song（歌曲） | `custom_song` | 自定义歌词歌曲 |

**音色克隆**：

| 项目 | 说明 |
|------|------|
| **单价来源** | `system_cost_configs` 表，`key='music_voice_clone'` |
| **兜底值** | 环境变量 `MUSIC_VOICE_CLONE_CREDITS`，默认 **5 A豆** |
| **文件** | `apps/api/src/routes/music/_shared.ts` → `resolveVoiceCloneCredits()` |

#### 3.3.2 AI 短剧

短剧是**最复杂的模块**，一个项目经历多个阶段，每个阶段有不同的计费方式。

##### 文本生成类（统一规则）

所有 AI 文本生成共享相同的计费规则：

- **源文件**：`apps/api/src/routes/short-drama/_text-generation.ts`
- **单价**：**每 1000 字 1 A豆**（`TEXT_CREDITS_PER_THOUSAND_CHARS = 1`）
- **公式**：`Math.max(1, Math.ceil((输入字符数 + 输出字符数) / 1000)) × 1`
- **计费范围**：输入（system prompt + user prompt）和输出均计费
- **结算方式**：先预冻结固定积分 → AI 生成完成 → 按（输入+输出）实际字符结算 → 多退少补

| 操作 | 源文件 | 预冻结积分 | 说明 |
|------|--------|----------|------|
| **剧本摘要** | `post-script-summary.ts` | 35 A豆 | 从原始创意提炼结构化摘要（输入+输出均计费） |
| **分集大纲** | `post-episode-outlines.ts` | 70 A豆/批次 | 每批次 5 集，逐批生成（输入+输出均计费） |
| **素材描述** | `post-asset-prompts.ts` | 25 A豆 | AI 生成角色/场景/道具的描述和提示词 |
| **片段脚本** | `post-generate-segments.ts` | 40 A豆 | 生成分镜脚本（输入 prompt 较长） |

##### 资产生成类（复用图片/视频 API）

| 操作 | 源文件 | 计费方式 | 说明 |
|------|--------|---------|------|
| **素材图片** | `post-generate-assets.ts` | `unitPrice × 素材数量` | 使用 `SHORT_DRAMA_IMAGE_MODEL` |
| **片段视频** | `post-generate-segment-video.ts` | Seedance：`时长 × unitPrice`；其他：`unitPrice` | 使用 `SHORT_DRAMA_VIDEO_MODEL` |

##### 导出

| 操作 | 源文件 | 计费公式 | 说明 |
|------|--------|---------|------|
| **批量导出** | `post-export-batch.ts` | `每集单价 × 集数` | 环境变量 `short_drama_episode_export_credits`，默认 **10 A豆/集** |

##### 结算安全逻辑

`saveShortDramaStateAndSettleCredits()`（`_text-generation.ts`）在同一事务中完成：

```
1. 更新项目状态和累计积分
2. 解冻预估冻结额度（frozen_credits -= estimated）
3. 扣减实际消耗（balance -= actual）
4. 调整成员额度（差额补退）
5. 写入 confirm ledger + refund ledger（如有差额）
```

安全边界：
- `actual < 0` → 设为 0
- `actual > estimated × 3` → 降为 estimated（防异常）

#### 3.3.3 AI 绘本

绘本模块**复用图片生成和 TTS API**，通过 Fastify 内部 `app.inject` 调用，无独立积分路由。

| 操作 | 内部调用 | 计费方式 |
|------|---------|---------|
| **角色/背景图片** | `POST /generate/image`（model = `PICTURE_BOOK_IMAGE_MODEL`） | 同图片生成单价 |
| **分镜图片** | `POST /generate/image`（含角色/背景参考图） | 同图片生成单价 |
| **分镜音频** | `POST /tts/generate`（model = `PICTURE_BOOK_TTS_MODEL`） | 同 TTS 按千字符 |
| **剧本生成** | Qwen API 流式调用 | **不走积分（免费）** |
| **分镜提示词** | Qwen API 流式调用 | **不走积分（免费）** |

**项目级记账**：每次操作在 `picture_book_project_charges` 表中独立记录，支持按项目汇总预估和实际消耗。

---

## 四、总览对比表

| 模块 | 子功能 | 计费维度 | 单价来源 | 备注 |
|------|--------|---------|---------|------|
| **图片生成** | — | 按张 | `params_pricing[resolution].unit_price` | — |
| **视频生成** | — | 按秒 | `params_pricing[resolution].unit_price` | 生成 + 参考视频均计费 |
| **数字人** | — | 按秒（音频时长） | `params_pricing['default'].unit_price` | 全局仅 1 并发 |
| **动作模仿** | — | 按秒（视频时长） | `params_pricing['default'].unit_price` | 全局仅 1 并发 |
| **TTS** | — | 按千字符 | `params_pricing['default'].unit_price` | 最低 1 单位 |
| **画布-图片** | 图片节点 | 按张 | 同图片生成 | 复用生成 API |
| **画布-视频** | 视频节点 | 按秒 | 同视频生成 | 复用生成 API |
| **画布-音频** | 音频节点 | 按千字符 | 同 TTS | 复用生成 API |
| **画布-文本** | 文本节点 | — | **无费用** | 纯前端 |
| **画布-脚本** | 脚本节点 | — | **无费用** | 纯前端 |
| **音乐** | 灵感歌曲 | 按次 | `params_pricing['inspiration_song']` | 固定价格 |
| **音乐** | 自定义歌曲 | 按次 | `params_pricing['custom_song']` | 固定价格 |
| **音乐** | 纯音乐 | 按次 | `params_pricing['instrumental']` | 固定价格 |
| **音乐** | 音色克隆 | 按次 | `system_cost_configs['music_voice_clone']` | 默认 5 A豆 |
| **短剧** | 剧本摘要 | 按千字符（输入+输出） | 硬编码 1 A豆/千字 | 预冻结 35 |
| **短剧** | 分集大纲 | 按千字符（输入+输出） | 硬编码 1 A豆/千字 | 预冻结 70/批次 |
| **短剧** | 素材描述 | 按千字符（输入+输出） | 硬编码 1 A豆/千字 | 预冻结 25 |
| **短剧** | 片段脚本 | 按千字符（输入+输出） | 硬编码 1 A豆/千字 | 预冻结 40 |
| **短剧** | 素材图片 | 按张 | 图片模型单价 | 复用图片 API |
| **短剧** | 片段视频 | 按秒 | 视频模型单价 | Seedance 按秒，其他按次 |
| **短剧** | 批量导出 | 按集 | 环境变量 | 默认 10 A豆/集 |
| **绘本** | 角色/背景图 | 按张 | 图片模型单价 | 复用图片 API |
| **绘本** | 分镜图片 | 按张 | 图片模型单价 | 复用图片 API |
| **绘本** | 分镜音频 | 按千字符 | TTS 模型单价 | 复用 TTS API |
| **绘本** | 剧本/分镜提示词 | — | **无费用** | Qwen 免费 |

---

## 核心代码索引

| 功能 | 文件路径 |
|------|---------|
| 积分冻结/确认/退款 | `apps/api/src/services/credit.ts` |
| 通用定价引擎 | `apps/api/src/lib/pricing.ts` → `resolveUnitPrice()` |
| 图片生成路由 | `apps/api/src/routes/generate/post-image.ts` |
| 视频生成路由 | `apps/api/src/routes/videos/post-generate.ts` |
| 视频计费函数 | `packages/types/src/api.ts` → `calculateVideoEstimatedCredits()` |
| 数字人生成路由 | `apps/api/src/routes/avatar/post-generate.ts` |
| 动作模仿路由 | `apps/api/src/routes/action-imitation/post-generate.ts` |
| TTS 生成路由 | `apps/api/src/routes/tts/post-generate.ts` |
| 音乐生成路由 | `apps/api/src/routes/music/post-generate.ts` |
| 音乐定价逻辑 | `apps/api/src/routes/music/_shared.ts` → `resolveMusicCredits()` |
| 音乐定价键映射 | `packages/types/src/music.ts` → `resolveMusicPricingKey()` |
| 短剧文本生成计费 | `apps/api/src/routes/short-drama/_text-generation.ts` |
| 短剧素材图片 | `apps/api/src/routes/short-drama/post-generate-assets.ts` |
| 短剧片段视频 | `apps/api/src/routes/short-drama/post-generate-segment-video.ts` |
| 短剧批量导出 | `apps/api/src/routes/short-drama/post-export-batch.ts` |
| 绘本资产图片 | `apps/api/src/routes/picture-book/post-generate-assets.ts` |
| 绘本分镜图片 | `apps/api/src/routes/picture-book/post-generate-storyboard-images.ts` |
| 绘本分镜音频 | `apps/api/src/routes/picture-book/post-generate-storyboard-audio.ts` |
| DB 积分表结构 | `packages/db/src/schema.ts` → `CreditsLedgerTable` |
| 前端积分展示 | `apps/web/src/components/layout/credits-badge.tsx` → `CreditsBadge` |
