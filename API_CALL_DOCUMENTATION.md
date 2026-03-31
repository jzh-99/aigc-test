# API 接口调用文档

## 项目配置概览

### 环境变量配置
```
NANO_BANANA_API_URL=https://ai.comfly.chat
NANO_BANANA_API_KEY=sk-Cnd3vp4jaPfRjcXpJsAUYTyoPHpXJdWBmr7FggozSczSPIUg
GEMINI_MODEL=gemini-3-flash-preview-thinking-*
AI_UPLOAD_BASE_URL=https://uu703085-b83c-f19cd560.westx.seetacloud.com:8443
```

---

## 1. 图片生成接口

### 端点
```
POST /generate/image
```

### 提供商和模型
- **提供商**: nano-banana
- **API URL**: https://ai.comfly.chat/v1/images/generations
- **API URL (编辑)**: https://ai.comfly.chat/v1/images/edits

### 基础请求体
```json
{
  "idempotency_key": "unique-key-123",
  "model": "nano-banana-2.1",
  "prompt": "A beautiful sunset over mountains",
  "quantity": 1,
  "workspace_id": "uuid-here",
  "params": {}
}
```

### 参数配置示例

#### 配置 1: 基础文本生成
```json
{
  "idempotency_key": "img-001",
  "model": "nano-banana-2.1",
  "prompt": "A serene lake landscape with mountains",
  "quantity": 1,
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "params": {
    "aspect_ratio": "16:9"
  }
}
```

**调用流程**:
1. 请求到 `/generate/image`
2. 验证用户权限和积分
3. 调用 `NanoBananaAdapter.generateImage()`
4. 发送 POST 到 `https://ai.comfly.chat/v1/images/generations`
5. 返回图片 URL

---

#### 配置 2: 带参考图片的图片编辑
```json
{
  "idempotency_key": "img-edit-001",
  "model": "nano-banana-2.1",
  "prompt": "Make the sky more vibrant and add clouds",
  "quantity": 1,
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "params": {
    "image": [
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA...",
      "https://example.com/reference-image.jpg"
    ],
    "aspect_ratio": "16:9"
  }
}
```

**调用流程**:
1. 请求到 `/generate/image`
2. 参数验证和清理 (`sanitizeParams`)
3. 检测到 `image` 参数存在
4. 调用 `NanoBananaAdapter.callEdits()` (多部分表单)
5. 图片压缩处理:
   - 如果 > 2MB，使用 Sharp 库压缩到 JPEG
   - 最大边长限制: 2048px
   - JPEG 质量: 85
6. 发送 POST 到 `https://ai.comfly.chat/v1/images/edits`
7. 返回编辑后的图片 URL

---

#### 配置 3: 高级参数配置
```json
{
  "idempotency_key": "img-advanced-001",
  "model": "nano-banana-2.1",
  "prompt": "A cyberpunk city at night with neon lights",
  "quantity": 3,
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "params": {
    "aspect_ratio": "9:16",
    "width": 1024,
    "height": 1536,
    "seed": 42,
    "style": "cyberpunk",
    "quality": "high",
    "steps": 50,
    "cfg_scale": 7.5,
    "guidance_scale": 7.5,
    "scheduler": "euler",
    "negative_prompt": "blurry, low quality, distorted"
  }
}
```

**参数说明**:
- `aspect_ratio`: 宽高比 (16:9, 9:16 等)
- `width/height`: 图片尺寸
- `seed`: 随机种子 (用于可重复生成)
- `style`: 风格 (cyberpunk, realistic, anime 等)
- `quality`: 质量等级 (low, medium, high)
- `steps`: 生成步数 (越高越精细，耗时越长)
- `cfg_scale/guidance_scale`: 提示词引导强度
- `scheduler`: 采样器类型 (euler, ddim 等)
- `negative_prompt`: 负面提示词

**调用流程**:
1. 参数白名单验证 (ALLOWED_PARAM_KEYS)
2. 字符串字段截断到 2000 字符
3. 调用 `callGenerations()` 发送 JSON 请求
4. 返回 3 张图片的 URL 列表

---

