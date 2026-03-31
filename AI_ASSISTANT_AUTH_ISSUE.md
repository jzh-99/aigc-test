# AI 助手认证问题诊断和解决方案

## 问题描述
用户反馈：AI 助手返回 "Invalid or expired access token" 错误，但昨天还可以正常使用。

## 根本原因

### 1. 当前认证机制
AI 助手的 `/api/v1/ai-assistant/chat` 路由**需要 JWT 认证**，但不在公开路由列表中。

**代码位置**: `apps/api/src/plugins/jwt-auth.ts:6-14`
```typescript
const PUBLIC_ROUTES = [
  '/api/v1/healthz',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/accept-invite',
  '/api/v1/assets/proxy',
  '/api/v1/assets/thumbnail',
  '/api/v1/ai-assistant/uploads/', // 仅视频上传文件公开
]
// ❌ /api/v1/ai-assistant/chat 不在列表中，需要认证
```

### 2. Token 过期问题
JWT token 有过期时间，当 token 过期后：
- 前端仍然会发送过期的 token
- 后端验证失败，返回 401 错误
- 用户看到 "Invalid or expired access token"

### 3. 为什么昨天可用，今天不可用？
- **Token 过期**: 用户的 access token 可能在昨天到今天之间过期
- **浏览器缓存**: 用户可能清除了浏览器缓存，导致 token 丢失
- **登录状态**: 用户可能需要重新登录

## 解决方案

### 方案 1: 将 AI 助手设为公开路由（推荐用于内测）

**优点**:
- 用户体验最好，无需登录即可使用
- 适合内测阶段快速验证功能
- 降低用户使用门槛

**缺点**:
- 无法追踪用户使用情况
- 无法限制滥用
- API 费用无法归属到具体用户

**实现方式**:
```typescript
// apps/api/src/plugins/jwt-auth.ts

const PUBLIC_ROUTES = [
  '/api/v1/healthz',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/accept-invite',
  '/api/v1/assets/proxy',
  '/api/v1/assets/thumbnail',
  '/api/v1/ai-assistant/uploads/',
  '/api/v1/ai-assistant/chat',      // ✅ 添加这一行
  '/api/v1/ai-assistant/upload',    // ✅ 添加这一行
]
```

### 方案 2: 实现 Token 自动刷新（推荐用于正式上线）

**优点**:
- 保持认证机制，可追踪用户
- 用户体验好，无感知刷新
- 安全性高

**缺点**:
- 需要修改前端代码
- 实现复杂度较高

**实现方式**:

#### 后端：确保 refresh token 机制正常
检查 `/api/v1/auth/refresh` 是否正常工作。

#### 前端：添加 token 刷新逻辑
```typescript
// apps/web/src/lib/api-client.ts 或类似文件

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  let token = useAuthStore.getState().accessToken

  // 第一次尝试
  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  // 如果 401，尝试刷新 token
  if (res.status === 401) {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) {
      const refreshRes = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (refreshRes.ok) {
        const { access_token } = await refreshRes.json()
        useAuthStore.getState().setAccessToken(access_token)

        // 用新 token 重试
        res = await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${access_token}`,
          },
        })
      }
    }
  }

  return res
}
```

### 方案 3: 添加速率限制（配合方案 1 或 2）

如果选择公开路由，建议添加 IP 级别的速率限制：

```typescript
// apps/api/src/routes/ai-assistant.ts

import rateLimit from '@fastify/rate-limit'

export async function aiAssistantRoutes(app: FastifyInstance): Promise<void> {
  // AI 助手专用速率限制：每个 IP 每分钟 10 次请求
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => `ai-assistant:${request.ip}`,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `AI助手请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`
      },
    }),
  })

  // ... 现有路由
}
```

## 推荐方案（内测阶段）

**立即实施**:
1. ✅ 将 AI 助手设为公开路由（方案 1）
2. ✅ 添加 IP 级别速率限制（方案 3）

**正式上线前**:
1. ✅ 实现 token 自动刷新（方案 2）
2. ✅ 恢复 AI 助手认证要求
3. ✅ 添加用户级别的使用配额

## 实施步骤

### 立即修复（5 分钟）

1. 修改 `apps/api/src/plugins/jwt-auth.ts`:
```typescript
const PUBLIC_ROUTES = [
  '/api/v1/healthz',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/accept-invite',
  '/api/v1/assets/proxy',
  '/api/v1/assets/thumbnail',
  '/api/v1/ai-assistant/uploads/',
  '/api/v1/ai-assistant/chat',      // ✅ 新增
  '/api/v1/ai-assistant/upload',    // ✅ 新增
]
```

2. 重启 API 服务:
```bash
pm2 restart api
```

3. 测试验证:
```bash
curl -X POST https://your-domain/api/v1/ai-assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tab": "chat",
    "message": "测试"
  }'
```

### 添加速率限制（10 分钟）

修改 `apps/api/src/routes/ai-assistant.ts`，在文件开头添加速率限制配置。

## 监控建议

### 1. 日志监控
记录 AI 助手的使用情况：
- 请求来源 IP
- 请求频率
- 错误率
- 响应时间

### 2. 告警设置
- API 错误率 > 5%
- 单个 IP 请求频率异常（> 100/分钟）
- API 费用异常增长

### 3. 使用统计
- 每日请求量
- 峰值时段
- 用户分布

## 长期优化

### 1. 用户配额系统
- 免费用户：每天 50 次
- 付费用户：每天 500 次
- 企业用户：无限制

### 2. 缓存机制
- 相同问题缓存 1 小时
- 减少 API 调用成本

### 3. 降级策略
- API 故障时显示友好提示
- 提供离线模式（预设回答）

## 风险评估

### 公开路由的风险
| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| API 滥用 | 高 | IP 速率限制 + 监控告警 |
| 费用失控 | 中 | 设置 API 费用上限 + 每日预算 |
| 服务质量下降 | 低 | 负载均衡 + 自动扩容 |

### 认证路由的风险
| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| Token 过期 | 高 | 自动刷新机制 |
| 用户体验差 | 中 | 优化登录流程 |
| 开发复杂度 | 低 | 使用成熟的认证库 |

## 总结

**当前问题**: AI 助手需要认证，但 token 过期导致用户无法使用。

**立即解决**: 将 AI 助手设为公开路由 + 添加 IP 速率限制。

**长期方案**: 实现 token 自动刷新 + 用户配额系统。

**内测建议**: 使用公开路由，快速验证功能，收集用户反馈。正式上线前再实施完整的认证和配额系统。
