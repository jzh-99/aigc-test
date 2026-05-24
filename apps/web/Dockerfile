# ============================================================
# 阶段 1：依赖安装
# ============================================================
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

# ============================================================
# 阶段 2：构建
# ============================================================
FROM deps AS builder

WORKDIR /repo

COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/types ./packages/types

# 构建 types 包
RUN pnpm --filter @aigc/types build

# rewrites() 在 next build 时编译进 routes-manifest.json，必须构建时传入
# images.remotePatterns 也会在构建期读取存储访问地址
ARG INTERNAL_API_URL=http://localhost:7001
ARG NEXT_PUBLIC_STORAGE_HOST=localhost
ARG NEXT_PUBLIC_STORAGE_PORT=9000
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_PUBLIC_STORAGE_HOST=$NEXT_PUBLIC_STORAGE_HOST
ENV NEXT_PUBLIC_STORAGE_PORT=$NEXT_PUBLIC_STORAGE_PORT
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @aigc/web build

# ============================================================
# 阶段 3：生产镜像
# ============================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S aigc && adduser -S aigc -G aigc

# Next.js standalone 输出（需在 next.config 中开启 output: 'standalone'）
# 若未开启 standalone，则复制 .next 目录 + node_modules
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

USER aigc

EXPOSE 6006

ENV PORT=6006
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