#### 配置 4: Gemini 模型 (图片分析)
```json
{
  "idempotency_key": "img-gemini-001",
  "model": "gemini-3.1-flash-image-preview",
  "prompt": "Analyze this image and describe the main objects",
  "quantity": 1,
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "params": {
    "image": [
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA..."
    ]
  }
}
```

**调用流程**:
1. 检测模型前缀 `gemini-3.1-flash-image-preview`
2. 强制使用 `callGenerations()` (JSON 方式)
3. 图片作为 JSON 数组发送
4. 调用 Gemini API 进行分析

---

## 2. 视频生成接口

### 端点
```
POST /videos/generate
```

### 提供商和模型
- **提供商**: nano-banana
- **API URL**: https://ai.comfly.chat/v2/videos/generations
- **轮询 URL**: https://ai.comfly.chat/v2/videos/generations/{task_id}

### 基础请求体
```json
{
  "prompt": "A drone flying over a beautiful landscape",
  "workspace_id": "uuid-here",
  "model": "veo3.1-fast"
}
```

### 参数配置示例

#### 配置 1: 基础视频生成
```json
{
  "prompt": "A person walking through a forest with sunlight filtering through trees",
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "model": "veo3.1-fast"
}
```

**调用流程**:
1. 请求到 `/videos/generate`
2. 验证用户权限和积分 (固定消耗 10 积分)
3. 创建 batch 和 task 记录 (状态: processing)
4. 调用 Veo API:
   ```
   POST https://ai.comfly.chat/v2/videos/generations
   {
     "prompt": "A person walking through a forest...",
     "model": "veo3.1-fast",
     "enhance_prompt": true
   }
   ```
5. 获取 `task_id` 并保存到数据库
6. 返回初始响应 (status: processing)
7. 后台轮询 (每 15 秒):
   ```
   GET https://ai.comfly.chat/v2/videos/generations/{task_id}
   ```
8. 轮询超时: 15 分钟

---

#### 配置 2: 带首帧参考的视频生成
```json
{
  "prompt": "Smooth camera pan across a modern city skyline at sunset",
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "model": "veo3.1-fast",
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA..."
  ],
  "aspect_ratio": "16:9"
}
```

**调用流程**:
1. 参数验证: `images` 数组最多 2 项
2. 创建 batch 记录，params 中标记 `has_first_frame: true`
3. 调用 Veo API:
   ```
   POST https://ai.comfly.chat/v2/videos/generations
   {
     "prompt": "Smooth camera pan...",
     "model": "veo3.1-fast",
     "enhance_prompt": true,
     "images": ["data:image/jpeg;base64,..."],
     "aspect_ratio": "16:9"
   }
   ```
4. 后续轮询流程同上

---

#### 配置 3: 首尾帧参考 + 宽高比
```json
{
  "prompt": "Transition from a beach scene to a mountain landscape",
  "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
  "model": "veo3.1-fast",
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA...",
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA..."
  ],
  "aspect_ratio": "9:16",
  "enable_upsample": true
}
```

**参数说明**:
- `images`: 最多 2 张图片 (首帧和末帧)
- `aspect_ratio`: 视频宽高比 (16:9, 9:16)
- `enable_upsample`: 是否启用上采样 (提高分辨率)

**调用流程**:
1. 参数验证: `images.length <= 2`
2. 创建 batch 记录，params 中标记:
   ```
   {
     "aspect_ratio": "9:16",
     "has_first_frame": true,
     "has_last_frame": true
   }
   ```
3. 调用 Veo API:
   ```
   POST https://ai.comfly.chat/v2/videos/generations
   {
     "prompt": "Transition from a beach...",
     "model": "veo3.1-fast",
     "enhance_prompt": true,
     "images": [first_frame, last_frame],
     "aspect_ratio": "9:16",
     "enable_upsample": true
   }
   ```
4. 后续轮询和完成处理

---

#### 配置 4: 视频生成失败处理
**场景**: API 调用失败或轮询超时

**调用流程**:
1. 如果初始 API 调用失败:
   - 立即标记 task 为 failed
   - 记录错误信息 (截断到 1000 字符)
   - 退款积分 (10 积分)
   - 返回 502 错误

2. 如果轮询超时 (> 15 分钟):
   - 标记 task 为 failed
   - 错误信息: "Video generation timed out after 15 minutes"
   - 退款积分

