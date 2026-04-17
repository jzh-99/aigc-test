# 单点登录（SSO）接入文档

## 概述

本平台支持通过共享 JWT 密钥实现单点登录。用户在贵方系统已登录后，点击跳转入口即可免登录进入本平台。

---

## 接入流程

### 第一步：获取密钥

联系本平台管理员，通过安全渠道获取 `JWT_SECRET`，部署到贵方后端环境变量中。

> ⚠️ 请勿通过邮件、聊天工具等明文传输密钥。

---

### 第二步：确认用户账号对应关系

本平台每个用户有两个关键字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | 用户唯一 ID（UUID） | `2bc6f2ee-5e0a-435d-8b9e-ccfe3696be01` |
| `account` | 登录账号（邮箱或手机号） | `hbtest@aigc.local` |

贵方系统需要维护「贵方用户」→「本平台 user_id + account」的映射关系。

> 本平台管理员可在后台用户列表中查看每个用户的 User ID，点击可复制。

---

### 第三步：后端签发 SSO Token

用户触发跳转时，贵方**后端**使用 `JWT_SECRET` 签发一个短期 JWT：

**Node.js 示例**
```js
const jwt = require('jsonwebtoken')

const ssoToken = jwt.sign(
  {
    sub: '2bc6f2ee-5e0a-435d-8b9e-ccfe3696be01', // 本平台 users.id
    email: 'hbtest@aigc.local',                  // 本平台 users.account
    role: 'member',                              // 固定填 'member'（非管理员）
  },
  process.env.JWT_SECRET,
  { expiresIn: '3m' }  // 建议 2-3 分钟，最长不超过 5 分钟
)
```

**Python 示例**
```python
import jwt
from datetime import datetime, timedelta, timezone

sso_token = jwt.encode(
    {
        'sub': '2bc6f2ee-5e0a-435d-8b9e-ccfe3696be01',
        'email': 'hbtest@aigc.local',
        'role': 'member',
        'exp': datetime.now(timezone.utc) + timedelta(minutes=3),
    },
    JWT_SECRET,
    algorithm='HS256'
)
```

**Java 示例**
```java
String ssoToken = Jwts.builder()
    .claim("sub", "2bc6f2ee-5e0a-435d-8b9e-ccfe3696be01")
    .claim("email", "hbtest@aigc.local")
    .claim("role", "member")
    .setIssuedAt(new Date())
    .setExpiration(new Date(System.currentTimeMillis() + 3 * 60 * 1000))
    .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes()), SignatureAlgorithm.HS256)
    .compact();
```

---

### 第四步：前端跳转

将 SSO Token 拼接到跳转 URL 中，由前端执行跳转：

```
https://u703085-b83c-f19cd560.westx.seetacloud.com:8443/login?token=<sso_token>
```

**参数说明**

| 参数 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 第三步签发的 SSO Token |
| `redirect` | 否 | 登录后跳转的站内路径，默认 `/`（主页）。必须以 `/` 开头，不能跳转到外部域名 |

**示例**
```
https://u703085-b83c-f19cd560.westx.seetacloud.com:8443/login?token=eyJhbGci...
```

---

## 错误处理

SSO 失败时，页面会显示「单点登录失败，请手动登录」的提示，用户可手动输入账号密码登录，不影响正常使用。

常见失败原因：

| 错误码 | 原因 | 处理方式 |
|--------|------|----------|
| `SSO_TOKEN_EXPIRED` | Token 超过 5 分钟或已过期 | 重新签发后跳转 |
| `SSO_TOKEN_INVALID` | 密钥不匹配或 Token 被篡改 | 检查 JWT_SECRET 是否正确 |
| `USER_NOT_FOUND` | sub 对应的用户不存在 | 确认 user_id 映射关系 |
| `ACCOUNT_SUSPENDED` | 用户账号已被停用 | 联系本平台管理员 |

---

## 安全注意事项

1. `JWT_SECRET` 只能在贵方**后端**使用，不能暴露到前端代码或客户端
2. SSO Token 有效期建议设置为 2-3 分钟，本平台强制拒绝超过 5 分钟的 Token
3. 跳转 URL 中的 `redirect` 参数只允许站内路径（`/` 开头），本平台会自动过滤外部链接
4. 每次跳转都应重新签发新的 Token，不要复用

---

## 测试

本平台提供一个测试页面，可在浏览器中直接验证 SSO 跳转是否正常：

```
https://u703085-b83c-f19cd560.westx.seetacloud.com:8443/sso-test
```

在测试页面中填入以下信息，点击「生成 Token 并跳转」即可模拟完整的 SSO 流程：

| 字段 | 测试值 |
|------|--------|
| JWT_SECRET | 联系管理员获取 |
| User ID | `2bc6f2ee-5e0a-435d-8b9e-ccfe3696be01` |
| Account | `hbtest@aigc.local` |
| 目标服务器域名 | `https://u703085-b83c-f19cd560.westx.seetacloud.com:8443` |
| 跳转路径 | `/` |

