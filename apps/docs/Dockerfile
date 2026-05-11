# ============================================================
# 阶段 1：依赖安装
# ============================================================
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/docs/package.json ./apps/docs/

RUN pnpm install --frozen-lockfile

# ============================================================
# 阶段 2：构建（静态导出）
# ============================================================
FROM deps AS builder

WORKDIR /repo

COPY apps/docs ./apps/docs

ENV NEXT_TELEMETRY_DISABLED=1

# docs 使用 output: 'export'，构建产物在 apps/docs/out 目录
RUN pnpm --filter @aigc/docs build

# ============================================================
# 阶段 3：用 nginx 托管静态文件
# ============================================================
FROM nginx:alpine AS runner

# 复制静态导出产物
COPY --from=builder /repo/apps/docs/out /usr/share/nginx/html

# 自定义 nginx 配置：支持 SPA 路由（404 回退到 index.html）
RUN printf 'server {\n\
    listen 3001;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ $uri.html /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 3001

CMD ["nginx", "-g", "daemon off;"]