3. 如果轮询连续失败 (> 5 次):
   - 标记 task 为 failed
   - 错误信息: "生成过程中出现异常，请重新发起请求"
   - 退款积分

---

## 3. AI 助手接口

### 端点
```
POST /ai-assistant/chat
```

### 提供商和模型
- **提供商**: Gemini (通过 comfly 代理)
- **API URL**: https://ai.comfly.chat/v1/chat/completions
- **模型**: gemini-3-flash-preview-thinking-*

### 基础请求体
```json
{
  "message": "How can I improve this image?",
  "tab": "chat",
  "history": []
}
```

### 参数配置示例

#### 配置 1: 纯文本对话
```json
{
  "message": "Generate a prompt for a cyberpunk city scene",
  "tab": "chat",
  "history": [
    {
      "role": "user",
      "content": "What's a good style for AI image generation?"
    },
    {
      "role": "assistant",
      "content": "Popular styles include: cyberpunk, steampunk, anime, photorealistic..."
    }
  ]
}
```

**调用流程**:
1. 请求到 `/ai-assistant/chat`
2. 构建消息数组:
   ```
   [
     { role: "system", content: "你是 Toby.AI 专业创作助手..." },
     ...history,
     { role: "user", content: "Generate a prompt..." }
   ]
   ```
3. 调用 Gemini API:
   ```
   POST https://ai.comfly.chat/v1/chat/completions
   {
     "model": "gemini-3-flash-preview-thinking-*",
     "messages": [...],
     "stream": true,
     "max_tokens": 4000
   }
   ```
4. 流式返回响应 (SSE 格式)

---

#### 配置 2: 图片分析 (base64)
```json
{
  "tab": "image",
  "image_base64": "/9j/4AAQSkZJRgABAQEA...",
  "image_type": "image/jpeg",
  "message": "请详细分析这张图片的视觉元素，生成可复刻的AI绘图提示词（中英双语）。"
}
```

**调用流程**:
1. 检测 `image_base64` 存在
2. 构建用户内容:
   ```
   [
     {
       "type": "image_url",
       "image_url": {
         "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA..."
       }
     },
     {
       "type": "text",
       "text": "请详细分析这张图片..."
     }
   ]
   ```
3. 调用 Gemini API (同上)
4. 返回分析结果和生成的提示词

---

#### 配置 3: 视频分析 (上传后)
```
步骤 1: 上传视频文件
POST /ai-assistant/upload
Content-Type: multipart/form-data

file: <video.mp4>

响应:
{
  "temp_id": "550e8400-e29b-41d4-a716-446655440000.mp4",
  "url": "https://uu703085-b83c-f19cd560.westx.seetacloud.com:8443/api/v1/ai-assistant/uploads/550e8400-e29b-41d4-a716-446655440000.mp4"
}
```

```
步骤 2: 分析视频
POST /ai-assistant/chat
{
  "tab": "video",
  "video_temp_id": "550e8400-e29b-41d4-a716-446655440000.mp4",
  "message": "请详细分析这个视频的视觉风格、场景构成和画面语言，生成可参考复刻的AI视频生成提示词（中英双语）。"
}
```

**调用流程**:
1. 上传视频到 `/ai-assistant/upload`
   - 最大文件大小: 100 MB
   - 支持格式: mp4, mov, webm, avi
   - 文件保存到 `/tmp/ai-uploads/`
   - 有效期: 15 分钟

2. 调用 `/ai-assistant/chat` 分析
   - 构建用户内容:
     ```
     [
       {
         "type": "image_url",
         "image_url": {
           "url": "https://uu703085-b83c-f19cd560.westx.seetacloud.com:8443/api/v1/ai-assistant/uploads/550e8400-e29b-41d4-a716-446655440000.mp4"
         }
       },
       {
         "type": "text",
         "text": "请详细分析这个视频..."
       }
     ]
     ```

3. 调用 Gemini API (支持视频 URL)

4. 流式返回分析结果

5. 自动删除临时视频文件

---

#### 配置 4: 多轮对话 (图片 + 历史)
```json
{
  "tab": "image",
  "image_base64": "/9j/4AAQSkZJRgABAQEA...",
  "image_type": "image/jpeg",
  "message": "Can you make this more vibrant?",
  "history": [
    {
      "role": "user",
      "content": "Analyze this image"
    },
    {
      "role": "assistant",
      "content": "This is a landscape photo with mountains and a lake..."
    },
    {
      "role": "user",
      "content": "What style would work best?"
    },
    {
      "role": "assistant",
      "content": "For this landscape, I'd recommend: realistic, cinematic, or landscape photography style..."
    }
  ]
}
```

**调用流程**:
1. 构建完整消息历史:
   ```
   [
     { role: "system", content: "你是 Toby.AI..." },
     { role: "user", content: "Analyze this image" },
     { role: "assistant", content: "This is a landscape..." },
     { role: "user", content: "What style would work best?" },
     { role: "assistant", content: "For this landscape..." },
     {
       role: "user",
       content: [
         { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
         { type: "text", text: "Can you make this more vibrant?" }
       ]
     }
   ]
   ```
2. 调用 Gemini API
3. 流式返回响应

---

## 4. 数据库积分扣费流程

### 图片生成
- **固定消耗**: `provider_models.credit_cost` (从数据库查询)
- **数量倍数**: `quantity` 参数
- **总消耗**: `credit_cost * quantity`

### 视频生成
- **固定消耗**: 10 积分 (常量 `VIDEO_CREDITS`)
- **数量**: 固定 1 个视频
- **总消耗**: 10 积分

### 积分流程
1. **冻结** (Freeze): 请求时立即冻结积分
2. **确认** (Confirm): 生成完成时确认扣费
3. **退款** (Refund): 生成失败时退款

### 数据库表
- `credit_accounts`: 积分账户
- `credits_ledger`: 积分交易记录
- `team_members`: 团队成员积分使用情况

---

## 5. 错误处理

### 常见错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|---------|------|
| RATE_LIMITED | 429 | 请求过于频繁 |
| TOO_MANY_PENDING | 429 | 待处理任务过多 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| INSUFFICIENT_CREDITS | 402 | 积分不足 |
| PROMPT_BLOCKED | 403 | 提示词被过滤 |
| INTERNAL_ERROR | 500 | 内部错误 |
| VIDEO_API_ERROR | 502 | 视频 API 错误 |
| AI_ERROR | 502 | AI 助手错误 |

---

## 6. 请求示例 (cURL)

### 图片生成
```bash
curl -X POST https://api.example.com/generate/image \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "img-001",
    "model": "nano-banana-2.1",
    "prompt": "A beautiful sunset",
    "quantity": 1,
    "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
    "params": {
      "aspect_ratio": "16:9"
    }
  }'
```

### 视频生成
```bash
curl -X POST https://api.example.com/videos/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A drone flying over mountains",
    "workspace_id": "550e8400-e29b-41d4-a716-446655440000",
    "model": "veo3.1-fast"
  }'
```

### AI 助手
```bash
curl -X POST https://api.example.com/ai-assistant/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Generate a prompt for a cyberpunk scene",
    "tab": "chat",
    "history": []
  }'
```

---

## 7. 性能优化

### 图片压缩
- 数据 URI 图片自动压缩 (> 2MB)
- 最大边长: 2048px
- JPEG 质量: 85
- 格式: JPEG

### 超时设置
- 图片生成: 180 秒
- 视频 API 调用: 30 秒
- AI 助手: 120 秒
- 视频轮询: 15 分钟

### 速率限制
- 每用户每分钟: 10 个生成请求
- 每用户待处理任务: 最多 20 个

---

## 8. 环境变量参考

```bash
# API 配置
NANO_BANANA_API_URL=https://ai.comfly.chat
NANO_BANANA_API_KEY=sk-Cnd3vp4jaPfRjcXpJsAUYTyoPHpXJdWBmr7FggozSczSPIUg
GEMINI_MODEL=gemini-3-flash-preview-thinking-*

# 上传配置
AI_UPLOAD_BASE_URL=https://uu703085-b83c-f19cd560.westx.seetacloud.com:8443

# 数据库
DATABASE_URL=postgresql://aigc:password@localhost:5432/aigc_test

# Redis
REDIS_URL=redis://:password@localhost:6379/1

# 服务配置
API_PORT=7001
NODE_ENV=production
LOG_LEVEL=info
```
